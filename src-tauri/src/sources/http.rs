use reqwest::{
    header::{HeaderMap, RETRY_AFTER},
    RequestBuilder, StatusCode,
};
use std::fmt;

const NON_RETRYABLE_HTTP_RETRY_FLOOR_SECONDS: u64 = 6 * 60 * 60;

#[derive(Debug, Clone)]
pub(crate) struct SourceFetchError {
    message: String,
    retry_after_seconds: Option<u64>,
}

impl SourceFetchError {
    pub(crate) fn transport(source: &str, error: impl fmt::Display) -> Self {
        Self::new(format!("{source} request failed: {error}"), None)
    }

    pub(crate) fn decode(source: &str, error: impl fmt::Display) -> Self {
        Self::new(format!("failed to decode {source} response: {error}"), None)
    }

    pub(crate) fn invalid_config(source: &str, error: impl fmt::Display) -> Self {
        Self::new(
            format!("{source} configuration error: {error}"),
            Some(NON_RETRYABLE_HTTP_RETRY_FLOOR_SECONDS),
        )
    }

    pub(crate) fn other(source: &str, error: impl fmt::Display) -> Self {
        Self::new(format!("{source} refresh failed: {error}"), None)
    }

    fn from_status(source: &str, status: StatusCode, headers: &HeaderMap) -> Self {
        let retry_after_seconds = if status == StatusCode::TOO_MANY_REQUESTS {
            parse_retry_after_seconds(headers)
        } else if status.is_server_error()
            || status == StatusCode::REQUEST_TIMEOUT
            || status == StatusCode::TOO_EARLY
        {
            None
        } else {
            Some(NON_RETRYABLE_HTTP_RETRY_FLOOR_SECONDS)
        };

        let retry_hint = retry_after_seconds
            .map(|seconds| format!("; retry after {seconds}s"))
            .unwrap_or_default();
        Self::new(
            format!("{source} returned HTTP {}{retry_hint}", status.as_u16()),
            retry_after_seconds,
        )
    }

    fn new(message: String, retry_after_seconds: Option<u64>) -> Self {
        Self {
            message,
            retry_after_seconds,
        }
    }

    pub(crate) fn retry_floor_seconds(&self) -> Option<u64> {
        self.retry_after_seconds
    }
}

impl fmt::Display for SourceFetchError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

pub(crate) async fn fetch_text(
    request: RequestBuilder,
    source: &str,
) -> Result<String, SourceFetchError> {
    let response = request
        .send()
        .await
        .map_err(|error| SourceFetchError::transport(source, error))?;
    let status = response.status();
    if !status.is_success() {
        return Err(SourceFetchError::from_status(
            source,
            status,
            response.headers(),
        ));
    }
    response
        .text()
        .await
        .map_err(|error| SourceFetchError::decode(source, error))
}

fn parse_retry_after_seconds(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn rate_limit_uses_numeric_retry_after() {
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_static("900"));
        let error = SourceFetchError::from_status("Qiita", StatusCode::TOO_MANY_REQUESTS, &headers);

        assert_eq!(error.retry_floor_seconds(), Some(900));
        assert!(error.to_string().contains("HTTP 429"));
    }

    #[test]
    fn malformed_or_missing_retry_after_falls_back_to_scheduler_backoff() {
        let missing = SourceFetchError::from_status(
            "Qiita",
            StatusCode::TOO_MANY_REQUESTS,
            &HeaderMap::new(),
        );
        assert_eq!(missing.retry_floor_seconds(), None);

        let mut malformed_headers = HeaderMap::new();
        malformed_headers.insert(RETRY_AFTER, HeaderValue::from_static("later"));
        let malformed = SourceFetchError::from_status(
            "Qiita",
            StatusCode::TOO_MANY_REQUESTS,
            &malformed_headers,
        );
        assert_eq!(malformed.retry_floor_seconds(), None);
    }

    #[test]
    fn server_and_client_statuses_have_distinct_retry_policy() {
        let server = SourceFetchError::from_status(
            "Wikipedia",
            StatusCode::SERVICE_UNAVAILABLE,
            &HeaderMap::new(),
        );
        assert_eq!(server.retry_floor_seconds(), None);

        let client =
            SourceFetchError::from_status("Wikipedia", StatusCode::NOT_FOUND, &HeaderMap::new());
        assert_eq!(
            client.retry_floor_seconds(),
            Some(NON_RETRYABLE_HTTP_RETRY_FLOOR_SECONDS)
        );
    }
}
