use serde_json::{Map, Value};

const MAX_SOURCE_CONFIG_BYTES: usize = 16 * 1024;

pub(crate) fn canonicalize(input: &str) -> Result<String, String> {
    if input.len() > MAX_SOURCE_CONFIG_BYTES {
        return Err("source configuration is too large".to_owned());
    }

    let value: Value = serde_json::from_str(input)
        .map_err(|error| format!("source configuration is not valid JSON: {error}"))?;
    if !value.is_object() {
        return Err("source configuration must be a JSON object".to_owned());
    }

    serde_json::to_string(&sort_value(value))
        .map_err(|error| format!("failed to canonicalize source configuration: {error}"))
}

fn sort_value(value: Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries = object.into_iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));

            let mut sorted = Map::new();
            for (key, value) in entries {
                sorted.insert(key, sort_value(value));
            }
            Value::Object(sorted)
        }
        Value::Array(values) => Value::Array(values.into_iter().map(sort_value).collect()),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalization_sorts_nested_object_keys_and_removes_whitespace() {
        assert_eq!(
            canonicalize(r#"{ "z": 1, "a": { "y": 2, "x": 3 }, "list": [{"b":2,"a":1}] }"#)
                .expect("valid config should canonicalize"),
            r#"{"a":{"x":3,"y":2},"list":[{"a":1,"b":2}],"z":1}"#
        );
    }

    #[test]
    fn canonicalization_preserves_array_order() {
        assert_eq!(
            canonicalize(r#"{"values":[3,1,2]}"#).expect("valid config should canonicalize"),
            r#"{"values":[3,1,2]}"#
        );
    }

    #[test]
    fn source_config_must_be_a_bounded_json_object() {
        assert!(canonicalize("[]").is_err());
        assert!(canonicalize("not-json").is_err());
        assert!(canonicalize(&format!(
            r#"{{"x":"{}"}}"#,
            "x".repeat(MAX_SOURCE_CONFIG_BYTES)
        ))
        .is_err());
    }
}
