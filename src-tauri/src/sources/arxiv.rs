use super::http::{fetch_text, SourceFetchError};
use crate::{db::cache::CacheWriteItem, source_config};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::time::Duration;
use tokio::{sync::Mutex, time::Instant};

const API_ENDPOINT: &str = "https://export.arxiv.org/api/query";
const USER_AGENT: &str = "dopagaki-board/0.1 (https://github.com/Nasu726/dopagaki-board)";
const MIN_REQUEST_GAP: Duration = Duration::from_secs(3);
const DEFAULT_QUERY: &str = "cat:cs.AI";
const DEFAULT_MAX_RESULTS: usize = 3;
const MAX_RESULTS: usize = 25;

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct ArxivConfig {
    query: String,
    max_results: usize,
}

impl Default for ArxivConfig {
    fn default() -> Self {
        Self {
            query: DEFAULT_QUERY.to_owned(),
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
    #[serde(default)]
    summary: Option<String>,
    #[serde(rename = "author", default)]
    authors: Vec<AtomAuthor>,
    #[serde(rename = "category", default)]
    categories: Vec<AtomCategory>,
}

#[derive(Debug, Deserialize)]
struct AtomAuthor {
    name: String,
}

#[derive(Debug, Deserialize)]
struct AtomCategory {
    #[serde(rename = "@term")]
    term: String,
}

#[derive(Debug)]
pub(crate) struct ArxivClient {
    http: reqwest::Client,
    last_request_started: Mutex<Option<Instant>>,
}

impl ArxivClient {
    pub(crate) fn new() -> Result<Self, String> {
        let http = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25))
            .build()
            .map_err(|error| format!("failed to create arXiv HTTP client: {error}"))?;

        Ok(Self {
            http,
            last_request_started: Mutex::new(None),
        })
    }

    pub(crate) async fn fetch(
        &self,
        canonical_source_config_json: &str,
        fetched_at: i64,
    ) -> Result<Vec<CacheWriteItem>, SourceFetchError> {
        let config = parse_config(canonical_source_config_json)
            .map_err(|error| SourceFetchError::invalid_config("arXiv", error))?;
        let max_results = config.max_results.to_string();

        // Hold the gate across the request. arXiv asks legacy API clients to use
        // one connection at a time in addition to spacing request starts.
        let mut gate = self.last_request_started.lock().await;
        if let Some(previous) = *gate {
            let next_allowed = previous + MIN_REQUEST_GAP;
            let now = Instant::now();
            if next_allowed > now {
                tokio::time::sleep_until(next_allowed).await;
            }
        }
        *gate = Some(Instant::now());

        let request = self.http.get(API_ENDPOINT).query(&[
            ("search_query", config.query.as_str()),
            ("start", "0"),
            ("max_results", max_results.as_str()),
            ("sortBy", "submittedDate"),
            ("sortOrder", "descending"),
        ]);
        let body = fetch_text(request, "arXiv").await;
        drop(gate);
        let body = body?;

        parse_feed(&body, canonical_source_config_json, fetched_at)
            .map_err(|error| SourceFetchError::decode("arXiv", error))
    }
}

pub(crate) fn normalize_config(input: &str) -> Result<String, String> {
    let config = parse_config(input)?;
    let mut sparse = Map::new();

    if config.max_results != DEFAULT_MAX_RESULTS {
        sparse.insert(
            "maxResults".to_owned(),
            Value::from(u64::try_from(config.max_results).unwrap_or(u64::MAX)),
        );
    }
    if config.query != DEFAULT_QUERY {
        sparse.insert("query".to_owned(), Value::String(config.query));
    }

    source_config::canonicalize(&Value::Object(sparse).to_string())
}

fn parse_config(canonical_source_config_json: &str) -> Result<ArxivConfig, String> {
    let config: ArxivConfig = serde_json::from_str(canonical_source_config_json)
        .map_err(|error| format!("invalid arXiv source configuration: {error}"))?;
    let query = config.query.trim();
    if query.is_empty() || query.len() > 512 {
        return Err("arXiv query must contain 1 to 512 characters".to_owned());
    }
    if !(1..=MAX_RESULTS).contains(&config.max_results) {
        return Err(format!(
            "arXiv maxResults must be between 1 and {MAX_RESULTS}"
        ));
    }

    Ok(ArxivConfig {
        query: query.to_owned(),
        max_results: config.max_results,
    })
}

fn parse_feed(
    body: &str,
    canonical_source_config_json: &str,
    fetched_at: i64,
) -> Result<Vec<CacheWriteItem>, String> {
    let feed: AtomFeed = quick_xml::de::from_str(body)
        .map_err(|error| format!("failed to parse arXiv Atom feed: {error}"))?;
    let count = feed.entries.len();

    feed.entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| {
            let stable_id = stable_arxiv_id(&entry.id)?;
            let author = format_authors(&entry.authors);
            let categories: Vec<String> = entry
                .categories
                .into_iter()
                .map(|category| category.term)
                .collect();
            let payload_json = serde_json::json!({
                "published": entry.published,
                "summary": entry.summary.map(|summary| normalize_whitespace(&summary)),
                "categories": categories,
            })
            .to_string();

            Ok(CacheWriteItem {
                id: stable_id.clone(),
                source_kind: "arxiv".to_owned(),
                source_config_json: canonical_source_config_json.to_owned(),
                external_url: format!("https://arxiv.org/abs/{stable_id}"),
                title: Some(normalize_whitespace(&entry.title)),
                image_url: None,
                author,
                published_at: None,
                fetched_at,
                score: (count.saturating_sub(index)) as f64 * 100.0,
                payload_json,
            })
        })
        .collect()
}

fn stable_arxiv_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    let without_prefix = [
        "https://arxiv.org/abs/",
        "http://arxiv.org/abs/",
        "https://export.arxiv.org/abs/",
        "http://export.arxiv.org/abs/",
    ]
    .into_iter()
    .find_map(|prefix| trimmed.strip_prefix(prefix))
    .unwrap_or(trimmed);

    let stable = strip_version_suffix(without_prefix.trim_end_matches('/'));
    if stable.is_empty() || stable.len() > 128 {
        return Err("arXiv entry has an invalid id".to_owned());
    }
    Ok(stable.to_owned())
}

fn strip_version_suffix(id: &str) -> &str {
    let Some(version_index) = id.rfind('v') else {
        return id;
    };
    let suffix = &id[version_index + 1..];
    if !suffix.is_empty() && suffix.chars().all(|character| character.is_ascii_digit()) {
        &id[..version_index]
    } else {
        id
    }
}

fn format_authors(authors: &[AtomAuthor]) -> Option<String> {
    if authors.is_empty() {
        return None;
    }

    let mut names: Vec<String> = authors
        .iter()
        .take(3)
        .map(|author| normalize_whitespace(&author.name))
        .collect();
    if authors.len() > 3 {
        names.push("et al.".to_owned());
    }
    Some(names.join(", "))
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_FEED: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v2</id>
    <published>2024-01-01T00:00:00Z</published>
    <title>
      A   Paper With
      Spacing
    </title>
    <summary>  A useful   abstract. </summary>
    <author><name>Alice Example</name></author>
    <author><name>Bob Example</name></author>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom" />
  </entry>
</feed>"#;

    #[test]
    fn empty_config_uses_bounded_defaults() {
        let config = parse_config("{}").expect("default config should parse");
        assert_eq!(config.query, DEFAULT_QUERY);
        assert_eq!(config.max_results, 3);
    }

    #[test]
    fn semantic_defaults_collapse_to_sparse_canonical_identity() {
        assert_eq!(normalize_config("{}").unwrap(), "{}");
        assert_eq!(
            normalize_config(r#"{"query":"cat:cs.AI","maxResults":3}"#).unwrap(),
            "{}"
        );
        assert_eq!(
            normalize_config(r#"{"query":"  cat:cs.LG  ","maxResults":3}"#).unwrap(),
            r#"{"query":"cat:cs.LG"}"#
        );
        assert_eq!(
            normalize_config(r#"{"maxResults":5}"#).unwrap(),
            r#"{"maxResults":5}"#
        );
    }

    #[test]
    fn invalid_config_is_rejected_before_persistence_or_fetch() {
        assert!(normalize_config(r#"{"query":"   "}"#).is_err());
        assert!(normalize_config(r#"{"maxResults":0}"#).is_err());
        assert!(normalize_config(r#"{"unknown":true}"#).is_err());
    }

    #[test]
    fn atom_feed_normalizes_into_cache_rows() {
        let items = parse_feed(SAMPLE_FEED, "{}", 123).expect("feed should parse");
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "2401.00001");
        assert_eq!(items[0].external_url, "https://arxiv.org/abs/2401.00001");
        assert_eq!(items[0].title.as_deref(), Some("A Paper With Spacing"));
        assert_eq!(
            items[0].author.as_deref(),
            Some("Alice Example, Bob Example")
        );
        assert!(items[0].payload_json.contains("cs.AI"));
    }

    #[test]
    fn legacy_ids_keep_category_prefix_and_versions_are_removed() {
        assert_eq!(
            stable_arxiv_id("http://arxiv.org/abs/hep-ex/0307015v4").unwrap(),
            "hep-ex/0307015"
        );
        assert_eq!(stable_arxiv_id("2501.12345").unwrap(), "2501.12345");
    }
}
