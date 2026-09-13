use rusqlite::{Connection, Error, Result};

const CURRENT_SCHEMA_VERSION: i64 = 2;

pub(crate) fn run(connection: &Connection) -> Result<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    match version {
        0 => {
            connection.execute_batch(
                "BEGIN IMMEDIATE;\n                 CREATE TABLE settings (\n                   key TEXT PRIMARY KEY NOT NULL,\n                   value TEXT NOT NULL\n                 );\n                 CREATE TABLE widgets (\n                   id INTEGER PRIMARY KEY AUTOINCREMENT,\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   refresh_config_json TEXT NOT NULL DEFAULT '{}',\n                   x REAL NOT NULL,\n                   y REAL NOT NULL,\n                   width REAL NOT NULL CHECK(width > 0),\n                   height REAL NOT NULL CHECK(height > 0),\n                   display_mode TEXT NOT NULL DEFAULT 'minimal'\n                 );\n                 PRAGMA user_version = 2;\n                 COMMIT;",
            )?;
        }
        1 => {
            connection.execute_batch(
                "BEGIN IMMEDIATE;\n                 CREATE TABLE widgets (\n                   id INTEGER PRIMARY KEY AUTOINCREMENT,\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   refresh_config_json TEXT NOT NULL DEFAULT '{}',\n                   x REAL NOT NULL,\n                   y REAL NOT NULL,\n                   width REAL NOT NULL CHECK(width > 0),\n                   height REAL NOT NULL CHECK(height > 0),\n                   display_mode TEXT NOT NULL DEFAULT 'minimal'\n                 );\n                 PRAGMA user_version = 2;\n                 COMMIT;",
            )?;
        }
        CURRENT_SCHEMA_VERSION => {}
        _ => return Err(Error::InvalidQuery),
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_reaches_current_schema() {
        let connection = Connection::open_in_memory().expect("SQLite should open");
        run(&connection).expect("migration should succeed");

        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("schema version should be readable");
        assert_eq!(version, CURRENT_SCHEMA_VERSION);

        let widget_table_exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'widgets'",
                [],
                |row| row.get(0),
            )
            .expect("sqlite_master should be readable");
        assert_eq!(widget_table_exists, 1);
    }

    #[test]
    fn version_one_database_upgrades_without_losing_settings() {
        let connection = Connection::open_in_memory().expect("SQLite should open");
        connection
            .execute_batch(
                "CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);\n                 INSERT INTO settings (key, value) VALUES ('keep.me', 'yes');\n                 PRAGMA user_version = 1;",
            )
            .expect("version-one fixture should be created");

        run(&connection).expect("upgrade should succeed");

        let value: String = connection
            .query_row("SELECT value FROM settings WHERE key = 'keep.me'", [], |row| row.get(0))
            .expect("existing setting should survive");
        assert_eq!(value, "yes");
    }
}
