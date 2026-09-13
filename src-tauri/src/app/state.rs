use super::ViewState;
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;

pub(crate) const DEFAULT_GLOBAL_SHORTCUT: &str = "CmdOrCtrl+Shift+Space";
pub(crate) const GLOBAL_SHORTCUT_SETTING_KEY: &str = "shell.global_shortcut";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellStatus {
    pub(crate) has_unseen: bool,
    pub(crate) global_shortcut: String,
    pub(crate) global_shortcut_error: Option<String>,
}

impl ShellStatus {
    pub(crate) fn new(global_shortcut: String, global_shortcut_error: Option<String>) -> Self {
        Self {
            has_unseen: false,
            global_shortcut,
            global_shortcut_error,
        }
    }
}

pub(crate) struct AppState {
    pub(crate) db: Mutex<Connection>,
    pub(crate) view: Mutex<ViewState>,
    pub(crate) shell: Mutex<ShellStatus>,
    pub(crate) shortcut_change: Mutex<()>,
}

impl AppState {
    pub(crate) fn new(connection: Connection, shell: ShellStatus) -> Self {
        Self {
            db: Mutex::new(connection),
            view: Mutex::new(ViewState::default()),
            shell: Mutex::new(shell),
            shortcut_change: Mutex::new(()),
        }
    }
}
