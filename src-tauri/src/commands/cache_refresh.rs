use super::publish_shell_status;
use crate::{
    app::{AppState, ShellStatus},
    db::{self, cache::CachedItem},
    scheduler::{SourceKey, AUTO_REFRESH_SETTING_KEY, DEFAULT_AUTO_REFRESH_SECONDS},
    source_config,
};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

const MIN_AUTO_REFRESH_SECONDS: u64 = 5 * 60;
const MAX_AUTO_REFRESH_SECONDS: u64 = 24 * 60 * 60;
const DEFAULT_CACHE_LIMIT: usize = 3;
const MAX_CACHE_LIMIT: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RefreshSettings {
    pub(crate) auto_interval_seconds: Option<u64>,
}

#[tauri::command]
pub(crate) fn get_refresh_settings(state: State<'_, AppState>) -> Result<RefreshSettings, String> {
    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    let auto_interval_seconds = read_auto_interval(&connection)?;
    Ok(RefreshSettings {
        auto_interval_seconds,
    })
}

#[tauri::command]
pub(crate) fn set_auto_refresh_interval(
    auto_interval_seconds: Option<u64>,
    state: State<'_, AppState>,
) -> Result<RefreshSettings, String> {
    validate_auto_interval(auto_interval_seconds)?;

    let source_keys = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        let source_keys = db::widgets::list(&connection)
            .map_err(|error| format!("failed to list widget sources: {error}"))?
            .into_iter()
            .map(|widget| SourceKey::new(widget.source_kind, widget.source_config_json))
            .collect::<Result<Vec<_>, _>>()?;

        let value = auto_interval_seconds
            .map(|seconds| seconds.to_string())
            .unwrap_or_else(|| "off".to_owned());
        db::set_setting(&connection, AUTO_REFRESH_SETTING_KEY, &value)
            .map_err(|error| format!("failed to persist refresh interval: {error}"))?;
        source_keys
    };

    let now = unix_seconds()?;
    let mut scheduler = state
        .scheduler
        .lock()
        .map_err(|_| "scheduler lock was poisoned".to_owned())?;
    for key in source_keys {
        scheduler.sync_source(key, now, auto_interval_seconds);
    }

    Ok(RefreshSettings {
        auto_interval_seconds,
    })
}

#[tauri::command]
pub(crate) fn list_cached_items(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<CachedItem>, String> {
    let limit = validate_cache_limit(limit.unwrap_or(DEFAULT_CACHE_LIMIT))?;
    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    db::cache::list_top(&connection, limit)
        .map_err(|error| format!("failed to read cached items: {error}"))
}

#[tauri::command]
pub(crate) fn list_cached_items_for_source(
    source_kind: String,
    source_config_json: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<CachedItem>, String> {
    let limit = validate_cache_limit(limit.unwrap_or(DEFAULT_CACHE_LIMIT))?;
    if source_kind.trim().is_empty() || source_kind.len() > 64 {
        return Err("invalid source kind".to_owned());
    }
    let source_config_json = source_config::canonicalize(&source_config_json)?;

    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    db::cache::list_for_source(&connection, &source_kind, &source_config_json, limit)
        .map_err(|error| format!("failed to read source cache: {error}"))
}

#[tauri::command]
pub(crate) fn mark_cached_items_seen(
    ids: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ShellStatus, String> {
    if ids.len() > MAX_CACHE_LIMIT || ids.iter().any(|id| id.is_empty() || id.len() > 512) {
        return Err("invalid cached item ids".to_owned());
    }

    let has_unseen = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        db::cache::mark_seen(&connection, &ids)
            .map_err(|error| format!("failed to mark cached items seen: {error}"))?;
        db::cache::has_unseen(&connection)
            .map_err(|error| format!("failed to read unseen cache state: {error}"))?
    };

    let next = {
        let mut shell = state
            .shell
            .lock()
            .map_err(|_| "shell status lock was poisoned".to_owned())?;
        shell.has_unseen = has_unseen;
        shell.clone()
    };
    publish_shell_status(&app, &next);
    Ok(next)
}

fn read_auto_interval(connection: &rusqlite::Connection) -> Result<Option<u64>, String> {
    match db::get_setting(connection, AUTO_REFRESH_SETTING_KEY)
        .map_err(|error| format!("failed to read refresh interval: {error}"))?
    {
        None => Ok(Some(DEFAULT_AUTO_REFRESH_SECONDS)),
        Some(value) if value == "off" => Ok(None),
        Some(value) => {
            let seconds = value
                .parse::<u64>()
                .map_err(|_| "stored refresh interval is invalid".to_owned())?;
            validate_auto_interval(Some(seconds))?;
            Ok(Some(seconds))
        }
    }
}

fn validate_auto_interval(value: Option<u64>) -> Result<(), String> {
    match value {
        None => Ok(()),
        Some(seconds)
            if (MIN_AUTO_REFRESH_SECONDS..=MAX_AUTO_REFRESH_SECONDS).contains(&seconds) =>
        {
            Ok(())
        }
        Some(_) => {
            Err("automatic refresh must be OFF or between 5 minutes and 24 hours".to_owned())
        }
    }
}

fn validate_cache_limit(limit: usize) -> Result<usize, String> {
    if (1..=MAX_CACHE_LIMIT).contains(&limit) {
        Ok(limit)
    } else {
        Err("cache item limit is outside the supported range".to_owned())
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
    fn refresh_interval_accepts_off_and_supported_range() {
        assert!(validate_auto_interval(None).is_ok());
        assert!(validate_auto_interval(Some(5 * 60)).is_ok());
        assert!(validate_auto_interval(Some(60 * 60)).is_ok());
        assert!(validate_auto_interval(Some(24 * 60 * 60)).is_ok());
        assert!(validate_auto_interval(Some(60)).is_err());
        assert!(validate_auto_interval(Some(24 * 60 * 60 + 1)).is_err());
    }

    #[test]
    fn absent_refresh_setting_defaults_to_one_hour() {
        let connection = rusqlite::Connection::open_in_memory().expect("SQLite should open");
        migrations::run(&connection).expect("migration should succeed");
        assert_eq!(
            read_auto_interval(&connection).expect("setting should read"),
            Some(DEFAULT_AUTO_REFRESH_SECONDS)
        );
    }

    #[test]
    fn off_refresh_setting_roundtrips() {
        let connection = rusqlite::Connection::open_in_memory().expect("SQLite should open");
        migrations::run(&connection).expect("migration should succeed");
        db::set_setting(&connection, AUTO_REFRESH_SETTING_KEY, "off")
            .expect("setting should write");
        assert_eq!(
            read_auto_interval(&connection).expect("setting should read"),
            None
        );
    }
}
