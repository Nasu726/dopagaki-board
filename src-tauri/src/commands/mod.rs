use crate::{
    app::{self, AppState, ViewEvent, ViewState},
    db,
};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

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
