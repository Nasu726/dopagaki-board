use super::publish_shell_status;
use crate::{
    app::{AppState, ShellStatus},
    db::{self, cache::CachedItem},
    refresh_settings, runtime, source_config,
};
use serde::Serialize;
use tauri::{AppHandle, State};

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
    Ok(RefreshSettings {
        auto_interval_seconds: refresh_settings::read(&connection)?,
    })
}

#[tauri::command]
pub(crate) fn set_auto_refresh_interval(
    auto_interval_seconds: Option<u64>,
    state: State<'_, AppState>,
) -> Result<RefreshSettings, String> {
    {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        refresh_settings::write(&connection, auto_interval_seconds)?;
    }

    runtime::wake(&state);
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

fn validate_cache_limit(limit: usize) -> Result<usize, String> {
    if (1..=MAX_CACHE_LIMIT).contains(&limit) {
        Ok(limit)
    } else {
        Err("cache item limit is outside the supported range".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_limit_is_bounded() {
        assert_eq!(validate_cache_limit(1).unwrap(), 1);
        assert_eq!(
            validate_cache_limit(MAX_CACHE_LIMIT).unwrap(),
            MAX_CACHE_LIMIT
        );
        assert!(validate_cache_limit(0).is_err());
        assert!(validate_cache_limit(MAX_CACHE_LIMIT + 1).is_err());
    }
}
