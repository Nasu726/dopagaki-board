use crate::{
    app::AppState,
    commands::publish_shell_status,
    db::{self, refresh_state::SourceRefreshState},
    scheduler::{SourceKey, AUTO_REFRESH_SETTING_KEY, DEFAULT_AUTO_REFRESH_SECONDS},
    sources::{self, arxiv::ArxivClient},
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

const CACHE_CHANGED_EVENT: &str = "cache-changed";
const MIN_AUTO_REFRESH_SECONDS: u64 = 5 * 60;
const MAX_AUTO_REFRESH_SECONDS: u64 = 24 * 60 * 60;
const COORDINATOR_ERROR_RETRY_SECONDS: i64 = 60;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheChanged {
    source_kind: String,
    source_config_json: String,
    widget_ids: Vec<i64>,
}

pub(crate) fn start(app: AppHandle) -> Result<(), String> {
    let arxiv = Arc::new(ArxivClient::new()?);
    tauri::async_runtime::spawn(coordinator_loop(app, arxiv));
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
        let widget = db::widgets::list(&connection)
            .map_err(|error| format!("failed to list widgets: {error}"))?
            .into_iter()
            .find(|widget| widget.id == id)
            .ok_or_else(|| "widget was not found".to_owned())?;

        if !sources::is_supported(&widget.source_kind) {
            return Err(format!(
                "{} does not have a refresh adapter yet",
                widget.source_kind
            ));
        }

        let key = SourceKey::new(widget.source_kind, widget.source_config_json)?;
        let persisted = db::refresh_state::get(
            &connection,
            &key.source_kind,
            &key.source_config_json,
        )
        .map_err(|error| format!("failed to read source refresh state: {error}"))?;
        let global_interval = read_global_auto_interval(&connection)?;
        let auto_interval = sources::effective_auto_interval(&key.source_kind, global_interval);
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

async fn coordinator_loop(app: AppHandle, arxiv: Arc<ArxivClient>) {
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
            tauri::async_runtime::spawn(async move {
                run_refresh(app, arxiv, key).await;
            });
        }

        wait_for_wakeup(&app, next_wakeup, now).await;
    }
}

fn sync_scheduler_sources(app: &AppHandle, now: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (global_interval, snapshots) = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        let global_interval = read_global_auto_interval(&connection)?;
        let widgets = db::widgets::list(&connection)
            .map_err(|error| format!("failed to list widget sources: {error}"))?;

        let mut snapshots: HashMap<SourceKey, SourceRefreshState> = HashMap::new();
        for widget in widgets {
            if !sources::is_supported(&widget.source_kind) {
                continue;
            }

            let key = match SourceKey::new(widget.source_kind.clone(), widget.source_config_json) {
                Ok(key) => key,
                Err(error) => {
                    eprintln!(
                        "ignoring invalid {} source configuration for widget {}: {error}",
                        widget.source_kind, widget.id
                    );
                    continue;
                }
            };
            if snapshots.contains_key(&key) {
                continue;
            }
            let persisted = db::refresh_state::get(
                &connection,
                &key.source_kind,
                &key.source_config_json,
            )
            .map_err(|error| format!("failed to read source refresh state: {error}"))?;
            snapshots.insert(key, persisted);
        }
        (global_interval, snapshots)
    };

    let active: HashSet<SourceKey> = snapshots.keys().cloned().collect();
    let mut scheduler = state
        .scheduler
        .lock()
        .map_err(|_| "scheduler lock was poisoned".to_owned())?;
    for (key, persisted) in snapshots {
        let auto_interval = sources::effective_auto_interval(&key.source_kind, global_interval);
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

fn take_ready_work(
    app: &AppHandle,
    now: i64,
) -> Result<(Vec<SourceKey>, Option<i64>), String> {
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

async fn run_refresh(app: AppHandle, arxiv: Arc<ArxivClient>, key: SourceKey) {
    let attempt_started = match unix_seconds() {
        Ok(now) => now,
        Err(error) => {
            eprintln!("failed to start refresh for {}: {error}", key.source_kind);
            finish_failure(&app, &key, "system clock error");
            return;
        }
    };

    if let Err(error) = persist_attempt(&app, &key, attempt_started) {
        eprintln!("failed to persist refresh attempt for {}: {error}", key.source_kind);
        finish_failure(&app, &key, &error);
        return;
    }

    let result = match key.source_kind.as_str() {
        "arxiv" => arxiv.fetch(&key.source_config_json, attempt_started).await,
        other => Err(format!("no refresh adapter is implemented for {other}")),
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
            finish_failure(&app, &key, &error);
        }
    }
}

fn persist_attempt(app: &AppHandle, key: &SourceKey, now: i64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    db::refresh_state::mark_attempt(
        &connection,
        &key.source_kind,
        &key.source_config_json,
        now,
    )
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
        let widgets = db::widgets::list(&transaction)
            .map_err(|error| format!("failed to list widgets after refresh: {error}"))?;
        let widget_ids = matching_widget_ids(&widgets, key);
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
        scheduler.complete_failure(key, now);
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

fn matching_widget_ids(widgets: &[db::widgets::WidgetLayout], key: &SourceKey) -> Vec<i64> {
    widgets
        .iter()
        .filter_map(|widget| {
            let widget_key =
                SourceKey::new(widget.source_kind.clone(), widget.source_config_json.clone()).ok()?;
            (widget_key == *key).then_some(widget.id)
        })
        .collect()
}

fn read_global_auto_interval(connection: &rusqlite::Connection) -> Result<Option<u64>, String> {
    match db::get_setting(connection, AUTO_REFRESH_SETTING_KEY)
        .map_err(|error| format!("failed to read refresh interval: {error}"))?
    {
        None => Ok(Some(DEFAULT_AUTO_REFRESH_SECONDS)),
        Some(value) if value == "off" => Ok(None),
        Some(value) => {
            let seconds = value
                .parse::<u64>()
                .map_err(|_| "stored refresh interval is invalid".to_owned())?;
            if (MIN_AUTO_REFRESH_SECONDS..=MAX_AUTO_REFRESH_SECONDS).contains(&seconds) {
                Ok(Some(seconds))
            } else {
                Err("stored refresh interval is outside the supported range".to_owned())
            }
        }
    }
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
    use crate::db::migrations;

    #[test]
    fn refresh_setting_defaults_and_off_are_read_without_runtime_state() {
        let connection = rusqlite::Connection::open_in_memory().expect("SQLite should open");
        migrations::run(&connection).expect("migration should succeed");
        assert_eq!(
            read_global_auto_interval(&connection).expect("default should read"),
            Some(DEFAULT_AUTO_REFRESH_SECONDS)
        );

        db::set_setting(&connection, AUTO_REFRESH_SETTING_KEY, "off")
            .expect("setting should write");
        assert_eq!(
            read_global_auto_interval(&connection).expect("off should read"),
            None
        );
    }
}
