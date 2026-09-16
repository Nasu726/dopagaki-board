use crate::{db::widgets, sources};
use rusqlite::{params, Connection, Result};
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CachedItem {
    pub(crate) id: String,
    pub(crate) source_kind: String,
    pub(crate) source_config_json: String,
    pub(crate) external_url: String,
    pub(crate) title: Option<String>,
    pub(crate) image_url: Option<String>,
    pub(crate) author: Option<String>,
    pub(crate) published_at: Option<i64>,
    pub(crate) fetched_at: i64,
    pub(crate) score: f64,
    pub(crate) is_unseen: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CacheWriteItem {
    pub(crate) id: String,
    pub(crate) source_kind: String,
    pub(crate) source_config_json: String,
    pub(crate) external_url: String,
    pub(crate) title: Option<String>,
    pub(crate) image_url: Option<String>,
    pub(crate) author: Option<String>,
    pub(crate) published_at: Option<i64>,
    pub(crate) fetched_at: i64,
    pub(crate) score: f64,
    pub(crate) payload_json: String,
}

pub(crate) fn upsert_items(connection: &Connection, items: &[CacheWriteItem]) -> Result<usize> {
    let mut changed = 0;
    let mut statement = connection.prepare(
        "INSERT INTO feed_items (\n           id, source_kind, source_config_json, external_url, title, image_url, author,\n           published_at, fetched_at, score, is_unseen, payload_json\n         ) VALUES (\n           ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,\n           CASE WHEN EXISTS(\n             SELECT 1 FROM feed_items WHERE id = ?1 AND is_unseen = 0\n           ) THEN 0 ELSE 1 END,\n           ?11\n         )\n         ON CONFLICT(source_kind, source_config_json, id) DO UPDATE SET\n           external_url = excluded.external_url,\n           title = excluded.title,\n           image_url = excluded.image_url,\n           author = excluded.author,\n           published_at = excluded.published_at,\n           fetched_at = excluded.fetched_at,\n           score = excluded.score,\n           payload_json = excluded.payload_json",
    )?;

    for item in items {
        changed += statement.execute(params![
            item.id,
            item.source_kind,
            item.source_config_json,
            item.external_url,
            item.title,
            item.image_url,
            item.author,
            item.published_at,
            item.fetched_at,
            item.score,
            item.payload_json,
        ])?;
    }

    Ok(changed)
}

pub(crate) fn list_top(connection: &Connection, limit: usize) -> Result<Vec<CachedItem>> {
    let limit = i64::try_from(limit.min(100)).unwrap_or(100);
    let mut statement = connection.prepare(
        "SELECT id, source_kind, source_config_json, external_url, title, image_url, author,\n                published_at, fetched_at, score, is_unseen\n         FROM (\n           SELECT id, source_kind, source_config_json, external_url, title, image_url, author,\n                  published_at, fetched_at, score, is_unseen,\n                  ROW_NUMBER() OVER (\n                    PARTITION BY id\n                    ORDER BY is_unseen DESC, score DESC, fetched_at DESC, source_kind, source_config_json\n                  ) AS duplicate_rank\n           FROM feed_items\n         )\n         WHERE duplicate_rank = 1\n         ORDER BY is_unseen DESC, score DESC, fetched_at DESC, id\n         LIMIT ?1",
    )?;

    let rows = statement.query_map([limit], map_item)?;
    let items = rows.collect();
    items
}

pub(crate) fn list_for_source(
    connection: &Connection,
    source_kind: &str,
    source_config_json: &str,
    limit: usize,
) -> Result<Vec<CachedItem>> {
    let limit = i64::try_from(limit.min(100)).unwrap_or(100);
    let mut statement = connection.prepare(
        "SELECT id, source_kind, source_config_json, external_url, title, image_url, author,\n                published_at, fetched_at, score, is_unseen\n         FROM feed_items\n         WHERE source_kind = ?1 AND source_config_json = ?2\n         ORDER BY is_unseen DESC, score DESC, fetched_at DESC\n         LIMIT ?3",
    )?;

    let rows = statement.query_map(params![source_kind, source_config_json, limit], map_item)?;
    let items = rows.collect();
    items
}

pub(crate) fn mark_seen(connection: &Connection, ids: &[String]) -> Result<usize> {
    let mut changed = 0;
    for id in ids {
        changed += connection.execute(
            "UPDATE feed_items SET is_unseen = 0 WHERE id = ?1 AND is_unseen = 1",
            [id],
        )?;
    }
    Ok(changed)
}

fn active_source_keys(connection: &Connection) -> Result<Vec<(String, String)>> {
    let stored_widgets = widgets::list(connection)?;
    let mut keys = BTreeSet::new();
    for widget in stored_widgets {
        if !sources::is_supported(&widget.source_kind) {
            continue;
        }
        match sources::normalize_config(&widget.source_kind, &widget.source_config_json) {
            Ok(normalized) => {
                keys.insert((widget.source_kind, normalized));
            }
            Err(error) => {
                eprintln!(
                    "ignoring invalid {} widget configuration while computing unseen state: {error}",
                    widget.source_kind
                );
            }
        }
    }
    Ok(keys.into_iter().collect())
}

pub(crate) fn has_unseen(connection: &Connection) -> Result<bool> {
    let source_keys = active_source_keys(connection)?;
    let mut statement = connection.prepare(
        "SELECT EXISTS(\n           SELECT 1 FROM feed_items\n           WHERE is_unseen = 1 AND source_kind = ?1 AND source_config_json = ?2\n         )",
    )?;
    for (source_kind, source_config_json) in source_keys {
        let found = statement.query_row(params![source_kind, source_config_json], |row| row.get(0))?;
        if found {
            return Ok(true);
        }
    }
    Ok(false)
}

fn map_item(row: &rusqlite::Row<'_>) -> Result<CachedItem> {
    let unseen: i64 = row.get(10)?;
    Ok(CachedItem {
        id: row.get(0)?,
        source_kind: row.get(1)?,
        source_config_json: row.get(2)?,
        external_url: row.get(3)?,
        title: row.get(4)?,
        image_url: row.get(5)?,
        author: row.get(6)?,
        published_at: row.get(7)?,
        fetched_at: row.get(8)?,
        score: row.get(9)?,
        is_unseen: unseen != 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{migrations, widgets};

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("SQLite should open");
        migrations::run(&connection).expect("migration should succeed");
        connection
    }

    fn write_item(config: &str, title: &str, fetched_at: i64) -> CacheWriteItem {
        CacheWriteItem {
            id: "2401.00001".to_owned(),
            source_kind: "arxiv".to_owned(),
            source_config_json: config.to_owned(),
            external_url: "https://arxiv.org/abs/2401.00001".to_owned(),
            title: Some(title.to_owned()),
            image_url: None,
            author: Some("A. Author".to_owned()),
            published_at: None,
            fetched_at,
            score: 10.0,
            payload_json: "{}".to_owned(),
        }
    }

    #[test]
    fn source_query_and_seen_state_work() {
        let connection = database();
        widgets::create(&connection, "arxiv", 0.0, 0.0, 3.0, 2.0)
            .expect("active widget should be created");
        let item = write_item("{}", "Cached paper", 123);
        upsert_items(&connection, &[item]).expect("cache write should succeed");

        let arxiv = list_for_source(&connection, "arxiv", "{}", 5).expect("source should read");
        assert_eq!(arxiv.len(), 1);
        assert_eq!(arxiv[0].title.as_deref(), Some("Cached paper"));
        assert!(has_unseen(&connection).expect("unseen should read"));

        mark_seen(&connection, &[arxiv[0].id.clone()]).expect("seen should update");
        let arxiv = list_for_source(&connection, "arxiv", "{}", 5).expect("source should read");
        assert!(!arxiv[0].is_unseen);
    }

    #[test]
    fn shell_unseen_uses_semantic_active_sources_and_ignores_orphaned_cache() {
        let connection = database();
        let active = write_item("{}", "Visible paper", 10);
        let mut orphaned = write_item(r#"{"query":"cat:cs.LG"}"#, "Orphaned paper", 20);
        orphaned.id = "2401.00002".to_owned();
        upsert_items(&connection, &[active, orphaned]).expect("cache write should succeed");

        assert!(!has_unseen(&connection).expect("cache without widgets must not notify"));
        let widget = widgets::create(&connection, "arxiv", 0.0, 0.0, 3.0, 2.0)
            .expect("active widget should be created");
        widgets::update_source_config(
            &connection,
            widget.id,
            r#"{"maxResults":3,"query":"cat:cs.AI"}"#,
        )
        .expect("legacy explicit defaults should persist");
        assert!(has_unseen(&connection).expect("semantic default source should notify"));

        mark_seen(&connection, &["2401.00001".to_owned()])
            .expect("visible Board item should become seen");
        assert!(!has_unseen(&connection).expect("active cache should now be seen"));

        let orphaned_unseen: i64 = connection
            .query_row(
                "SELECT is_unseen FROM feed_items WHERE id = '2401.00002'",
                [],
                |row| row.get(0),
            )
            .expect("orphaned cache row should remain");
        assert_eq!(orphaned_unseen, 1);
    }

    #[test]
    fn top_cache_deduplicates_same_item_across_source_configs() {
        let connection = database();
        for (config, score) in [
            ("{\"query\":\"graph\"}", 90.0),
            ("{\"query\":\"hypergraph\"}", 100.0),
        ] {
            connection
                .execute(
                    "INSERT INTO feed_items (\n                       id, source_kind, source_config_json, external_url, title, fetched_at, score, is_unseen\n                     ) VALUES (?1, 'arxiv', ?2, ?3, ?4, 123, ?5, 1)",
                    params![
                        "arxiv:paper:1",
                        config,
                        "https://arxiv.org/abs/1",
                        "Shared paper",
                        score
                    ],
                )
                .expect("source-scoped cache row should insert");
        }

        let top = list_top(&connection, 10).expect("top cache should read");
        assert_eq!(top.len(), 1);
        assert_eq!(top[0].source_config_json, "{\"query\":\"hypergraph\"}");

        mark_seen(&connection, &["arxiv:paper:1".to_owned()]).expect("seen should update globally");
        let graph = list_for_source(&connection, "arxiv", "{\"query\":\"graph\"}", 5)
            .expect("first source should read");
        let hypergraph = list_for_source(&connection, "arxiv", "{\"query\":\"hypergraph\"}", 5)
            .expect("second source should read");
        assert!(!graph[0].is_unseen);
        assert!(!hypergraph[0].is_unseen);
    }

    #[test]
    fn refreshing_existing_item_preserves_seen_state() {
        let connection = database();
        let item = write_item("{}", "First title", 10);
        upsert_items(&connection, &[item.clone()]).expect("first write should succeed");
        mark_seen(&connection, &[item.id.clone()]).expect("seen state should update");

        let mut refreshed = item;
        refreshed.title = Some("Updated title".to_owned());
        refreshed.fetched_at = 20;
        upsert_items(&connection, &[refreshed]).expect("refresh write should succeed");

        let items = list_for_source(&connection, "arxiv", "{}", 3).expect("cache should read");
        assert_eq!(items[0].title.as_deref(), Some("Updated title"));
        assert!(!items[0].is_unseen);
    }

    #[test]
    fn new_duplicate_source_row_inherits_global_seen_state() {
        let connection = database();
        let first = write_item("{\"query\":\"cat:cs.AI\"}", "AI copy", 10);
        upsert_items(&connection, &[first]).expect("first write should succeed");
        mark_seen(&connection, &["2401.00001".to_owned()]).expect("seen state should update");

        let second = write_item("{\"query\":\"cat:cs.LG\"}", "ML copy", 20);
        upsert_items(&connection, &[second]).expect("second write should succeed");

        let unseen: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM feed_items WHERE id = '2401.00001' AND is_unseen = 1",
                [],
                |row| row.get(0),
            )
            .expect("seen rows should count");
        assert_eq!(unseen, 0);
    }
}
