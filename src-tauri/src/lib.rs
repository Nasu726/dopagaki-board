mod app;
mod commands;
mod db;
mod refresh_policy;
mod refresh_settings;
mod runtime;
mod scheduler;
mod source_config;
mod sources;

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

            // Early MVP builds seeded fake source rows so cache-first UI could be
            // exercised before an adapter existed. They must never leak into the
            // practical product once real adapters are available.
            connection.execute("DELETE FROM feed_items WHERE id LIKE 'demo:%'", [])?;

            let global_shortcut = db::get_setting(&connection, app::GLOBAL_SHORTCUT_SETTING_KEY)?
                .unwrap_or_else(|| app::DEFAULT_GLOBAL_SHORTCUT.to_owned());
            let has_unseen = db::cache::has_unseen(&connection)?;
            let mut shell = app::ShellStatus::new(global_shortcut.clone(), None);
            shell.has_unseen = has_unseen;

            app.manage(app::AppState::new(connection, shell));

            if let Err(error) = app.global_shortcut().register(global_shortcut.as_str()) {
                let message = format!("could not register {global_shortcut}: {error}");
                let state = app.state::<app::AppState>();
                match state.shell.lock() {
                    Ok(mut shell) => shell.global_shortcut_error = Some(message),
                    Err(_) => eprintln!(
                        "global shortcut registration failed and shell state lock was poisoned"
                    ),
                };
            }

            if let Err(error) = app::apply_current_view(app.handle()) {
                eprintln!("failed to apply initial view state: {error}");
            }

            if let Err(error) = runtime::start(app.handle().clone()) {
                eprintln!("background refresh runtime is unavailable: {error}");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_view_state,
            commands::transition_view,
            commands::open_content,
            commands::get_shell_status,
            commands::set_global_shortcut,
            commands::list_widgets,
            commands::add_widget,
            commands::update_widget_source_config,
            commands::update_widget_refresh_config,
            commands::update_widget_geometry,
            commands::delete_widget,
            commands::refresh_widget,
            commands::cache_refresh::get_refresh_settings,
            commands::cache_refresh::set_auto_refresh_interval,
            commands::cache_refresh::get_source_refresh_defaults,
            commands::cache_refresh::set_source_refresh_default,
            commands::cache_refresh::list_cached_items,
            commands::cache_refresh::list_compact_items,
            commands::cache_refresh::list_cached_items_for_source,
            commands::cache_refresh::mark_cached_items_seen,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run dopagaki-board");
}
