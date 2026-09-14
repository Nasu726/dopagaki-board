use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WidgetLayout {
    pub(crate) id: i64,
    pub(crate) source_kind: String,
    pub(crate) source_config_json: String,
    pub(crate) refresh_config_json: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) display_mode: String,
}

pub(crate) fn list(connection: &Connection) -> Result<Vec<WidgetLayout>> {
    let mut statement = connection.prepare(
        "SELECT id, source_kind, source_config_json, refresh_config_json, x, y, width, height, display_mode\n         FROM widgets\n         ORDER BY id",
    )?;

    let widgets = statement.query_map([], map_widget)?.collect();
    widgets
}

pub(crate) fn list_distinct_source_configs(
    connection: &Connection,
) -> Result<Vec<(String, String)>> {
    let mut statement = connection.prepare(
        "SELECT DISTINCT source_kind, source_config_json\n         FROM widgets\n         ORDER BY source_kind, source_config_json",
    )?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect();
    rows
}

pub(crate) fn list_scheduler_source_configs(
    connection: &Connection,
) -> Result<Vec<(String, String, String)>> {
    let mut statement = connection.prepare(
        "SELECT source_kind, source_config_json, refresh_config_json\n         FROM widgets\n         ORDER BY source_kind, source_config_json, id",
    )?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect();
    rows
}

pub(crate) fn list_ids_and_configs_for_source_kind(
    connection: &Connection,
    source_kind: &str,
) -> Result<Vec<(i64, String)>> {
    let mut statement = connection.prepare(
        "SELECT id, source_config_json\n         FROM widgets\n         WHERE source_kind = ?1\n         ORDER BY id",
    )?;
    let rows = statement
        .query_map([source_kind], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect();
    rows
}

pub(crate) fn get(connection: &Connection, id: i64) -> Result<Option<WidgetLayout>> {
    connection
        .query_row(
            "SELECT id, source_kind, source_config_json, refresh_config_json, x, y, width, height, display_mode\n             FROM widgets\n             WHERE id = ?1",
            [id],
            map_widget,
        )
        .optional()
}

pub(crate) fn create(
    connection: &Connection,
    source_kind: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<WidgetLayout> {
    connection.execute(
        "INSERT INTO widgets (source_kind, x, y, width, height)\n         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![source_kind, x, y, width, height],
    )?;

    Ok(WidgetLayout {
        id: connection.last_insert_rowid(),
        source_kind: source_kind.to_owned(),
        source_config_json: "{}".to_owned(),
        refresh_config_json: "{}".to_owned(),
        x,
        y,
        width,
        height,
        display_mode: "minimal".to_owned(),
    })
}

pub(crate) fn update_geometry(
    connection: &Connection,
    id: i64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<bool> {
    let changed = connection.execute(
        "UPDATE widgets\n         SET x = ?2, y = ?3, width = ?4, height = ?5\n         WHERE id = ?1",
        params![id, x, y, width, height],
    )?;
    Ok(changed == 1)
}

pub(crate) fn update_source_config(
    connection: &Connection,
    id: i64,
    source_config_json: &str,
) -> Result<bool> {
    let changed = connection.execute(
        "UPDATE widgets SET source_config_json = ?2 WHERE id = ?1",
        params![id, source_config_json],
    )?;
    Ok(changed == 1)
}

pub(crate) fn update_refresh_config(
    connection: &Connection,
    id: i64,
    refresh_config_json: &str,
) -> Result<bool> {
    let changed = connection.execute(
        "UPDATE widgets SET refresh_config_json = ?2 WHERE id = ?1",
        params![id, refresh_config_json],
    )?;
    Ok(changed == 1)
}

pub(crate) fn delete(connection: &Connection, id: i64) -> Result<bool> {
    Ok(connection.execute("DELETE FROM widgets WHERE id = ?1", params![id])? == 1)
}

fn map_widget(row: &rusqlite::Row<'_>) -> Result<WidgetLayout> {
    Ok(WidgetLayout {
        id: row.get(0)?,
        source_kind: row.get(1)?,
        source_config_json: row.get(2)?,
        refresh_config_json: row.get(3)?,
        x: row.get(4)?,
        y: row.get(5)?,
        width: row.get(6)?,
        height: row.get(7)?,
        display_mode: row.get(8)?,
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
    fn widget_geometry_roundtrip_works() {
        let connection = database();

        let widget =
            create(&connection, "arxiv", 1.0, 1.0, 4.0, 3.0).expect("widget should be created");
        assert_eq!(widget.source_config_json, "{}");
        assert_eq!(widget.refresh_config_json, "{}");
        assert!(update_geometry(&connection, widget.id, 2.0, 2.0, 5.0, 3.0,)
            .expect("geometry should update"));

        let widgets = list(&connection).expect("widgets should list");
        assert_eq!(widgets.len(), 1);
        assert_eq!(widgets[0].x, 2.0);
        assert_eq!(widgets[0].height, 3.0);
        assert_eq!(widgets[0].source_config_json, "{}");
        assert_eq!(widgets[0].refresh_config_json, "{}");

        assert!(delete(&connection, widget.id).expect("widget should delete"));
        assert!(list(&connection).expect("widgets should list").is_empty());
    }

    #[test]
    fn source_and_refresh_configs_update_without_touching_geometry() {
        let connection = database();
        let widget =
            create(&connection, "arxiv", 1.0, 1.0, 4.0, 3.0).expect("widget should be created");

        assert!(
            update_source_config(&connection, widget.id, r#"{"query":"cat:cs.LG"}"#)
                .expect("source config should update")
        );
        assert!(
            update_refresh_config(&connection, widget.id, r#"{"mode":"off"}"#)
                .expect("refresh config should update")
        );
        let updated = get(&connection, widget.id)
            .expect("widget should read")
            .expect("widget should exist");
        assert_eq!(updated.source_config_json, r#"{"query":"cat:cs.LG"}"#);
        assert_eq!(updated.refresh_config_json, r#"{"mode":"off"}"#);
        assert_eq!(updated.x, 1.0);
        assert_eq!(updated.width, 4.0);
    }

    #[test]
    fn source_queries_avoid_decoding_full_widget_layouts() {
        let connection = database();
        let first_arxiv = create(&connection, "arxiv", 1.0, 1.0, 4.0, 3.0)
            .expect("first arxiv widget should be created");
        let second_arxiv = create(&connection, "arxiv", 5.0, 1.0, 4.0, 3.0)
            .expect("second arxiv widget should be created");

        update_source_config(&connection, second_arxiv.id, r#"{"query":"cat:cs.LG"}"#)
            .expect("source config should update");
        update_refresh_config(&connection, second_arxiv.id, r#"{"mode":"off"}"#)
            .expect("refresh config should update");

        assert_eq!(
            list_distinct_source_configs(&connection).expect("sources should list"),
            vec![
                ("arxiv".to_owned(), r#"{"query":"cat:cs.LG"}"#.to_owned()),
                ("arxiv".to_owned(), "{}".to_owned()),
            ]
        );
        assert_eq!(
            list_ids_and_configs_for_source_kind(&connection, "arxiv")
                .expect("arxiv source rows should list"),
            vec![
                (first_arxiv.id, "{}".to_owned()),
                (second_arxiv.id, r#"{"query":"cat:cs.LG"}"#.to_owned()),
            ]
        );
        assert_eq!(
            list_scheduler_source_configs(&connection).expect("scheduler rows should list"),
            vec![
                (
                    "arxiv".to_owned(),
                    r#"{"query":"cat:cs.LG"}"#.to_owned(),
                    r#"{"mode":"off"}"#.to_owned(),
                ),
                ("arxiv".to_owned(), "{}".to_owned(), "{}".to_owned()),
            ]
        );
    }
}
