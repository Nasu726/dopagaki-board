mod app;
mod commands;
mod db;

use std::fs;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("dopagaki-board.sqlite3");
            let connection = db::open(&db_path)?;
            app.manage(app::AppState::new(connection));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::bootstrap_probe])
        .run(tauri::generate_context!())
        .expect("failed to run dopagaki-board");
}
