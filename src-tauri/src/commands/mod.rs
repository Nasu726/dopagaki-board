use crate::{
    app::{self, AppState, ViewEvent, ViewState},
    db::{self, widgets::WidgetLayout},
};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_WIDGET_WIDTH: f64 = 280.0;
const DEFAULT_WIDGET_HEIGHT: f64 = 180.0;
const MIN_WIDGET_WIDTH: f64 = 140.0;
const MIN_WIDGET_HEIGHT: f64 = 96.0;
const MAX_WIDGET_SIZE: f64 = 4096.0;
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
pub(crate) fn transition_view(
    event: ViewEvent,
    app: AppHandle,
) -> Result<ViewState, String> {
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
    state: State<'_, AppState>,
) -> Result<WidgetLayout, String> {
    validate_source_kind(&source_kind)?;
    validate_position(x, y)?;

    let connection = state
        .db
        .lock()
        .map_err(|_| "database lock was poisoned".to_owned())?;
    db::widgets::create(
        &connection,
        &source_kind,
        x,
        y,
        DEFAULT_WIDGET_WIDTH,
        DEFAULT_WIDGET_HEIGHT,
    )
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

fn validate_source_kind(source_kind: &str) -> Result<(), String> {
    if SOURCE_KINDS.contains(&source_kind) {
        Ok(())
    } else {
        Err("unsupported widget source".to_owned())
    }
}

fn validate_position(x: f64, y: f64) -> Result<(), String> {
    if x.is_finite() && y.is_finite() && x >= 0.0 && y >= 0.0 {
        Ok(())
    } else {
        Err("widget position must be finite and non-negative".to_owned())
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
    fn source_validation_is_explicit() {
        assert!(validate_source_kind("youtube").is_ok());
        assert!(validate_source_kind("unknown").is_err());
    }

    #[test]
    fn geometry_validation_rejects_invalid_values() {
        assert!(validate_position(0.0, 0.0).is_ok());
        assert!(validate_position(-1.0, 0.0).is_err());
        assert!(validate_position(f64::NAN, 0.0).is_err());
        assert!(validate_size(280.0, 180.0).is_ok());
        assert!(validate_size(80.0, 180.0).is_err());
        assert!(validate_size(f64::INFINITY, 180.0).is_err());
    }
}
