use rusqlite::{params, Connection, Result};
use serde::Serialize;

pub(crate) const DEMO_SEED_SETTING_KEY: &str = "cache.demo_seeded_v1";

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

pub(crate) fn seed_demo_items(connection: &Connection, now: i64) -> Result<()> {
    let items = [
        (
            "demo:youtube:1",
            "youtube",
            "https://www.youtube.com/",
            "Subscribed channel placeholder",
            100.0,
        ),
        (
            "demo:arxiv:1",
            "arxiv",
            "https://arxiv.org/",
            "Interesting paper placeholder",
            90.0,
        ),
        (
            "demo:wikipedia:1",
            "wikipedia",
            "https://ja.wikipedia.org/",
            "今日のおすすめ placeholder",
            80.0,
        ),
        (
            "demo:zenn:1",
            "zenn",
            "https://zenn.dev/",
            "Zenn article placeholder",
            70.0,
        ),
        (
            "demo:qiita:1",
            "qiita",
            "https://qiita.com/",
            "Qiita article placeholder",
            60.0,
        ),
        (
            "demo:nhk:1",
            "nhk",
            "https://www3.nhk.or.jp/news/",
            "NHK News placeholder",
            50.0,
        ),
    ];

    for (id, source_kind, external_url, title, score) in items {
        connection.execute(
            "INSERT OR IGNORE INTO feed_items (\n               id, source_kind, source_config_json, external_url, title, fetched_at, score, is_unseen\n             ) VALUES (?1, ?2, '{}', ?3, ?4, ?5, ?6, 1)",
            params![id, source_kind, external_url, title, now, score],
        )?;
    }

    Ok(())
}

pub(crate) fn list_top(connection: &Connection, limit: usize) -> Result<Vec<CachedItem>> {
    let limit = i64::try_from(limit.min(100)).unwrap_or(100);
    let mut statement = connection.prepare(
        "SELECT id, source_kind, source_config_json, external_url, title, image_url, author,\n                published_at, fetched_at, score, is_unseen\n         FROM feed_items\n         ORDER BY is_unseen DESC, score DESC, fetched_at DESC\n         LIMIT ?1",
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

pub(crate) fn has_unseen(connection: &Connection) -> Result<bool> {
    connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM feed_items WHERE is_unseen = 1)",
        [],
        |row| row.get(0),
    )
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
    use crate::db::migrations;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("SQLite should open");
        migrations::run(&connection).expect("migration should succeed");
        connection
    }

    #[test]
    fn demo_cache_is_immediately_readable_without_network() {
        let connection = database();
        seed_demo_items(&connection, 123).expect("demo cache should seed");

        let items = list_top(&connection, 3).expect("cache should read");
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].source_kind, "youtube");
        assert!(items.iter().all(|item| item.fetched_at == 123));
    }

    #[test]
    fn source_query_and_seen_state_work() {
        let connection = database();
        seed_demo_items(&connection, 123).expect("demo cache should seed");

        let arxiv = list_for_source(&connection, "arxiv", "{}", 5).expect("source should read");
        assert_eq!(arxiv.len(), 1);
        assert!(has_unseen(&connection).expect("unseen should read"));

        mark_seen(&connection, &[arxiv[0].id.clone()]).expect("seen should update");
        let arxiv = list_for_source(&connection, "arxiv", "{}", 5).expect("source should read");
        assert!(!arxiv[0].is_unseen);
    }

    #[test]
    fn seeding_is_idempotent() {
        let connection = database();
        seed_demo_items(&connection, 100).expect("first seed should succeed");
        seed_demo_items(&connection, 200).expect("second seed should succeed");

        let items = list_top(&connection, 100).expect("cache should read");
        assert_eq!(items.len(), 6);
        assert!(items.iter().all(|item| item.fetched_at == 100));
    }
}
