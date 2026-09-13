mod app;
mod commands;
mod db;

use std::fs;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Err(error) = app::transition_view(app, app::ViewEvent::GlobalToggle)
                        {
                            eprintln!("global shortcut transition failed: {error}");
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&app_data_dir)?;

            let db_path = app_data_dir.join("dopagaki-board.sqlite3");
            let connection = db::open(&db_path)?;
            let global_shortcut = db::get_setting(&connection, app::GLOBAL_SHORTCUT_SETTING_KEY)?
                .unwrap_or_else(|| app::DEFAULT_GLOBAL_SHORTCUT.to_owned());

            app.manage(app::AppState::new(
                connection,
                app::ShellStatus::new(global_shortcut.clone(), None),
            ));

            if let Err(error) = app.global_shortcut().register(global_shortcut.as_str()) {
                let message = format!("could not register {global_shortcut}: {error}");
                let state = app.state::<app::AppState>();
                match state.shell.lock() {
                    Ok(mut shell) => shell.global_shortcut_error = Some(message),
                    Err(_) => eprintln!("global shortcut registration failed and shell state lock was poisoned"),
                }
            }

            if let Err(error) = app::apply_current_view(app.handle()) {
                eprintln!("failed to apply initial view state: {error}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::bootstrap_probe,
            commands::get_view_state,
            commands::transition_view,
            commands::open_content,
            commands::get_shell_status,
            commands::set_global_shortcut,
            commands::set_unseen,
            commands::list_widgets,
            commands::add_widget,
            commands::update_widget_geometry,
            commands::delete_widget,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run dopagaki-board");
}
