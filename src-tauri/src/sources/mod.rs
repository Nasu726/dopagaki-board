pub(crate) mod arxiv;

pub(crate) const ARXIV_AUTO_REFRESH_SECONDS: u64 = 24 * 60 * 60;

pub(crate) fn is_supported(source_kind: &str) -> bool {
    source_kind == "arxiv"
}

pub(crate) fn effective_auto_interval(
    source_kind: &str,
    global_interval_seconds: Option<u64>,
) -> Option<u64> {
    match (source_kind, global_interval_seconds) {
        (_, None) => None,
        ("arxiv", Some(seconds)) => Some(seconds.max(ARXIV_AUTO_REFRESH_SECONDS)),
        (_, Some(seconds)) => Some(seconds),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(effective_auto_interval("youtube", Some(5 * 60)), Some(5 * 60));
    }
}
