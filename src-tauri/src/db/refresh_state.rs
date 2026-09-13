use rusqlite::{params, Connection, OptionalExtension, Result};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct SourceRefreshState {
    pub(crate) last_attempt: Option<i64>,
    pub(crate) last_success: Option<i64>,
    pub(crate) failure_count: u32,
    pub(crate) blocked_until: Option<i64>,
}

pub(crate) fn get(
    connection: &Connection,
    source_kind: &str,
    source_config_json: &str,
) -> Result<SourceRefreshState> {
    connection
        .query_row(
            "SELECT last_attempt, last_success, failure_count, blocked_until\n             FROM source_refresh_state\n             WHERE source_kind = ?1 AND source_config_json = ?2",
            params![source_kind, source_config_json],
            |row| {
                let failure_count: i64 = row.get(2)?;
                Ok(SourceRefreshState {
                    last_attempt: row.get(0)?,
                    last_success: row.get(1)?,
                    failure_count: u32::try_from(failure_count.max(0)).unwrap_or(u32::MAX),
                    blocked_until: row.get(3)?,
                })
            },
        )
        .optional()
        .map(|state| state.unwrap_or_default())
}

pub(crate) fn mark_attempt(
    connection: &Connection,
    source_kind: &str,
    source_config_json: &str,
    now: i64,
) -> Result<()> {
    connection.execute(
        "INSERT INTO source_refresh_state (source_kind, source_config_json, last_attempt)\n         VALUES (?1, ?2, ?3)\n         ON CONFLICT(source_kind, source_config_json) DO UPDATE SET\n           last_attempt = excluded.last_attempt",
        params![source_kind, source_config_json, now],
    )?;
    Ok(())
}

pub(crate) fn mark_success(
    connection: &Connection,
    source_kind: &str,
    source_config_json: &str,
    now: i64,
) -> Result<()> {
    connection.execute(
        "INSERT INTO source_refresh_state (\n           source_kind, source_config_json, last_attempt, last_success, failure_count, blocked_until\n         ) VALUES (?1, ?2, ?3, ?3, 0, NULL)\n         ON CONFLICT(source_kind, source_config_json) DO UPDATE SET\n           last_success = excluded.last_success,\n           failure_count = 0,\n           blocked_until = NULL",
        params![source_kind, source_config_json, now],
    )?;
    Ok(())
}

pub(crate) fn mark_failure(
    connection: &Connection,
    source_kind: &str,
    source_config_json: &str,
    now: i64,
    failure_count: u32,
    blocked_until: Option<i64>,
) -> Result<()> {
    connection.execute(
        "INSERT INTO source_refresh_state (\n           source_kind, source_config_json, last_attempt, failure_count, blocked_until\n         ) VALUES (?1, ?2, ?3, ?4, ?5)\n         ON CONFLICT(source_kind, source_config_json) DO UPDATE SET\n           failure_count = excluded.failure_count,\n           blocked_until = excluded.blocked_until",
        params![
            source_kind,
            source_config_json,
            now,
            i64::from(failure_count),
            blocked_until
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("SQLite should open");
        migrations::run(&connection).expect("migration should succeed");
        connection
    }

    #[test]
    fn refresh_state_roundtrip_preserves_attempt_time_and_outcome_history() {
        let connection = database();
        let empty = get(&connection, "arxiv", "{}").expect("empty state should read");
        assert_eq!(empty, SourceRefreshState::default());

        mark_attempt(&connection, "arxiv", "{}", 10).expect("attempt should persist");
        let attempted = get(&connection, "arxiv", "{}").expect("attempt should read");
        assert_eq!(attempted.last_attempt, Some(10));
        assert_eq!(attempted.last_success, None);

        mark_failure(&connection, "arxiv", "{}", 11, 2, Some(131)).expect("failure should persist");
        let failed = get(&connection, "arxiv", "{}").expect("failure should read");
        assert_eq!(failed.last_attempt, Some(10));
        assert_eq!(failed.failure_count, 2);
        assert_eq!(failed.blocked_until, Some(131));

        mark_attempt(&connection, "arxiv", "{}", 200).expect("next attempt should persist");
        mark_success(&connection, "arxiv", "{}", 201).expect("success should persist");
        let succeeded = get(&connection, "arxiv", "{}").expect("success should read");
        assert_eq!(succeeded.last_attempt, Some(200));
        assert_eq!(succeeded.last_success, Some(201));
        assert_eq!(succeeded.failure_count, 0);
        assert_eq!(succeeded.blocked_until, None);
    }
}
