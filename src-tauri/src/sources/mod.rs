pub(crate) mod arxiv;

use crate::source_config;

pub(crate) const ARXIV_AUTO_REFRESH_SECONDS: u64 = 24 * 60 * 60;
const SUPPORTED_KINDS: &[&str] = &["arxiv"];

pub(crate) fn supported_kinds() -> &'static [&'static str] {
    SUPPORTED_KINDS
}

pub(crate) fn is_supported(source_kind: &str) -> bool {
    SUPPORTED_KINDS.contains(&source_kind)
}

pub(crate) fn normalize_config(source_kind: &str, input: &str) -> Result<String, String> {
    let canonical = source_config::canonicalize(input)?;
    match source_kind {
        "arxiv" => arxiv::normalize_config(&canonical),
        _ => Ok(canonical),
    }
}

pub(crate) fn normalize_editable_config(source_kind: &str, input: &str) -> Result<String, String> {
    match source_kind {
        "arxiv" => normalize_config(source_kind, input),
        _ => Err(format!(
            "{source_kind} does not have editable source settings yet"
        )),
    }
}

pub(crate) fn effective_auto_interval(
    source_kind: &str,
    configured_interval_seconds: Option<u64>,
) -> Option<u64> {
    match (source_kind, configured_interval_seconds) {
        (_, None) => None,
        ("arxiv", Some(seconds)) => Some(seconds.max(ARXIV_AUTO_REFRESH_SECONDS)),
        (_, Some(seconds)) => Some(seconds),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_kinds_only_expose_real_adapters() {
        assert_eq!(supported_kinds(), &["arxiv"]);
        assert!(is_supported("arxiv"));
        assert!(!is_supported("youtube"));
        assert!(!is_supported("nhk"));
    }

    #[test]
    fn arxiv_source_identity_uses_semantic_normalization() {
        assert_eq!(
            normalize_config("arxiv", r#"{ "maxResults": 12, "query": "cat:cs.AI" }"#).unwrap(),
            "{}"
        );
        assert_eq!(
            normalize_config("arxiv", r#"{"query":"cat:cs.LG"}"#).unwrap(),
            r#"{"query":"cat:cs.LG"}"#
        );
    }

    #[test]
    fn non_adapter_configs_still_receive_generic_canonicalization() {
        assert_eq!(
            normalize_config("youtube", r#"{ "z": 1, "a": 2 }"#).unwrap(),
            r#"{"a":2,"z":1}"#
        );
        assert!(normalize_editable_config("youtube", "{}").is_err());
    }

    #[test]
    fn arxiv_automatic_refresh_is_clamped_to_daily() {
        assert_eq!(effective_auto_interval("arxiv", None), None);
        assert_eq!(
            effective_auto_interval("arxiv", Some(5 * 60)),
            Some(ARXIV_AUTO_REFRESH_SECONDS)
        );
        assert_eq!(
            effective_auto_interval("arxiv", Some(ARXIV_AUTO_REFRESH_SECONDS)),
            Some(ARXIV_AUTO_REFRESH_SECONDS)
        );
        assert_eq!(
            effective_auto_interval("youtube", Some(5 * 60)),
            Some(5 * 60)
        );
    }
}