use crate::db;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

pub(crate) const MIN_AUTO_REFRESH_SECONDS: u64 = 5 * 60;
pub(crate) const MAX_AUTO_REFRESH_SECONDS: u64 = 24 * 60 * 60;
const SOURCE_DEFAULT_PREFIX: &str = "refresh.source_default.";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum IntervalChoice {
    Inherit,
    Off,
    Seconds(u64),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct WidgetRefreshConfig {
    mode: String,
    auto_interval_seconds: Option<u64>,
}

impl Default for WidgetRefreshConfig {
    fn default() -> Self {
        Self {
            mode: "inherit".to_owned(),
            auto_interval_seconds: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedWidgetRefreshConfig<'a> {
    mode: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    auto_interval_seconds: Option<u64>,
}

pub(crate) fn normalize_widget_config(input: &str) -> Result<String, String> {
    let parsed: WidgetRefreshConfig = serde_json::from_str(input)
        .map_err(|error| format!("invalid widget refresh configuration: {error}"))?;
    match parsed.mode.as_str() {
        "inherit" => Ok("{}".to_owned()),
        "off" => serde_json::to_string(&NormalizedWidgetRefreshConfig {
            mode: "off",
            auto_interval_seconds: None,
        })
        .map_err(|error| error.to_string()),
        "interval" => {
            let seconds = parsed.auto_interval_seconds.ok_or_else(|| {
                "custom widget refresh interval requires autoIntervalSeconds".to_owned()
            })?;
            validate_interval(seconds)?;
            serde_json::to_string(&NormalizedWidgetRefreshConfig {
                mode: "interval",
                auto_interval_seconds: Some(seconds),
            })
            .map_err(|error| error.to_string())
        }
        _ => Err("widget refresh mode must be inherit, off, or interval".to_owned()),
    }
}

pub(crate) fn resolve_widget_interval(
    input: &str,
    inherited: Option<u64>,
) -> Result<Option<u64>, String> {
    let normalized = normalize_widget_config(input)?;
    if normalized == "{}" {
        return Ok(inherited);
    }
    let parsed: WidgetRefreshConfig = serde_json::from_str(&normalized)
        .map_err(|error| format!("invalid normalized widget refresh configuration: {error}"))?;
    match parsed.mode.as_str() {
        "off" => Ok(None),
        "interval" => Ok(parsed.auto_interval_seconds),
        _ => Ok(inherited),
    }
}

pub(crate) fn read_source_default(
    connection: &Connection,
    source_kind: &str,
    global: Option<u64>,
) -> Result<Option<u64>, String> {
    match read_source_choice(connection, source_kind)? {
        IntervalChoice::Inherit => Ok(global),
        IntervalChoice::Off => Ok(None),
        IntervalChoice::Seconds(seconds) => Ok(Some(seconds)),
    }
}

pub(crate) fn read_source_choice(
    connection: &Connection,
    source_kind: &str,
) -> Result<IntervalChoice, String> {
    let key = source_default_key(source_kind);
    let raw = db::get_setting(connection, &key).map_err(|error| error.to_string())?;
    let Some(raw) = raw else {
        return Ok(IntervalChoice::Inherit);
    };
    match raw.as_str() {
        "inherit" => Ok(IntervalChoice::Inherit),
        "off" => Ok(IntervalChoice::Off),
        value => {
            let seconds = value
                .parse::<u64>()
                .map_err(|_| "stored source refresh interval is invalid".to_owned())?;
            validate_interval(seconds)?;
            Ok(IntervalChoice::Seconds(seconds))
        }
    }
}

pub(crate) fn write_source_choice(
    connection: &Connection,
    source_kind: &str,
    choice: &IntervalChoice,
) -> Result<(), String> {
    let value = match choice {
        IntervalChoice::Inherit => "inherit".to_owned(),
        IntervalChoice::Off => "off".to_owned(),
        IntervalChoice::Seconds(seconds) => {
            validate_interval(*seconds)?;
            seconds.to_string()
        }
    };
    db::set_setting(connection, &source_default_key(source_kind), &value)
        .map_err(|error| error.to_string())
}

pub(crate) fn parse_choice(
    mode: &str,
    auto_interval_seconds: Option<u64>,
) -> Result<IntervalChoice, String> {
    match mode {
        "inherit" => Ok(IntervalChoice::Inherit),
        "off" => Ok(IntervalChoice::Off),
        "interval" => {
            let seconds = auto_interval_seconds
                .ok_or_else(|| "custom refresh interval requires autoIntervalSeconds".to_owned())?;
            validate_interval(seconds)?;
            Ok(IntervalChoice::Seconds(seconds))
        }
        _ => Err("refresh mode must be inherit, off, or interval".to_owned()),
    }
}

pub(crate) fn choice_parts(choice: &IntervalChoice) -> (&'static str, Option<u64>) {
    match choice {
        IntervalChoice::Inherit => ("inherit", None),
        IntervalChoice::Off => ("off", None),
        IntervalChoice::Seconds(seconds) => ("interval", Some(*seconds)),
    }
}

fn source_default_key(source_kind: &str) -> String {
    format!("{SOURCE_DEFAULT_PREFIX}{source_kind}")
}

fn validate_interval(seconds: u64) -> Result<(), String> {
    if (MIN_AUTO_REFRESH_SECONDS..=MAX_AUTO_REFRESH_SECONDS).contains(&seconds) {
        Ok(())
    } else {
        Err("automatic refresh interval must be between 5 minutes and 24 hours".to_owned())
    }
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
    fn widget_config_distinguishes_inherit_off_and_interval() {
        assert_eq!(normalize_widget_config("{}").unwrap(), "{}");
        assert_eq!(
            resolve_widget_interval("{}", Some(3600)).unwrap(),
            Some(3600)
        );
        assert_eq!(
            resolve_widget_interval(r#"{"mode":"off"}"#, Some(3600)).unwrap(),
            None
        );
        assert_eq!(
            resolve_widget_interval(
                r#"{"mode":"interval","autoIntervalSeconds":7200}"#,
                Some(3600)
            )
            .unwrap(),
            Some(7200)
        );
    }

    #[test]
    fn source_choice_roundtrip_uses_global_only_for_inherit() {
        let connection = database();
        assert_eq!(
            read_source_default(&connection, "arxiv", Some(3600)).unwrap(),
            Some(3600)
        );

        write_source_choice(&connection, "arxiv", &IntervalChoice::Off).unwrap();
        assert_eq!(
            read_source_default(&connection, "arxiv", Some(3600)).unwrap(),
            None
        );

        write_source_choice(&connection, "arxiv", &IntervalChoice::Seconds(7200)).unwrap();
        assert_eq!(
            read_source_default(&connection, "arxiv", Some(3600)).unwrap(),
            Some(7200)
        );
    }

    #[test]
    fn interval_validation_is_bounded() {
        assert!(parse_choice("interval", Some(299)).is_err());
        assert!(parse_choice("interval", Some(300)).is_ok());
        assert!(parse_choice("interval", Some(86_400)).is_ok());
        assert!(parse_choice("interval", Some(86_401)).is_err());
    }
}
