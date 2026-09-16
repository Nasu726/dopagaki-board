use super::http::{fetch_text, SourceFetchError};
use crate::{db::cache::CacheWriteItem, source_config};
use serde::Deserialize;
use serde_json::{Map, Value};

const DEFAULT_CHANNEL: &str = "";
const DEFAULT_MAX_RESULTS: usize = 1;
const MAX_RESULTS: usize = 15;

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct YouTubeConfig {
    #[serde(alias = "channelId")]
    channel: String,
    max_results: usize,
}

impl Default for YouTubeConfig {
    fn default() -> Self {
        Self {
            channel: DEFAULT_CHANNEL.to_owned(),
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
    if config.channel.is_empty() {
        return Ok(Vec::new());
    }

    let channel_id = resolve_channel_id(http, &config.channel).await?;
    let request = http
        .get("https://www.youtube.com/feeds/videos.xml")
        .query(&[("channel_id", channel_id.as_str())]);
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
    if config.channel != DEFAULT_CHANNEL {
        sparse.insert("channel".to_owned(), Value::String(config.channel));
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
    config.channel = normalize_channel_reference(&config.channel)?;
    if !(1..=MAX_RESULTS).contains(&config.max_results) {
        return Err(format!(
            "YouTube maxResults must be between 1 and {MAX_RESULTS}"
        ));
    }
    Ok(config)
}

fn normalize_channel_reference(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if valid_channel_id(trimmed) {
        return Ok(trimmed.to_owned());
    }

    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    let without_www = without_scheme
        .strip_prefix("www.")
        .unwrap_or(without_scheme);

    let candidate = if trimmed.starts_with('@') {
        trimmed
    } else if let Some(path) = without_www.strip_prefix("youtube.com/") {
        path
    } else {
        return Err("Paste a YouTube channel URL or @handle".to_owned());
    };

    let path = candidate.split(['?', '#']).next().unwrap_or(candidate);
    let mut segments = path.split('/').filter(|segment| !segment.is_empty());
    let first = segments.next().unwrap_or_default();
    if first.eq_ignore_ascii_case("channel") {
        let id = segments.next().unwrap_or_default();
        if valid_channel_id(id) {
            return Ok(id.to_owned());
        }
        return Err("That YouTube channel URL is not valid".to_owned());
    }
    if first.starts_with('@') && valid_handle(first) {
        return Ok(first.to_lowercase());
    }
    if first.eq_ignore_ascii_case("c") || first.eq_ignore_ascii_case("user") {
        let value = segments.next().unwrap_or_default();
        if !value.is_empty() && !value.chars().any(char::is_whitespace) {
            return Ok(format!(
                "https://www.youtube.com/{}/{value}",
                first.to_ascii_lowercase()
            ));
        }
    }

    Err("Paste a YouTube channel URL or @handle".to_owned())
}

fn valid_handle(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some('@'))
        && characters.clone().next().is_some()
        && value.chars().count() <= 80
        && characters
            .all(|character| !character.is_whitespace() && !matches!(character, '/' | '?' | '#'))
}

fn valid_channel_id(value: &str) -> bool {
    (20..=32).contains(&value.len())
        && value.starts_with("UC")
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

async fn resolve_channel_id(
    http: &reqwest::Client,
    channel: &str,
) -> Result<String, SourceFetchError> {
    if valid_channel_id(channel) {
        return Ok(channel.to_owned());
    }

    let page_url = if channel.starts_with('@') {
        format!("https://www.youtube.com/{channel}")
    } else {
        channel.to_owned()
    };
    let body = fetch_text(http.get(page_url), "YouTube channel").await?;
    extract_channel_id(&body).ok_or_else(|| {
        SourceFetchError::invalid_config(
            "YouTube",
            "Could not find that channel. Paste its YouTube channel URL or @handle.",
        )
    })
}

fn extract_channel_id(body: &str) -> Option<String> {
    for marker in [
        "\"channelId\":\"",
        "\"browseId\":\"",
        "itemprop=\"channelId\" content=\"",
        "content=\"",
    ] {
        let mut remainder = body;
        while let Some(index) = remainder.find(marker) {
            let after = &remainder[index + marker.len()..];
            let candidate: String = after
                .chars()
                .take_while(|character| {
                    character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
                })
                .collect();
            if valid_channel_id(&candidate) {
                return Some(candidate);
            }
            remainder = &after[after.len().min(1)..];
        }
    }

    let mut remainder = body;
    const CHANNEL_PATH: &str = "/channel/";
    while let Some(index) = remainder.find(CHANNEL_PATH) {
        let after = &remainder[index + CHANNEL_PATH.len()..];
        let candidate: String = after
            .chars()
            .take_while(|character| {
                character.is_ascii_alphanumeric() || *character == '-' || *character == '_'
            })
            .collect();
        if valid_channel_id(&candidate) {
            return Some(candidate);
        }
        remainder = &after[after.len().min(1)..];
    }
    None
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
        let config = parse_config("{}").unwrap();
        assert_eq!(config.channel, "");
        assert_eq!(config.max_results, 1);
    }

    #[test]
    fn channel_references_normalize_without_exposing_internal_ids() {
        let id = "UC123456789012345678";
        assert_eq!(
            normalize_config(r#"{"channelId":"UC123456789012345678"}"#).unwrap(),
            r#"{"channel":"UC123456789012345678"}"#
        );
        assert_eq!(normalize_channel_reference("@Example").unwrap(), "@example");
        assert_eq!(
            normalize_channel_reference("https://youtube.com/@Example/videos").unwrap(),
            "@example"
        );
        assert_eq!(
            normalize_channel_reference("youtube.com/channel/UC123456789012345678").unwrap(),
            id
        );
        assert!(normalize_channel_reference("channel name only").is_err());
    }

    #[test]
    fn channel_id_can_be_extracted_from_channel_page_metadata() {
        let id = "UC123456789012345678";
        assert_eq!(
            extract_channel_id(&format!(
                r#"<meta itemprop="channelId" content="{id}"><script>{{"browseId":"UCOTHER"}}</script>"#
            )),
            Some(id.to_owned())
        );
        assert_eq!(
            extract_channel_id(&format!(r#"{{"channelId":"{id}"}}"#)),
            Some(id.to_owned())
        );
        assert_eq!(
            extract_channel_id(&format!(r#"<a href="/channel/{id}">channel</a>"#)),
            Some(id.to_owned())
        );
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
