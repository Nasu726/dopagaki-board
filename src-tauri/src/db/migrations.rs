use rusqlite::{Connection, Error, Result};

const CURRENT_SCHEMA_VERSION: i64 = 3;

pub(crate) fn run(connection: &Connection) -> Result<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    match version {
        0 => {
            connection.execute_batch(
                "BEGIN IMMEDIATE;\n                 CREATE TABLE settings (\n                   key TEXT PRIMARY KEY NOT NULL,\n                   value TEXT NOT NULL\n                 );\n                 CREATE TABLE widgets (\n                   id INTEGER PRIMARY KEY AUTOINCREMENT,\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   refresh_config_json TEXT NOT NULL DEFAULT '{}',\n                   x REAL NOT NULL,\n                   y REAL NOT NULL,\n                   width REAL NOT NULL CHECK(width > 0),\n                   height REAL NOT NULL CHECK(height > 0),\n                   display_mode TEXT NOT NULL DEFAULT 'minimal'\n                 );\n                 CREATE TABLE feed_items (\n                   id TEXT PRIMARY KEY NOT NULL,\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   external_url TEXT NOT NULL,\n                   title TEXT,\n                   image_url TEXT,\n                   author TEXT,\n                   published_at INTEGER,\n                   fetched_at INTEGER NOT NULL,\n                   score REAL NOT NULL DEFAULT 0,\n                   is_unseen INTEGER NOT NULL DEFAULT 1 CHECK(is_unseen IN (0, 1)),\n                   payload_json TEXT NOT NULL DEFAULT '{}'\n                 );\n                 CREATE INDEX feed_items_source_rank_idx\n                   ON feed_items(source_kind, source_config_json, is_unseen DESC, score DESC, fetched_at DESC);\n                 CREATE TABLE source_refresh_state (\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   last_attempt INTEGER,\n                   last_success INTEGER,\n                   failure_count INTEGER NOT NULL DEFAULT 0,\n                   blocked_until INTEGER,\n                   etag TEXT,\n                   last_modified TEXT,\n                   PRIMARY KEY(source_kind, source_config_json)\n                 );\n                 PRAGMA user_version = 3;\n                 COMMIT;",
            )?;
        }
        1 => {
            connection.execute_batch(
                "BEGIN IMMEDIATE;\n                 CREATE TABLE widgets (\n                   id INTEGER PRIMARY KEY AUTOINCREMENT,\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   refresh_config_json TEXT NOT NULL DEFAULT '{}',\n                   x REAL NOT NULL,\n                   y REAL NOT NULL,\n                   width REAL NOT NULL CHECK(width > 0),\n                   height REAL NOT NULL CHECK(height > 0),\n                   display_mode TEXT NOT NULL DEFAULT 'minimal'\n                 );\n                 CREATE TABLE feed_items (\n                   id TEXT PRIMARY KEY NOT NULL,\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   external_url TEXT NOT NULL,\n                   title TEXT,\n                   image_url TEXT,\n                   author TEXT,\n                   published_at INTEGER,\n                   fetched_at INTEGER NOT NULL,\n                   score REAL NOT NULL DEFAULT 0,\n                   is_unseen INTEGER NOT NULL DEFAULT 1 CHECK(is_unseen IN (0, 1)),\n                   payload_json TEXT NOT NULL DEFAULT '{}'\n                 );\n                 CREATE INDEX feed_items_source_rank_idx\n                   ON feed_items(source_kind, source_config_json, is_unseen DESC, score DESC, fetched_at DESC);\n                 CREATE TABLE source_refresh_state (\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   last_attempt INTEGER,\n                   last_success INTEGER,\n                   failure_count INTEGER NOT NULL DEFAULT 0,\n                   blocked_until INTEGER,\n                   etag TEXT,\n                   last_modified TEXT,\n                   PRIMARY KEY(source_kind, source_config_json)\n                 );\n                 PRAGMA user_version = 3;\n                 COMMIT;",
            )?;
        }
        2 => {
            connection.execute_batch(
                "BEGIN IMMEDIATE;\n                 CREATE TABLE feed_items (\n                   id TEXT PRIMARY KEY NOT NULL,\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   external_url TEXT NOT NULL,\n                   title TEXT,\n                   image_url TEXT,\n                   author TEXT,\n                   published_at INTEGER,\n                   fetched_at INTEGER NOT NULL,\n                   score REAL NOT NULL DEFAULT 0,\n                   is_unseen INTEGER NOT NULL DEFAULT 1 CHECK(is_unseen IN (0, 1)),\n                   payload_json TEXT NOT NULL DEFAULT '{}'\n                 );\n                 CREATE INDEX feed_items_source_rank_idx\n                   ON feed_items(source_kind, source_config_json, is_unseen DESC, score DESC, fetched_at DESC);\n                 CREATE TABLE source_refresh_state (\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   last_attempt INTEGER,\n                   last_success INTEGER,\n                   failure_count INTEGER NOT NULL DEFAULT 0,\n                   blocked_until INTEGER,\n                   etag TEXT,\n                   last_modified TEXT,\n                   PRIMARY KEY(source_kind, source_config_json)\n                 );\n                 PRAGMA user_version = 3;\n                 COMMIT;",
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

    fn table_exists(connection: &Connection, name: &str) -> i64 {
        connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [name],
                |row| row.get(0),
            )
            .expect("sqlite_master should be readable")
    }

    #[test]
    fn fresh_database_reaches_current_schema() {
        let connection = Connection::open_in_memory().expect("SQLite should open");
        run(&connection).expect("migration should succeed");

        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("schema version should be readable");
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        assert_eq!(table_exists(&connection, "widgets"), 1);
        assert_eq!(table_exists(&connection, "feed_items"), 1);
        assert_eq!(table_exists(&connection, "source_refresh_state"), 1);
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
            .query_row(
                "SELECT value FROM settings WHERE key = 'keep.me'",
                [],
                |row| row.get(0),
            )
            .expect("existing setting should survive");
        assert_eq!(value, "yes");
        assert_eq!(table_exists(&connection, "feed_items"), 1);
    }

    #[test]
    fn version_two_database_keeps_widgets_while_adding_cache_tables() {
        let connection = Connection::open_in_memory().expect("SQLite should open");
        connection
            .execute_batch(
                "CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);\n                 CREATE TABLE widgets (\n                   id INTEGER PRIMARY KEY AUTOINCREMENT,\n                   source_kind TEXT NOT NULL,\n                   source_config_json TEXT NOT NULL DEFAULT '{}',\n                   refresh_config_json TEXT NOT NULL DEFAULT '{}',\n                   x REAL NOT NULL,\n                   y REAL NOT NULL,\n                   width REAL NOT NULL CHECK(width > 0),\n                   height REAL NOT NULL CHECK(height > 0),\n                   display_mode TEXT NOT NULL DEFAULT 'minimal'\n                 );\n                 INSERT INTO widgets (source_kind, x, y, width, height)\n                 VALUES ('arxiv', 10, 20, 280, 180);\n                 PRAGMA user_version = 2;",
            )
            .expect("version-two fixture should be created");

        run(&connection).expect("upgrade should succeed");

        let widget_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM widgets", [], |row| row.get(0))
            .expect("widgets should remain readable");
        assert_eq!(widget_count, 1);
        assert_eq!(table_exists(&connection, "feed_items"), 1);
        assert_eq!(table_exists(&connection, "source_refresh_state"), 1);
    }
}
