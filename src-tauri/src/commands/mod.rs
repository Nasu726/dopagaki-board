pub(crate) mod cache_refresh;

use crate::{
    app::{self, AppState, ShellStatus, ViewEvent, ViewState, GLOBAL_SHORTCUT_SETTING_KEY},
    db::{self, widgets::WidgetLayout},
};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_opener::OpenerExt;

const MIN_WIDGET_WIDTH: f64 = 140.0;
const MIN_WIDGET_HEIGHT: f64 = 96.0;
const MAX_WIDGET_SIZE: f64 = 4096.0;
const MAX_WIDGET_POSITION: f64 = 65_536.0;
const MAX_SHORTCUT_LENGTH: usize = 128;
const SHELL_STATUS_CHANGED_EVENT: &str = "shell-status-changed";
const SOURCE_KINDS: &[&str] = &["youtube", "arxiv", "wikipedia", "nhk", "qiita", "zenn"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BootstrapProbe {
    app_name: &'static str,
    stored_value: String,
}

#[tauri::command]
pub(crate) fn bootstrap_probe(state: State<'_, AppState>) -> Result<BootstrapProbe, String> {
    let probe_value = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock error: {error}"))?
        .as_millis()
        .to_string();

    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;

    db::set_setting(&connection, "bootstrap.probe", &probe_value)
        .map_err(|error| format!("SQLite write failed: {error}"))?;

    let stored_value = db::get_setting(&connection, "bootstrap.probe")
        .map_err(|error| format!("SQLite read failed: {error}"))?
        .ok_or_else(|| "SQLite probe value disappeared after write".to_owned())?;

    Ok(BootstrapProbe {
        app_name: "dopagaki-board",
        stored_value,
    })
}

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
pub(crate) fn set_unseen(
    has_unseen: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ShellStatus, String> {
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
    validate_position(x, y)?;
    validate_size(width, height)?;

    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    db::widgets::create(&connection, &source_kind, x, y, width, height)
        .map_err(|error| format!("failed to create widget: {error}"))
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
    validate_position(x, y)?;
    validate_size(width, height)?;

    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
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

    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    let found = db::widgets::delete(&connection, id)
        .map_err(|error| format!("failed to delete widget: {error}"))?;
    if !found {
        return Err("widget was not found".to_owned());
    }
    Ok(())
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
    if SOURCE_KINDS.contains(&source_kind) {
        Ok(())
    } else {
        Err("unsupported widget source".to_owned())
    }
}

fn validate_position(x: f64, y: f64) -> Result<(), String> {
    let valid = x.is_finite()
        && y.is_finite()
        && (0.0..=MAX_WIDGET_POSITION).contains(&x)
        && (0.0..=MAX_WIDGET_POSITION).contains(&y);
    if valid {
        Ok(())
    } else {
        Err("widget position is outside the supported range".to_owned())
    }
}

fn validate_size(width: f64, height: f64) -> Result<(), String> {
    let valid = width.is_finite()
        && height.is_finite()
        && (MIN_WIDGET_WIDTH..=MAX_WIDGET_SIZE).contains(&width)
        && (MIN_WIDGET_HEIGHT..=MAX_WIDGET_SIZE).contains(&height);
    if valid {
        Ok(())
    } else {
        Err("widget size is outside the supported range".to_owned())
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
    fn source_validation_is_explicit() {
        assert!(validate_source_kind("youtube").is_ok());
        assert!(validate_source_kind("unknown").is_err());
    }

    #[test]
    fn geometry_validation_rejects_invalid_values() {
        assert!(validate_position(0.0, 0.0).is_ok());
        assert!(validate_position(-1.0, 0.0).is_err());
        assert!(validate_position(MAX_WIDGET_POSITION + 1.0, 0.0).is_err());
        assert!(validate_position(f64::NAN, 0.0).is_err());
        assert!(validate_size(280.0, 180.0).is_ok());
        assert!(validate_size(80.0, 180.0).is_err());
        assert!(validate_size(f64::INFINITY, 180.0).is_err());
    }
}
