use super::ViewState;
use rusqlite::Connection;
use std::sync::Mutex;

pub(crate) struct AppState {
    pub(crate) db: Mutex<Connection>,
    pub(crate) view: Mutex<ViewState>,
}

impl AppState {
    pub(crate) fn new(connection: Connection) -> Self {
        Self {
            db: Mutex::new(connection),
            view: Mutex::new(ViewState::default()),
        }
    }
}
