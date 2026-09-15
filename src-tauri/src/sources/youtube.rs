use super::http::{fetch_text, SourceFetchError};
use crate::{db::cache::CacheWriteItem, source_config};
use serde::Deserialize;
use serde_json::{Map, Value};

const DEFAULT_CHANNEL_ID: &str = "";
const DEFAULT_MAX_RESULTS: usize = 12;
const MAX_RESULTS: usize = 15;

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct YouTubeConfig {
    channel_id: String,
    max_results: usize,
}

impl Default for YouTubeConfig {
    fn default() -> Self {
        Self {
            channel_id: DEFAULT_CHANNEL_ID.to_owned(),
            max_results: DEFAULT_MAX_RESULTS,
        }
    }
}

#[derive(Debug, Deserialize)]
struct AtomFeed {
    #[serde(rename = "entry", default)]
    entries: Vec<AtomEntry>,
}

#[derive(Debug, Deserialize)]
struct AtomEntry {
    id: String,
    title: String,
    #[serde(default)]
    published: Option<String>,
    #[serde(rename = "author", default)]
    authors: Vec<AtomAuthor>,
}

#[derive(Debug, Deserialize)]
struct AtomAuthor {
    name: String,
}

pub(crate) async fn fetch(
    http: &reqwest::Client,
    canonical_source_config_json: &str,
    fetched_at: i64,
) -> Result<Vec<CacheWriteItem>, SourceFetchError> {
    let config = parse_config(canonical_source_config_json)
        .map_err(|error| SourceFetchError::invalid_config("YouTube RSS", error))?;
    if config.channel_id.is_empty() {
        return Ok(Vec::new());
    }
    let request = http
        .get("https://www.youtube.com/feeds/videos.xml")
        .query(&[("channel_id", config.channel_id.as_str())]);
    let body = fetch_text(request, "YouTube RSS").await?;
    parse_feed(
        &body,
        config.max_results,
        canonical_source_config_json,
        fetched_at,
    )
    .map_err(|error| SourceFetchError::decode("YouTube RSS", error))
}

pub(crate) fn normalize_config(input: &str) -> Result<String, String> {
    let config = parse_config(input)?;
    let mut sparse = Map::new();
    if config.channel_id != DEFAULT_CHANNEL_ID {
        sparse.insert("channelId".to_owned(), Value::String(config.channel_id));
    }
    if config.max_results != DEFAULT_MAX_RESULTS {
        sparse.insert(
            "maxResults".to_owned(),
            Value::from(u64::try_from(config.max_results).unwrap_or(u64::MAX)),
        );
    }
    source_config::canonicalize(&Value::Object(sparse).to_string())
}

fn parse_config(input: &str) -> Result<YouTubeConfig, String> {
    let mut config: YouTubeConfig = serde_json::from_str(input)
        .map_err(|error| format!("invalid YouTube source configuration: {error}"))?;
    config.channel_id = config.channel_id.trim().to_owned();
    if !config.channel_id.is_empty()
        && (!(20..=32).contains(&config.channel_id.len())
            || !config.channel_id.starts_with("UC")
            || !config.channel_id.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '-' || character == '_'
            }))
    {
        return Err("YouTube channelId must be a valid UC-prefixed channel identifier".to_owned());
    }
    if !(1..=MAX_RESULTS).contains(&config.max_results) {
        return Err(format!(
            "YouTube maxResults must be between 1 and {MAX_RESULTS}"
        ));
    }
    Ok(config)
}

fn parse_feed(
    body: &str,
    max_results: usize,
    canonical_source_config_json: &str,
    fetched_at: i64,
) -> Result<Vec<CacheWriteItem>, String> {
    let feed: AtomFeed = quick_xml::de::from_str(body)
        .map_err(|error| format!("failed to parse YouTube Atom feed: {error}"))?;
    let entries: Vec<AtomEntry> = feed.entries.into_iter().take(max_results).collect();
    let count = entries.len();
    entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| {
            let video_id = stable_video_id(&entry.id)?;
            let author = entry
                .authors
                .first()
                .map(|author| author.name.trim().to_owned())
                .filter(|name| !name.is_empty());
            Ok(CacheWriteItem {
                id: format!("youtube:{video_id}"),
                source_kind: "youtube".to_owned(),
                source_config_json: canonical_source_config_json.to_owned(),
                external_url: format!("https://www.youtube.com/watch?v={video_id}"),
                title: Some(entry.title.trim().to_owned()),
                image_url: Some(format!("https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")),
                author,
                published_at: None,
                fetched_at,
                score: (count.saturating_sub(index)) as f64 * 100.0,
                payload_json: serde_json::json!({"published": entry.published}).to_string(),
            })
        })
        .collect()
}

fn stable_video_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let candidate = trimmed.rsplit(':').next().unwrap_or(trimmed);
    let valid = candidate.len() == 11
        && candidate.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        });
    if valid {
        Ok(candidate.to_owned())
    } else {
        Err("YouTube RSS entry has an invalid video id".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_config_is_valid_for_initial_widget_setup() {
        assert_eq!(normalize_config("{}").unwrap(), "{}");
        assert_eq!(parse_config("{}").unwrap().channel_id, "");
        assert!(normalize_config(r#"{"channelId":"not-a-channel"}"#).is_err());
    }

    #[test]
    fn atom_entries_become_thumbnail_first_cache_rows() {
        let body = r#"<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>yt:video:jV1vkHv4zq8</id><title>Example video</title><published>2026-09-01T00:00:00+00:00</published><author><name>Example channel</name></author></entry></feed>"#;
        let items = parse_feed(body, 12, "{}", 123).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "youtube:jV1vkHv4zq8");
        assert_eq!(items[0].author.as_deref(), Some("Example channel"));
        assert_eq!(
            items[0].image_url.as_deref(),
            Some("https://i.ytimg.com/vi/jV1vkHv4zq8/hqdefault.jpg")
        );
    }
}
