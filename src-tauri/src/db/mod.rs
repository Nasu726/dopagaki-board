pub(crate) mod cache;
pub(crate) mod migrations;
pub(crate) mod widgets;

use rusqlite::{params, Connection, OptionalExtension, Result};
use std::{path::Path, time::Duration};

pub(crate) fn open(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(2))?;
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    migrations::run(&connection)?;
    Ok(connection)
}

pub(crate) fn set_setting(connection: &Connection, key: &str, value: &str) -> Result<()> {
    connection.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)\n         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub(crate) fn get_setting(connection: &Connection, key: &str) -> Result<Option<String>> {
    connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setting_roundtrip_works_after_migration() {
        let connection = Connection::open_in_memory().expect("in-memory SQLite should open");
        migrations::run(&connection).expect("migration should succeed");

        set_setting(&connection, "test.key", "test-value").expect("setting should write");
        let value = get_setting(&connection, "test.key").expect("setting should read");

        assert_eq!(value.as_deref(), Some("test-value"));
    }
}
