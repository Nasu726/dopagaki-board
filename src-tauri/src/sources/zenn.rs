use super::http::{fetch_text, SourceFetchError};
use crate::{db::cache::CacheWriteItem, source_config};
use serde::Deserialize;
use serde_json::{Map, Value};

const DEFAULT_FEED_TYPE: &str = "trend";
const DEFAULT_MAX_RESULTS: usize = 3;
const MAX_RESULTS: usize = 25;

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct ZennConfig {
    feed_type: String,
    value: String,
    max_results: usize,
}

impl Default for ZennConfig {
    fn default() -> Self {
        Self {
            feed_type: DEFAULT_FEED_TYPE.to_owned(),
            value: String::new(),
            max_results: DEFAULT_MAX_RESULTS,
        }
    }
}

#[derive(Debug, Deserialize)]
struct Rss {
    channel: RssChannel,
}

#[derive(Debug, Deserialize)]
struct RssChannel {
    #[serde(rename = "item", default)]
    items: Vec<RssItem>,
}

#[derive(Debug, Deserialize)]
struct RssItem {
    title: String,
    link: String,
    #[serde(default)]
    guid: Option<String>,
    #[serde(rename = "pubDate", default)]
    pub_date: Option<String>,
}

pub(crate) async fn fetch(
    http: &reqwest::Client,
    canonical_source_config_json: &str,
    fetched_at: i64,
) -> Result<Vec<CacheWriteItem>, SourceFetchError> {
    let config = parse_config(canonical_source_config_json)
        .map_err(|error| SourceFetchError::invalid_config("Zenn", error))?;
    let endpoint =
        endpoint(&config).map_err(|error| SourceFetchError::invalid_config("Zenn", error))?;
    let body = fetch_text(http.get(endpoint), "Zenn").await?;
    parse_feed(
        &body,
        config.max_results,
        canonical_source_config_json,
        fetched_at,
    )
    .map_err(|error| SourceFetchError::decode("Zenn", error))
}

pub(crate) fn normalize_config(input: &str) -> Result<String, String> {
    let config = parse_config(input)?;
    let mut sparse = Map::new();
    if config.feed_type != DEFAULT_FEED_TYPE {
        sparse.insert("feedType".to_owned(), Value::String(config.feed_type));
    }
    if !config.value.is_empty() {
        sparse.insert("value".to_owned(), Value::String(config.value));
    }
    if config.max_results != DEFAULT_MAX_RESULTS {
        sparse.insert(
            "maxResults".to_owned(),
            Value::from(u64::try_from(config.max_results).unwrap_or(u64::MAX)),
        );
    }
    source_config::canonicalize(&Value::Object(sparse).to_string())
}

fn parse_config(input: &str) -> Result<ZennConfig, String> {
    let mut config: ZennConfig = serde_json::from_str(input)
        .map_err(|error| format!("invalid Zenn source configuration: {error}"))?;
    config.feed_type = config.feed_type.trim().to_ascii_lowercase();
    config.value = config.value.trim().to_owned();
    if !matches!(config.feed_type.as_str(), "trend" | "user" | "topic") {
        return Err("Zenn feedType must be trend, user, or topic".to_owned());
    }
    if config.feed_type == "trend" {
        config.value.clear();
    } else if config.value.is_empty() || config.value.len() > 80 || !safe_slug(&config.value) {
        return Err("Zenn user/topic value must use letters, numbers, '-' or '_'".to_owned());
    }
    if !(1..=MAX_RESULTS).contains(&config.max_results) {
        return Err(format!(
            "Zenn maxResults must be between 1 and {MAX_RESULTS}"
        ));
    }
    Ok(config)
}

fn safe_slug(value: &str) -> bool {
    value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
}

fn endpoint(config: &ZennConfig) -> Result<String, String> {
    match config.feed_type.as_str() {
        "trend" => Ok("https://zenn.dev/feed".to_owned()),
        "user" => Ok(format!("https://zenn.dev/{}/feed", config.value)),
        "topic" => Ok(format!("https://zenn.dev/topics/{}/feed", config.value)),
        _ => Err("unsupported Zenn feed type".to_owned()),
    }
}

fn parse_feed(
    body: &str,
    max_results: usize,
    canonical_source_config_json: &str,
    fetched_at: i64,
) -> Result<Vec<CacheWriteItem>, String> {
    let rss: Rss = quick_xml::de::from_str(body)
        .map_err(|error| format!("failed to parse Zenn RSS: {error}"))?;
    let entries: Vec<RssItem> = rss.channel.items.into_iter().take(max_results).collect();
    let count = entries.len();
    Ok(entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| {
            let stable = entry.guid.as_deref().unwrap_or(&entry.link).trim();
            CacheWriteItem {
                id: format!("zenn:{stable}"),
                source_kind: "zenn".to_owned(),
                source_config_json: canonical_source_config_json.to_owned(),
                external_url: entry.link,
                title: Some(entry.title),
                image_url: None,
                author: None,
                published_at: None,
                fetched_at,
                score: (count.saturating_sub(index)) as f64 * 100.0,
                payload_json: serde_json::json!({"pubDate": entry.pub_date}).to_string(),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_supports_trend_user_and_topic() {
        assert_eq!(normalize_config("{}").unwrap(), "{}");
        assert_eq!(parse_config("{}").unwrap().max_results, 3);
        assert_eq!(
            normalize_config(r#"{"feedType":"user","value":" zenn ","maxResults":5}"#).unwrap(),
            r#"{"feedType":"user","maxResults":5,"value":"zenn"}"#
        );
        assert!(normalize_config(r#"{"feedType":"topic","value":"../bad"}"#).is_err());
    }

    #[test]
    fn rss_items_become_cache_rows() {
        let body = r#"<?xml version="1.0"?><rss version="2.0"><channel><title>Zenn</title><item><title>Example Zenn post</title><link>https://zenn.dev/example/articles/abc</link><guid>https://zenn.dev/example/articles/abc</guid><pubDate>Sun, 13 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>"#;
        let items = parse_feed(body, 12, "{}", 123).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].title.as_deref(), Some("Example Zenn post"));
        assert_eq!(
            items[0].external_url,
            "https://zenn.dev/example/articles/abc"
        );
    }
}
