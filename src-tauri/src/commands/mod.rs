use crate::{app::AppState, db};
use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

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
