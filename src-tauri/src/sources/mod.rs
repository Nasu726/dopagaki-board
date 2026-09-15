pub(crate) mod arxiv;
pub(crate) mod http;
pub(crate) mod qiita;
pub(crate) mod wikipedia;
pub(crate) mod youtube;
pub(crate) mod zenn;

use crate::source_config;

pub(crate) const ARXIV_AUTO_REFRESH_SECONDS: u64 = 24 * 60 * 60;
pub(crate) const WIKIPEDIA_AUTO_REFRESH_SECONDS: u64 = 6 * 60 * 60;
pub(crate) const QIITA_AUTO_REFRESH_SECONDS: u64 = 60 * 60;
pub(crate) const ZENN_AUTO_REFRESH_SECONDS: u64 = 60 * 60;
pub(crate) const YOUTUBE_AUTO_REFRESH_SECONDS: u64 = 60 * 60;
const SUPPORTED_KINDS: &[&str] = &["arxiv", "wikipedia", "qiita", "zenn", "youtube"];

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
        "wikipedia" => wikipedia::normalize_config(&canonical),
        "qiita" => qiita::normalize_config(&canonical),
        "zenn" => zenn::normalize_config(&canonical),
        "youtube" => youtube::normalize_config(&canonical),
        _ => Ok(canonical),
    }
}

pub(crate) fn normalize_editable_config(source_kind: &str, input: &str) -> Result<String, String> {
    if is_supported(source_kind) {
        normalize_config(source_kind, input)
    } else {
        Err(format!(
            "{source_kind} does not have editable source settings yet"
        ))
    }
}

pub(crate) fn effective_auto_interval(
    source_kind: &str,
    configured_interval_seconds: Option<u64>,
) -> Option<u64> {
    let seconds = configured_interval_seconds?;
    Some(match source_kind {
        "arxiv" => seconds.max(ARXIV_AUTO_REFRESH_SECONDS),
        "wikipedia" => seconds.max(WIKIPEDIA_AUTO_REFRESH_SECONDS),
        "qiita" => seconds.max(QIITA_AUTO_REFRESH_SECONDS),
        "zenn" => seconds.max(ZENN_AUTO_REFRESH_SECONDS),
        "youtube" => seconds.max(YOUTUBE_AUTO_REFRESH_SECONDS),
        _ => seconds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_kinds_only_expose_real_adapters() {
        assert_eq!(
            supported_kinds(),
            &["arxiv", "wikipedia", "qiita", "zenn", "youtube"]
        );
        for kind in supported_kinds() {
            assert!(is_supported(kind));
        }
        assert!(!is_supported("unsupported"));
    }

    #[test]
    fn source_identity_uses_adapter_semantic_normalization() {
        assert_eq!(
            normalize_config("arxiv", r#"{ "maxResults": 3, "query": "cat:cs.AI" }"#).unwrap(),
            "{}"
        );
        assert_eq!(
            normalize_config("wikipedia", r#"{"language":" JA ","maxResults":3}"#).unwrap(),
            "{}"
        );
        assert_eq!(
            normalize_config("qiita", r#"{"query":" Rust "}"#).unwrap(),
            r#"{"query":"Rust"}"#
        );
        assert_eq!(
            normalize_config("youtube", r#"{"channelId":"","maxResults":1}"#).unwrap(),
            "{}"
        );
    }

    #[test]
    fn unknown_configs_still_receive_generic_canonicalization() {
        assert_eq!(
            normalize_config("future", r#"{ "z": 1, "a": 2 }"#).unwrap(),
            r#"{"a":2,"z":1}"#
        );
        assert!(normalize_editable_config("future", "{}").is_err());
    }

    #[test]
    fn automatic_refresh_respects_source_floors() {
        assert_eq!(effective_auto_interval("arxiv", None), None);
        assert_eq!(
            effective_auto_interval("arxiv", Some(5 * 60)),
            Some(ARXIV_AUTO_REFRESH_SECONDS)
        );
        assert_eq!(
            effective_auto_interval("wikipedia", Some(5 * 60)),
            Some(WIKIPEDIA_AUTO_REFRESH_SECONDS)
        );
        assert_eq!(
            effective_auto_interval("qiita", Some(5 * 60)),
            Some(QIITA_AUTO_REFRESH_SECONDS)
        );
        assert_eq!(
            effective_auto_interval("zenn", Some(5 * 60)),
            Some(ZENN_AUTO_REFRESH_SECONDS)
        );
        assert_eq!(
            effective_auto_interval("youtube", Some(5 * 60)),
            Some(YOUTUBE_AUTO_REFRESH_SECONDS)
        );
    }
}
