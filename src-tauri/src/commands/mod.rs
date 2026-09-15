pub(crate) mod cache_refresh;

use crate::{
    app::{self, AppState, ShellStatus, ViewEvent, ViewState, GLOBAL_SHORTCUT_SETTING_KEY},
    db::{self, widgets::WidgetLayout},
    refresh_policy, runtime, sources,
};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_opener::OpenerExt;

const GRID_COLUMNS: f64 = 12.0;
const GRID_ROWS: f64 = 8.0;
const MIN_WIDGET_GRID_SIZE: f64 = 1.0;
const MAX_SHORTCUT_LENGTH: usize = 128;
const SHELL_STATUS_CHANGED_EVENT: &str = "shell-status-changed";

#[tauri::command]
pub(crate) fn get_view_state(app: AppHandle) -> Result<ViewState, String> {
    app::current_view(&app)
}

#[tauri::command]
pub(crate) fn transition_view(event: ViewEvent, app: AppHandle) -> Result<ViewState, String> {
    app::transition_view(&app, event)
}

#[tauri::command]
pub(crate) fn open_content(url: String, app: AppHandle) -> Result<ViewState, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) content URLs are supported".to_owned());
    }

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("failed to open content URL: {error}"))?;

    app::transition_view(&app, ViewEvent::ExternalLaunch)
}

#[tauri::command]
pub(crate) fn get_shell_status(state: State<'_, AppState>) -> Result<ShellStatus, String> {
    read_shell_status(&state)
}

#[tauri::command]
pub(crate) fn set_global_shortcut(
    shortcut: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ShellStatus, String> {
    let _change_guard = state
        .shortcut_change
        .lock()
        .map_err(|_| "shortcut change lock was poisoned".to_owned())?;
    let requested = normalize_shortcut(&shortcut)?;
    let previous = read_shell_status(&state)?;
    let shortcuts = app.global_shortcut();
    let previous_registered = shortcuts.is_registered(previous.global_shortcut.as_str());

    if requested == previous.global_shortcut {
        if !previous_registered {
            if let Err(error) = shortcuts.register(requested.as_str()) {
                let message = format!("shortcut is unavailable: {error}");
                let failed = update_shortcut_status(&state, requested, Some(message.clone()))?;
                publish_shell_status(&app, &failed);
                return Err(message);
            }
        }

        let next = update_shortcut_status(&state, requested, None)?;
        publish_shell_status(&app, &next);
        return Ok(next);
    }

    shortcuts
        .register(requested.as_str())
        .map_err(|error| format!("shortcut is unavailable: {error}"))?;

    if previous_registered {
        if let Err(error) = shortcuts.unregister(previous.global_shortcut.as_str()) {
            let rollback = shortcuts.unregister(requested.as_str()).err();
            return Err(match rollback {
                Some(rollback_error) => format!(
                    "failed to replace the previous shortcut: {error}; cleanup also failed: {rollback_error}"
                ),
                None => format!("failed to replace the previous shortcut: {error}"),
            });
        }
    }

    if let Err(error) = persist_shortcut(&state, &requested) {
        let remove_new_error = shortcuts.unregister(requested.as_str()).err();
        let restore_old_error = if previous_registered {
            shortcuts.register(previous.global_shortcut.as_str()).err()
        } else {
            None
        };

        let mut message = format!("failed to persist global shortcut: {error}");
        if let Some(rollback_error) = remove_new_error {
            message.push_str(&format!("; failed to remove new binding: {rollback_error}"));
        }
        if let Some(rollback_error) = restore_old_error {
            message.push_str(&format!(
                "; failed to restore previous binding: {rollback_error}"
            ));
        }
        return Err(message);
    }

    let next = update_shortcut_status(&state, requested, None)?;
    publish_shell_status(&app, &next);
    Ok(next)
}

#[tauri::command]
pub(crate) fn list_widgets(state: State<'_, AppState>) -> Result<Vec<WidgetLayout>, String> {
    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    db::widgets::list(&connection).map_err(|error| format!("failed to list widgets: {error}"))
}

#[tauri::command]
pub(crate) fn add_widget(
    source_kind: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: State<'_, AppState>,
) -> Result<WidgetLayout, String> {
    validate_source_kind(&source_kind)?;
    validate_grid_geometry(x, y, width, height)?;

    let widget = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        reject_overlap(&connection, None, x, y, width, height)?;
        db::widgets::create(&connection, &source_kind, x, y, width, height)
            .map_err(|error| format!("failed to create widget: {error}"))?
    };
    runtime::wake(&state);
    Ok(widget)
}

#[tauri::command]
pub(crate) fn update_widget_source_config(
    id: i64,
    source_config_json: String,
    state: State<'_, AppState>,
) -> Result<WidgetLayout, String> {
    if id <= 0 {
        return Err("widget id must be positive".to_owned());
    }

    let updated = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        let mut widget = db::widgets::get(&connection, id)
            .map_err(|error| format!("failed to read widget: {error}"))?
            .ok_or_else(|| "widget was not found".to_owned())?;
        let normalized =
            sources::normalize_editable_config(&widget.source_kind, &source_config_json)?;
        let found = db::widgets::update_source_config(&connection, id, &normalized)
            .map_err(|error| format!("failed to update widget source configuration: {error}"))?;
        if !found {
            return Err("widget was not found".to_owned());
        }
        widget.source_config_json = normalized;
        widget
    };

    runtime::wake(&state);
    Ok(updated)
}

#[tauri::command]
pub(crate) fn update_widget_refresh_config(
    id: i64,
    refresh_config_json: String,
    state: State<'_, AppState>,
) -> Result<WidgetLayout, String> {
    if id <= 0 {
        return Err("widget id must be positive".to_owned());
    }
    let normalized = refresh_policy::normalize_widget_config(&refresh_config_json)?;

    let updated = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        let mut widget = db::widgets::get(&connection, id)
            .map_err(|error| format!("failed to read widget: {error}"))?
            .ok_or_else(|| "widget was not found".to_owned())?;
        let found = db::widgets::update_refresh_config(&connection, id, &normalized)
            .map_err(|error| format!("failed to update widget refresh configuration: {error}"))?;
        if !found {
            return Err("widget was not found".to_owned());
        }
        widget.refresh_config_json = normalized;
        widget
    };

    runtime::wake(&state);
    Ok(updated)
}

#[tauri::command]
pub(crate) fn update_widget_geometry(
    id: i64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if id <= 0 {
        return Err("widget id must be positive".to_owned());
    }
    validate_grid_geometry(x, y, width, height)?;

    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    reject_overlap(&connection, Some(id), x, y, width, height)?;
    let found = db::widgets::update_geometry(&connection, id, x, y, width, height)
        .map_err(|error| format!("failed to update widget geometry: {error}"))?;
    if !found {
        return Err("widget was not found".to_owned());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_widget(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    if id <= 0 {
        return Err("widget id must be positive".to_owned());
    }

    {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        let found = db::widgets::delete(&connection, id)
            .map_err(|error| format!("failed to delete widget: {error}"))?;
        if !found {
            return Err("widget was not found".to_owned());
        }
    }
    runtime::wake(&state);
    Ok(())
}

#[tauri::command]
pub(crate) fn refresh_widget(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    runtime::request_manual_for_widget(id, &state)
}

fn read_shell_status(state: &AppState) -> Result<ShellStatus, String> {
    state
        .shell
        .lock()
        .map(|shell| shell.clone())
        .map_err(|_| "shell status lock was poisoned".to_owned())
}

fn update_shortcut_status(
    state: &AppState,
    global_shortcut: String,
    global_shortcut_error: Option<String>,
) -> Result<ShellStatus, String> {
    let mut shell = state
        .shell
        .lock()
        .map_err(|_| "shell status lock was poisoned".to_owned())?;
    shell.global_shortcut = global_shortcut;
    shell.global_shortcut_error = global_shortcut_error;
    Ok(shell.clone())
}

fn persist_shortcut(state: &AppState, shortcut: &str) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    db::set_setting(&connection, GLOBAL_SHORTCUT_SETTING_KEY, shortcut)
        .map_err(|error| error.to_string())
}

pub(crate) fn publish_shell_status(app: &AppHandle, status: &ShellStatus) {
    if let Err(error) = app.emit(SHELL_STATUS_CHANGED_EVENT, status.clone()) {
        eprintln!("failed to emit shell status: {error}");
    }
}

fn normalize_shortcut(shortcut: &str) -> Result<String, String> {
    let shortcut = shortcut.trim();
    if shortcut.is_empty() {
        return Err("global shortcut cannot be empty".to_owned());
    }
    if shortcut.len() > MAX_SHORTCUT_LENGTH {
        return Err("global shortcut is too long".to_owned());
    }
    Ok(shortcut.to_owned())
}

fn validate_source_kind(source_kind: &str) -> Result<(), String> {
    if sources::is_supported(source_kind) {
        Ok(())
    } else {
        Err("this source does not have a working adapter yet".to_owned())
    }
}

fn is_grid_integer(value: f64) -> bool {
    value.is_finite() && value.fract().abs() < f64::EPSILON
}

fn validate_grid_geometry(x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let valid = [x, y, width, height].into_iter().all(is_grid_integer)
        && x >= 0.0
        && y >= 0.0
        && width >= MIN_WIDGET_GRID_SIZE
        && height >= MIN_WIDGET_GRID_SIZE
        && x + width <= GRID_COLUMNS
        && y + height <= GRID_ROWS;
    if valid {
        Ok(())
    } else {
        Err("widget geometry must be an integer rectangle inside the 12x8 Board grid".to_owned())
    }
}

fn rectangles_overlap(first: (f64, f64, f64, f64), second: (f64, f64, f64, f64)) -> bool {
    let (ax, ay, aw, ah) = first;
    let (bx, by, bw, bh) = second;
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

fn reject_overlap(
    connection: &rusqlite::Connection,
    excluded_id: Option<i64>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let widgets = db::widgets::list(connection)
        .map_err(|error| format!("failed to validate Board geometry: {error}"))?;
    if widgets.iter().any(|widget| {
        Some(widget.id) != excluded_id
            && validate_grid_geometry(widget.x, widget.y, widget.width, widget.height).is_ok()
            && rectangles_overlap(
                (x, y, width, height),
                (widget.x, widget.y, widget.width, widget.height),
            )
    }) {
        Err("widget geometry overlaps another widget".to_owned())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_normalization_is_bounded_and_trimmed() {
        assert_eq!(
            normalize_shortcut("  Ctrl+Shift+K  ").unwrap(),
            "Ctrl+Shift+K"
        );
        assert!(normalize_shortcut("   ").is_err());
        assert!(normalize_shortcut(&"x".repeat(MAX_SHORTCUT_LENGTH + 1)).is_err());
    }

    #[test]
    fn source_validation_only_accepts_live_adapters() {
        for source_kind in ["arxiv", "wikipedia", "qiita", "zenn", "youtube"] {
            assert!(validate_source_kind(source_kind).is_ok(), "{source_kind}");
        }
        assert!(validate_source_kind("nhk").is_err());
        assert!(validate_source_kind("unknown").is_err());
    }

    #[test]
    fn grid_geometry_is_integer_and_bounded() {
        assert!(validate_grid_geometry(0.0, 0.0, 4.0, 3.0).is_ok());
        assert!(validate_grid_geometry(11.0, 7.0, 1.0, 1.0).is_ok());
        assert!(validate_grid_geometry(-1.0, 0.0, 4.0, 3.0).is_err());
        assert!(validate_grid_geometry(0.5, 0.0, 4.0, 3.0).is_err());
        assert!(validate_grid_geometry(10.0, 0.0, 3.0, 2.0).is_err());
        assert!(validate_grid_geometry(0.0, 0.0, 0.0, 2.0).is_err());
    }

    #[test]
    fn touching_rectangles_do_not_overlap_but_intersections_do() {
        assert!(!rectangles_overlap(
            (0.0, 0.0, 2.0, 2.0),
            (2.0, 0.0, 2.0, 2.0)
        ));
        assert!(rectangles_overlap(
            (0.0, 0.0, 2.0, 2.0),
            (1.0, 1.0, 2.0, 2.0)
        ));
    }
}
