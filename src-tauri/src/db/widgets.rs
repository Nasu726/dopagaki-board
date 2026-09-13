use rusqlite::{params, Connection, Result};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WidgetLayout {
    pub(crate) id: i64,
    pub(crate) source_kind: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) display_mode: String,
}

pub(crate) fn list(connection: &Connection) -> Result<Vec<WidgetLayout>> {
    let mut statement = connection.prepare(
        "SELECT id, source_kind, x, y, width, height, display_mode\n         FROM widgets\n         ORDER BY id",
    )?;

    statement
        .query_map([], |row| {
            Ok(WidgetLayout {
                id: row.get(0)?,
                source_kind: row.get(1)?,
                x: row.get(2)?,
                y: row.get(3)?,
                width: row.get(4)?,
                height: row.get(5)?,
                display_mode: row.get(6)?,
            })
        })?
        .collect()
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

pub(crate) fn delete(connection: &Connection, id: i64) -> Result<bool> {
    Ok(connection.execute("DELETE FROM widgets WHERE id = ?1", params![id])? == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    #[test]
    fn widget_geometry_roundtrip_works() {
        let connection = Connection::open_in_memory().expect("SQLite should open");
        migrations::run(&connection).expect("migration should succeed");

        let widget = create(&connection, "youtube", 12.0, 18.0, 280.0, 180.0)
            .expect("widget should be created");
        assert!(update_geometry(
            &connection,
            widget.id,
            40.0,
            50.0,
            320.0,
            210.0,
        )
        .expect("geometry should update"));

        let widgets = list(&connection).expect("widgets should list");
        assert_eq!(widgets.len(), 1);
        assert_eq!(widgets[0].x, 40.0);
        assert_eq!(widgets[0].height, 210.0);

        assert!(delete(&connection, widget.id).expect("widget should delete"));
        assert!(list(&connection).expect("widgets should list").is_empty());
    }
}
