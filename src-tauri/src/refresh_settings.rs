use crate::{
    db,
    scheduler::{AUTO_REFRESH_SETTING_KEY, DEFAULT_AUTO_REFRESH_SECONDS},
};
use rusqlite::Connection;

pub(crate) const MIN_AUTO_REFRESH_SECONDS: u64 = 5 * 60;
pub(crate) const MAX_AUTO_REFRESH_SECONDS: u64 = 24 * 60 * 60;

pub(crate) fn read(connection: &Connection) -> Result<Option<u64>, String> {
    let stored = db::get_setting(connection, AUTO_REFRESH_SETTING_KEY)
        .map_err(|error| format!("failed to read refresh interval: {error}"))?;
    decode(stored.as_deref())
}

pub(crate) fn write(connection: &Connection, value: Option<u64>) -> Result<(), String> {
    validate(value)?;
    let stored = value
        .map(|seconds| seconds.to_string())
        .unwrap_or_else(|| "off".to_owned());
    db::set_setting(connection, AUTO_REFRESH_SETTING_KEY, &stored)
        .map_err(|error| format!("failed to persist refresh interval: {error}"))
}

pub(crate) fn validate(value: Option<u64>) -> Result<(), String> {
    match value {
        None => Ok(()),
        Some(seconds)
            if (MIN_AUTO_REFRESH_SECONDS..=MAX_AUTO_REFRESH_SECONDS).contains(&seconds) =>
        {
            Ok(())
        }
        Some(_) => {
            Err("automatic refresh must be OFF or between 5 minutes and 24 hours".to_owned())
        }
    }
}

fn decode(value: Option<&str>) -> Result<Option<u64>, String> {
    match value {
        None => Ok(Some(DEFAULT_AUTO_REFRESH_SECONDS)),
        Some("off") => Ok(None),
        Some(value) => {
            let seconds = value
                .parse::<u64>()
                .map_err(|_| "stored refresh interval is invalid".to_owned())?;
            validate(Some(seconds))?;
            Ok(Some(seconds))
        }
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
    fn interval_validation_accepts_off_and_supported_range() {
        assert!(validate(None).is_ok());
        assert!(validate(Some(MIN_AUTO_REFRESH_SECONDS)).is_ok());
        assert!(validate(Some(60 * 60)).is_ok());
        assert!(validate(Some(MAX_AUTO_REFRESH_SECONDS)).is_ok());
        assert!(validate(Some(MIN_AUTO_REFRESH_SECONDS - 1)).is_err());
        assert!(validate(Some(MAX_AUTO_REFRESH_SECONDS + 1)).is_err());
    }

    #[test]
    fn absent_setting_defaults_to_one_hour() {
        let connection = database();
        assert_eq!(
            read(&connection).expect("setting should read"),
            Some(DEFAULT_AUTO_REFRESH_SECONDS)
        );
    }

    #[test]
    fn off_and_numeric_settings_roundtrip() {
        let connection = database();

        write(&connection, None).expect("off should persist");
        assert_eq!(read(&connection).expect("off should read"), None);

        write(&connection, Some(30 * 60)).expect("numeric interval should persist");
        assert_eq!(
            read(&connection).expect("numeric interval should read"),
            Some(30 * 60)
        );
    }

    #[test]
    fn malformed_persisted_value_is_rejected() {
        let connection = database();
        db::set_setting(&connection, AUTO_REFRESH_SETTING_KEY, "not-a-number")
            .expect("test setting should write");
        assert!(read(&connection).is_err());
    }
}
