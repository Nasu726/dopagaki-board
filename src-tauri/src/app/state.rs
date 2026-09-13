use rusqlite::Connection;
use std::sync::Mutex;

pub(crate) struct AppState {
    pub(crate) db: Mutex<Connection>,
}

impl AppState {
    pub(crate) fn new(connection: Connection) -> Self {
        Self {
            db: Mutex::new(connection),
        }
    }
}
