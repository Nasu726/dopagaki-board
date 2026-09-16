use super::{AppState, ViewEvent, ViewState};
use crate::db;
use tauri::{AppHandle, Emitter, LogicalSize, Manager};

const MAIN_WINDOW: &str = "main";
const IDLE_SIZE: (f64, f64) = (64.0, 64.0);
const COMPACT_SIZE: (f64, f64) = (360.0, 480.0);
const BOARD_SIZE: (f64, f64) = (920.0, 680.0);
const VIEW_CHANGED_EVENT: &str = "view-state-changed";
const SHELL_STATUS_CHANGED_EVENT: &str = "shell-status-changed";

pub(crate) fn current(app: &AppHandle) -> Result<ViewState, String> {
    app.state::<AppState>()
        .view
        .lock()
        .map(|view| *view)
        .map_err(|_| "view state lock was poisoned".to_owned())
}

pub(crate) fn apply_current(app: &AppHandle) -> Result<(), String> {
    apply_view_state(app, current(app)?)
}

pub(crate) fn transition(app: &AppHandle, event: ViewEvent) -> Result<ViewState, String> {
    let state = app.state::<AppState>();
    let mut view = state
        .view
        .lock()
        .map_err(|_| "view state lock was poisoned".to_owned())?;

    let next = view.transition(event);
    apply_view_state(app, next)?;
    *view = next;
    drop(view);

    app.emit(VIEW_CHANGED_EVENT, next)
        .map_err(|error| format!("failed to emit view state: {error}"))?;

    if next == ViewState::Board {
        acknowledge_board_content(app)?;
    }

    Ok(next)
}

fn acknowledge_board_content(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (next, status_changed) = {
        let connection = state
            .db
            .lock()
            .map_err(|_| "database lock was poisoned".to_owned())?;
        db::cache::mark_active_widget_items_seen(&connection)
            .map_err(|error| format!("failed to acknowledge Board cache: {error}"))?;

        let mut shell = state
            .shell
            .lock()
            .map_err(|_| "shell status lock was poisoned".to_owned())?;
        let status_changed = shell.has_unseen;
        shell.has_unseen = false;
        (shell.clone(), status_changed)
    };

    if status_changed {
        app.emit(SHELL_STATUS_CHANGED_EVENT, next)
            .map_err(|error| format!("failed to emit shell status: {error}"))?;
    }
    Ok(())
}

fn apply_view_state(app: &AppHandle, view: ViewState) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| "main window is unavailable".to_owned())?;

    match view {
        ViewState::Hidden => window
            .hide()
            .map_err(|error| format!("failed to hide window: {error}")),
        ViewState::Idle => {
            window
                .set_decorations(false)
                .map_err(|error| format!("failed to remove window decorations: {error}"))?;
            set_native_shadow(&window, false)?;
            window
                .set_resizable(false)
                .map_err(|error| format!("failed to lock Idle size: {error}"))?;
            window
                .set_size(LogicalSize::new(IDLE_SIZE.0, IDLE_SIZE.1))
                .map_err(|error| format!("failed to resize Idle window: {error}"))?;
            window
                .show()
                .map_err(|error| format!("failed to show Idle window: {error}"))
        }
        ViewState::Compact => {
            window
                .set_decorations(false)
                .map_err(|error| format!("failed to remove window decorations: {error}"))?;
            set_native_shadow(&window, true)?;
            window
                .set_resizable(false)
                .map_err(|error| format!("failed to lock Compact size: {error}"))?;
            window
                .set_size(LogicalSize::new(COMPACT_SIZE.0, COMPACT_SIZE.1))
                .map_err(|error| format!("failed to resize Compact window: {error}"))?;
            window
                .show()
                .map_err(|error| format!("failed to show Compact window: {error}"))?;
            window
                .set_focus()
                .map_err(|error| format!("failed to focus Compact window: {error}"))
        }
        ViewState::Board => {
            window
                .set_decorations(false)
                .map_err(|error| format!("failed to remove window decorations: {error}"))?;
            set_native_shadow(&window, true)?;
            window
                .set_resizable(true)
                .map_err(|error| format!("failed to enable Board resizing: {error}"))?;
            window
                .set_size(LogicalSize::new(BOARD_SIZE.0, BOARD_SIZE.1))
                .map_err(|error| format!("failed to resize Board window: {error}"))?;
            window
                .show()
                .map_err(|error| format!("failed to show Board window: {error}"))?;
            window
                .set_focus()
                .map_err(|error| format!("failed to focus Board window: {error}"))
        }
    }
}

fn set_native_shadow(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        window
            .set_shadow(enabled)
            .map_err(|error| format!("failed to update native window shadow: {error}"))?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _ = (window, enabled);

    Ok(())
}
