use crate::{
    app::AppState,
    commands::publish_shell_status,
    db::{self, refresh_state::SourceRefreshState},
    refresh_policy, refresh_settings,
    scheduler::SourceKey,
    sources::{self, arxiv::ArxivClient, http::SourceFetchError},
};
use rusqlite::Connection;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const CACHE_CHANGED_EVENT: &str = "cache-changed";
const COORDINATOR_ERROR_RETRY_SECONDS: i64 = 60;
const PUBLIC_USER_AGENT: &str = "dopagaki-board/0.1 (https://github.com/Nasu726/dopagaki-board)";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheChanged {
    source_kind: String,
    source_config_json: String,
    widget_ids: Vec<i64>,
}

pub(crate) fn start(app: AppHandle) -> Result<(), String> {
    let arxiv = Arc::new(ArxivClient::new()?);
    let public_http = Arc::new(
        reqwest::Client::builder()
            .user_agent(PUBLIC_USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|error| format!("failed to create source HTTP client: {error}"))?,
    );
    tauri::async_runtime::spawn(coordinator_loop(app, arxiv, public_http));
    Ok(())
}

pub(crate) fn wake(state: &AppState) {
    state.coordinator_wakeup.notify_one();
}

pub(crate) fn request_manual_for_widget(id: i64, state: &AppState) -> Result<(), String> {
    if id <= 0 {
        return Err("widget id must be positive".to_owned());
    }

    let now = unix_seconds()?;
    let (key, persisted, auto_interval) = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        let widget = db::widgets::get(&connection, id)
            .map_err(|error| format!("failed to read widget: {error}"))?
            .ok_or_else(|| "widget was not found".to_owned())?;

        if !sources::is_supported(&widget.source_kind) {
            return Err(format!(
                "{} does not have a refresh adapter yet",
                widget.source_kind
            ));
        }

        let key = source_key(widget.source_kind, widget.source_config_json)?;
        let persisted =
            db::refresh_state::get(&connection, &key.source_kind, &key.source_config_json)
                .map_err(|error| format!("failed to read source refresh state: {error}"))?;
        let global_interval = refresh_settings::read(&connection)?;
        let intervals = collect_source_intervals(&connection, global_interval)?;
        let auto_interval = intervals.get(&key).copied().flatten();
        (key, persisted, auto_interval)
    };

    {
        let mut scheduler = state
            .scheduler
            .lock()
            .map_err(|_| "scheduler lock was poisoned".to_owned())?;
        scheduler.sync_source_with_persisted_state(
            key.clone(),
            now,
            auto_interval,
            persisted.last_success,
            persisted.failure_count,
            persisted.blocked_until,
        );
        scheduler.request_manual(key, now);
    }

    wake(state);
    Ok(())
}

async fn coordinator_loop(
    app: AppHandle,
    arxiv: Arc<ArxivClient>,
    public_http: Arc<reqwest::Client>,
) {
    loop {
        let now = match unix_seconds() {
            Ok(now) => now,
            Err(error) => {
                eprintln!("refresh coordinator clock error: {error}");
                wait_for_wakeup(&app, None, 0).await;
                continue;
            }
        };

        if let Err(error) = sync_scheduler_sources(&app, now) {
            eprintln!("refresh coordinator source sync failed: {error}");
            wait_for_wakeup(
                &app,
                Some(now.saturating_add(COORDINATOR_ERROR_RETRY_SECONDS)),
                now,
            )
            .await;
            continue;
        }

        let (ready, next_wakeup) = match take_ready_work(&app, now) {
            Ok(work) => work,
            Err(error) => {
                eprintln!("refresh coordinator scheduler error: {error}");
                wait_for_wakeup(
                    &app,
                    Some(now.saturating_add(COORDINATOR_ERROR_RETRY_SECONDS)),
                    now,
                )
                .await;
                continue;
            }
        };

        for key in ready {
            let app = app.clone();
            let arxiv = arxiv.clone();
            let public_http = public_http.clone();
            tauri::async_runtime::spawn(async move {
                run_refresh(app, arxiv, public_http, key).await;
            });
        }

        wait_for_wakeup(&app, next_wakeup, now).await;
    }
}

fn sync_scheduler_sources(app: &AppHandle, now: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let snapshots = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        let global_interval = refresh_settings::read(&connection)?;
        let intervals = collect_source_intervals(&connection, global_interval)?;

        let mut snapshots: HashMap<SourceKey, (SourceRefreshState, Option<u64>)> = HashMap::new();
        for (key, interval) in intervals {
            let persisted =
                db::refresh_state::get(&connection, &key.source_kind, &key.source_config_json)
                    .map_err(|error| format!("failed to read source refresh state: {error}"))?;
            snapshots.insert(key, (persisted, interval));
        }
        snapshots
    };

    let active: HashSet<SourceKey> = snapshots.keys().cloned().collect();
    let mut scheduler = state
        .scheduler
        .lock()
        .map_err(|_| "scheduler lock was poisoned".to_owned())?;
    for (key, (persisted, auto_interval)) in snapshots {
        scheduler.sync_source_with_persisted_state(
            key,
            now,
            auto_interval,
            persisted.last_success,
            persisted.failure_count,
            persisted.blocked_until,
        );
    }
    scheduler.disable_missing_sources(&active);
    Ok(())
}

fn collect_source_intervals(
    connection: &Connection,
    global_interval: Option<u64>,
) -> Result<HashMap<SourceKey, Option<u64>>, String> {
    let rows = db::widgets::list_scheduler_source_configs(connection)
        .map_err(|error| format!("failed to list widget refresh policies: {error}"))?;
    let mut source_defaults: HashMap<String, Option<u64>> = HashMap::new();
    let mut intervals: HashMap<SourceKey, Option<u64>> = HashMap::new();

    for (source_kind, source_config_json, refresh_config_json) in rows {
        if !sources::is_supported(&source_kind) {
            continue;
        }
        let key = match source_key(source_kind.clone(), source_config_json) {
            Ok(key) => key,
            Err(error) => {
                eprintln!("ignoring invalid {source_kind} source configuration: {error}");
                continue;
            }
        };
        let inherited = match source_defaults.get(&source_kind) {
            Some(value) => *value,
            None => {
                let value =
                    refresh_policy::read_source_default(connection, &source_kind, global_interval)?;
                source_defaults.insert(source_kind.clone(), value);
                value
            }
        };
        let widget_interval =
            match refresh_policy::resolve_widget_interval(&refresh_config_json, inherited) {
                Ok(value) => value,
                Err(error) => {
                    eprintln!(
                        "ignoring invalid {source_kind} widget refresh configuration: {error}"
                    );
                    inherited
                }
            };
        let effective = sources::effective_auto_interval(&source_kind, widget_interval);
        intervals
            .entry(key)
            .and_modify(|current| *current = combine_intervals(*current, effective))
            .or_insert(effective);
    }

    Ok(intervals)
}

fn combine_intervals(current: Option<u64>, next: Option<u64>) -> Option<u64> {
    match (current, next) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn take_ready_work(app: &AppHandle, now: i64) -> Result<(Vec<SourceKey>, Option<i64>), String> {
    let state = app.state::<AppState>();
    let mut scheduler = state
        .scheduler
        .lock()
        .map_err(|_| "scheduler lock was poisoned".to_owned())?;
    scheduler.mark_due(now);

    let mut ready = Vec::new();
    while let Some(key) = scheduler.pop_ready(now) {
        ready.push(key);
    }
    let next_wakeup = scheduler.next_wakeup_at(now);
    Ok((ready, next_wakeup))
}

async fn run_refresh(
    app: AppHandle,
    arxiv: Arc<ArxivClient>,
    public_http: Arc<reqwest::Client>,
    key: SourceKey,
) {
    let attempt_started = match unix_seconds() {
        Ok(now) => now,
        Err(error) => {
            eprintln!("failed to start refresh for {}: {error}", key.source_kind);
            finish_failure(&app, &key, "system clock error");
            return;
        }
    };

    if let Err(error) = persist_attempt(&app, &key, attempt_started) {
        eprintln!(
            "failed to persist refresh attempt for {}: {error}",
            key.source_kind
        );
        finish_failure(&app, &key, &error);
        return;
    }

    let result: Result<Vec<db::cache::CacheWriteItem>, SourceFetchError> = match key
        .source_kind
        .as_str()
    {
        "arxiv" => arxiv.fetch(&key.source_config_json, attempt_started).await,
        "wikipedia" => {
            sources::wikipedia::fetch(&public_http, &key.source_config_json, attempt_started).await
        }
        "qiita" => {
            sources::qiita::fetch(&public_http, &key.source_config_json, attempt_started).await
        }
        "zenn" => {
            sources::zenn::fetch(&public_http, &key.source_config_json, attempt_started).await
        }
        "youtube" => {
            sources::youtube::fetch(&public_http, &key.source_config_json, attempt_started).await
        }
        other => Err(SourceFetchError::other(
            other,
            "no refresh adapter is implemented",
        )),
    };

    match result {
        Ok(items) => {
            if let Err(error) = finish_success(&app, &key, &items) {
                eprintln!("failed to commit {} refresh: {error}", key.source_kind);
                finish_failure(&app, &key, &error);
            }
        }
        Err(error) => {
            eprintln!("{} refresh failed: {error}", key.source_kind);
            finish_failure_with_retry_floor(
                &app,
                &key,
                &error.to_string(),
                error.retry_floor_seconds(),
            );
        }
    }
}

fn persist_attempt(app: &AppHandle, key: &SourceKey, now: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    db::refresh_state::mark_attempt(&connection, &key.source_kind, &key.source_config_json, now)
        .map_err(|error| format!("failed to persist source attempt: {error}"))
}

fn finish_success(
    app: &AppHandle,
    key: &SourceKey,
    items: &[db::cache::CacheWriteItem],
) -> Result<(), String> {
    let completed_at = unix_seconds()?;
    let state = app.state::<AppState>();

    let (changed, has_unseen, widget_ids) = {
        let mut connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("failed to start cache transaction: {error}"))?;
        let changed = db::cache::upsert_items(&transaction, items)
            .map_err(|error| format!("failed to update feed cache: {error}"))?;
        db::refresh_state::mark_success(
            &transaction,
            &key.source_kind,
            &key.source_config_json,
            completed_at,
        )
        .map_err(|error| format!("failed to persist refresh success: {error}"))?;
        let has_unseen = db::cache::has_unseen(&transaction)
            .map_err(|error| format!("failed to read unseen cache state: {error}"))?;
        let widget_ids = if changed > 0 {
            let widget_sources =
                db::widgets::list_ids_and_configs_for_source_kind(&transaction, &key.source_kind)
                    .map_err(|error| format!("failed to list widgets after refresh: {error}"))?;
            matching_widget_ids(&widget_sources, key)
        } else {
            Vec::new()
        };
        transaction
            .commit()
            .map_err(|error| format!("failed to commit cache transaction: {error}"))?;
        (changed, has_unseen, widget_ids)
    };

    {
        let mut scheduler = state
            .scheduler
            .lock()
            .map_err(|_| "scheduler lock was poisoned".to_owned())?;
        scheduler.complete_success(key, completed_at);
    }

    let shell_update = {
        let mut shell = state
            .shell
            .lock()
            .map_err(|_| "shell status lock was poisoned".to_owned())?;
        if shell.has_unseen == has_unseen {
            None
        } else {
            shell.has_unseen = has_unseen;
            Some(shell.clone())
        }
    };
    if let Some(status) = shell_update {
        publish_shell_status(app, &status);
    }

    if changed > 0 {
        let event = CacheChanged {
            source_kind: key.source_kind.clone(),
            source_config_json: key.source_config_json.clone(),
            widget_ids,
        };
        if let Err(error) = app.emit(CACHE_CHANGED_EVENT, event) {
            eprintln!("failed to emit cache change: {error}");
        }
    }

    wake(&state);
    Ok(())
}

fn finish_failure(app: &AppHandle, key: &SourceKey, reason: &str) {
    finish_failure_with_retry_floor(app, key, reason, None);
}

fn finish_failure_with_retry_floor(
    app: &AppHandle,
    key: &SourceKey,
    reason: &str,
    retry_floor_seconds: Option<u64>,
) {
    let now = unix_seconds().unwrap_or(0);
    let state = app.state::<AppState>();
    let failure_state = {
        let mut scheduler = match state.scheduler.lock() {
            Ok(scheduler) => scheduler,
            Err(_) => {
                eprintln!("scheduler lock was poisoned while recording failure: {reason}");
                wake(&state);
                return;
            }
        };
        scheduler.complete_failure_with_retry_floor(key, now, retry_floor_seconds);
        scheduler.failure_state(key)
    };

    if let Some((failure_count, blocked_until)) = failure_state {
        let persisted = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())
            .and_then(|connection| {
                db::refresh_state::mark_failure(
                    &connection,
                    &key.source_kind,
                    &key.source_config_json,
                    now,
                    failure_count,
                    blocked_until,
                )
                .map_err(|error| format!("failed to persist refresh failure: {error}"))
            });
        if let Err(error) = persisted {
            eprintln!("{error}; original refresh failure: {reason}");
        }
    }

    wake(&state);
}

fn matching_widget_ids(widget_sources: &[(i64, String)], key: &SourceKey) -> Vec<i64> {
    widget_sources
        .iter()
        .filter_map(|(id, source_config_json)| {
            let widget_key =
                source_key(key.source_kind.clone(), source_config_json.clone()).ok()?;
            (widget_key == *key).then_some(*id)
        })
        .collect()
}

fn source_key(source_kind: String, source_config_json: String) -> Result<SourceKey, String> {
    let normalized = sources::normalize_config(&source_kind, &source_config_json)?;
    SourceKey::new(source_kind, normalized)
}

async fn wait_for_wakeup(app: &AppHandle, deadline: Option<i64>, now: i64) {
    let wakeup = app.state::<AppState>().coordinator_wakeup.clone();
    match deadline {
        Some(deadline) if deadline <= now => {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        Some(deadline) => {
            let seconds = u64::try_from(deadline.saturating_sub(now)).unwrap_or(u64::MAX);
            let _ = tokio::time::timeout(Duration::from_secs(seconds), wakeup.notified()).await;
        }
        None => wakeup.notified().await,
    }
}

fn unix_seconds() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock error: {error}"))
        .map(|duration| i64::try_from(duration.as_secs()).unwrap_or(i64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matching_widget_ids_preserves_semantic_config_equivalence() {
        let key = source_key("arxiv".to_owned(), "{}".to_owned()).expect("source key should parse");
        let widget_sources = vec![
            (1, "{}".to_owned()),
            (2, r#"{"query":"cat:cs.AI","maxResults":12}"#.to_owned()),
            (3, r#"{"query":"cat:cs.LG"}"#.to_owned()),
        ];

        assert_eq!(matching_widget_ids(&widget_sources, &key), vec![1, 2]);
    }

    #[test]
    fn shared_source_uses_most_eager_enabled_interval() {
        assert_eq!(combine_intervals(None, None), None);
        assert_eq!(combine_intervals(None, Some(7200)), Some(7200));
        assert_eq!(combine_intervals(Some(7200), None), Some(7200));
        assert_eq!(combine_intervals(Some(7200), Some(3600)), Some(3600));
    }
}
