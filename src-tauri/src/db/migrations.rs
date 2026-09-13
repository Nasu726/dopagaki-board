use rusqlite::{Connection, Error, Result};

const CURRENT_SCHEMA_VERSION: i64 = 1;

pub(crate) fn run(connection: &Connection) -> Result<()> {
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    match version {
        0 => {
            connection.execute_batch(
                "BEGIN IMMEDIATE;\n                 CREATE TABLE settings (\n                   key TEXT PRIMARY KEY NOT NULL,\n                   value TEXT NOT NULL\n                 );\n                 PRAGMA user_version = 1;\n                 COMMIT;",
            )?;
        }
        CURRENT_SCHEMA_VERSION => {}
        _ => return Err(Error::InvalidQuery),
    }

    Ok(())
}
