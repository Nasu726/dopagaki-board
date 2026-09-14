use super::publish_shell_status;
use crate::{
    app::{AppState, ShellStatus},
    db::{self, cache::CachedItem},
    refresh_policy, refresh_settings, runtime, sources,
};
use serde::Serialize;
use std::collections::HashSet;
use tauri::{AppHandle, State};

const DEFAULT_CACHE_LIMIT: usize = 3;
const MAX_CACHE_LIMIT: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RefreshSettings {
    pub(crate) auto_interval_seconds: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceRefreshDefault {
    pub(crate) source_kind: String,
    pub(crate) mode: String,
    pub(crate) auto_interval_seconds: Option<u64>,
    pub(crate) effective_interval_seconds: Option<u64>,
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
pub(crate) fn get_source_refresh_defaults(
    state: State<'_, AppState>,
) -> Result<Vec<SourceRefreshDefault>, String> {
    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    let global = refresh_settings::read(&connection)?;
    sources::supported_kinds()
        .iter()
        .map(|source_kind| source_refresh_default(&connection, source_kind, global))
        .collect()
}

#[tauri::command]
pub(crate) fn set_source_refresh_default(
    source_kind: String,
    mode: String,
    auto_interval_seconds: Option<u64>,
    state: State<'_, AppState>,
) -> Result<SourceRefreshDefault, String> {
    if !sources::is_supported(&source_kind) {
        return Err("source does not have a working adapter".to_owned());
    }
    let choice = refresh_policy::parse_choice(&mode, auto_interval_seconds)?;
    let result = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        refresh_policy::write_source_choice(&connection, &source_kind, &choice)?;
        let global = refresh_settings::read(&connection)?;
        source_refresh_default(&connection, &source_kind, global)?
    };
    runtime::wake(&state);
    Ok(result)
}

fn source_refresh_default(
    connection: &rusqlite::Connection,
    source_kind: &str,
    global: Option<u64>,
) -> Result<SourceRefreshDefault, String> {
    let choice = refresh_policy::read_source_choice(connection, source_kind)?;
    let (mode, auto_interval_seconds) = refresh_policy::choice_parts(&choice);
    let configured = refresh_policy::read_source_default(connection, source_kind, global)?;
    let effective_interval_seconds = sources::effective_auto_interval(source_kind, configured);
    Ok(SourceRefreshDefault {
        source_kind: source_kind.to_owned(),
        mode: mode.to_owned(),
        auto_interval_seconds,
        effective_interval_seconds,
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
pub(crate) fn list_compact_items(
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<CachedItem>, String> {
    let limit = validate_cache_limit(limit.unwrap_or(DEFAULT_CACHE_LIMIT))?;
    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    let mut widgets = db::widgets::list(&connection)
        .map_err(|error| format!("failed to list Compact widget sources: {error}"))?;

    widgets.sort_by(|left, right| {
        left.y
            .total_cmp(&right.y)
            .then_with(|| left.x.total_cmp(&right.x))
            .then_with(|| left.id.cmp(&right.id))
    });

    let mut visited_sources = HashSet::new();
    let mut visited_items = HashSet::new();
    let mut compact = Vec::with_capacity(limit);

    for widget in widgets {
        if compact.len() >= limit || !sources::is_supported(&widget.source_kind) {
            continue;
        }
        let normalized =
            match sources::normalize_config(&widget.source_kind, &widget.source_config_json) {
                Ok(config) => config,
                Err(error) => {
                    eprintln!(
                        "ignoring invalid Compact {} source configuration: {error}",
                        widget.source_kind
                    );
                    continue;
                }
            };
        if !visited_sources.insert((widget.source_kind.clone(), normalized.clone())) {
            continue;
        }

        let candidates = db::cache::list_for_source(
            &connection,
            &widget.source_kind,
            &normalized,
            limit - compact.len(),
        )
        .map_err(|error| format!("failed to read Compact source cache: {error}"))?;
        for item in candidates {
            if visited_items.insert(item.id.clone()) {
                compact.push(item);
                if compact.len() >= limit {
                    break;
                }
            }
        }
    }

    Ok(compact)
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
    let source_config_json = sources::normalize_config(&source_kind, &source_config_json)?;

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
