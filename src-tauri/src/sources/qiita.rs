use super::{
    http::{fetch_text, SourceFetchError},
    metadata,
};
use crate::{db::cache::CacheWriteItem, source_config};
use serde::Deserialize;
use serde_json::{Map, Value};

const DEFAULT_QUERY: &str = "";
const DEFAULT_MAX_RESULTS: usize = 3;
const MAX_RESULTS: usize = 25;
const OGP_IMAGE_ENRICH_LIMIT: usize = 3;

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct QiitaConfig {
    query: String,
    max_results: usize,
}

impl Default for QiitaConfig {
    fn default() -> Self {
        Self {
            query: DEFAULT_QUERY.to_owned(),
            max_results: DEFAULT_MAX_RESULTS,
        }
    }
}

#[derive(Debug, Deserialize)]
struct QiitaItem {
    id: String,
    title: String,
    url: String,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    likes_count: u64,
    user: QiitaUser,
}

#[derive(Debug, Deserialize)]
struct QiitaUser {
    id: String,
    #[serde(default)]
    name: String,
}

pub(crate) async fn fetch(
    http: &reqwest::Client,
    canonical_source_config_json: &str,
    fetched_at: i64,
) -> Result<Vec<CacheWriteItem>, SourceFetchError> {
    let config = parse_config(canonical_source_config_json)
        .map_err(|error| SourceFetchError::invalid_config("Qiita", error))?;
    let per_page = config.max_results.to_string();
    let mut request = http
        .get("https://qiita.com/api/v2/items")
        .query(&[("page", "1"), ("per_page", per_page.as_str())]);
    if !config.query.is_empty() {
        request = request.query(&[("query", config.query.as_str())]);
    }
    let body = fetch_text(request, "Qiita").await?;
    let mut items = parse_response(&body, canonical_source_config_json, fetched_at)
        .map_err(|error| SourceFetchError::decode("Qiita", error))?;

    // Qiita's item API does not expose the article OGP image. Enrich only the
    // default glanceable set so thumbnails never turn a large configured feed
    // into an unbounded burst of article-page requests.
    for item in items.iter_mut().take(OGP_IMAGE_ENRICH_LIMIT) {
        item.image_url = metadata::fetch_og_image(http, &item.external_url).await;
    }

    Ok(items)
}

pub(crate) fn normalize_config(input: &str) -> Result<String, String> {
    let config = parse_config(input)?;
    let mut sparse = Map::new();
    if config.query != DEFAULT_QUERY {
        sparse.insert("query".to_owned(), Value::String(config.query));
    }
    if config.max_results != DEFAULT_MAX_RESULTS {
        sparse.insert(
            "maxResults".to_owned(),
            Value::from(u64::try_from(config.max_results).unwrap_or(u64::MAX)),
        );
    }
    source_config::canonicalize(&Value::Object(sparse).to_string())
}

fn parse_config(input: &str) -> Result<QiitaConfig, String> {
    let mut config: QiitaConfig = serde_json::from_str(input)
        .map_err(|error| format!("invalid Qiita source configuration: {error}"))?;
    config.query = config.query.trim().to_owned();
    if config.query.len() > 512 {
        return Err("Qiita query must be at most 512 characters".to_owned());
    }
    if !(1..=MAX_RESULTS).contains(&config.max_results) {
        return Err(format!(
            "Qiita maxResults must be between 1 and {MAX_RESULTS}"
        ));
    }
    Ok(config)
}

fn parse_response(
    body: &str,
    canonical_source_config_json: &str,
    fetched_at: i64,
) -> Result<Vec<CacheWriteItem>, String> {
    let entries: Vec<QiitaItem> = serde_json::from_str(body)
        .map_err(|error| format!("failed to parse Qiita response: {error}"))?;
    let count = entries.len();
    Ok(entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| {
            let author = if entry.user.name.trim().is_empty() {
                entry.user.id.clone()
            } else {
                entry.user.name.trim().to_owned()
            };
            CacheWriteItem {
                id: format!("qiita:{}", entry.id),
                source_kind: "qiita".to_owned(),
                source_config_json: canonical_source_config_json.to_owned(),
                external_url: entry.url,
                title: Some(entry.title),
                image_url: None,
                author: Some(author),
                published_at: None,
                fetched_at,
                score: (count.saturating_sub(index)) as f64 * 100.0 + entry.likes_count as f64,
                payload_json: serde_json::json!({
                    "createdAt": entry.created_at,
                    "updatedAt": entry.updated_at,
                    "likesCount": entry.likes_count,
                    "userId": entry.user.id,
                })
                .to_string(),
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_is_trimmed_sparse_and_bounded() {
        assert_eq!(normalize_config("{}").unwrap(), "{}");
        assert_eq!(parse_config("{}").unwrap().max_results, 3);
        assert_eq!(
            normalize_config(r#"{"query":"  tag:Rust  ","maxResults":5}"#).unwrap(),
            r#"{"maxResults":5,"query":"tag:Rust"}"#
        );
        assert!(normalize_config(r#"{"maxResults":0}"#).is_err());
    }

    #[test]
    fn api_items_become_cache_rows_before_optional_metadata_enrichment() {
        let body = r#"[{"id":"abc123","title":"Rust on Qiita","url":"https://qiita.com/u/items/abc123","created_at":"2026-09-01T00:00:00+09:00","updated_at":"2026-09-01T00:00:00+09:00","likes_count":7,"user":{"id":"nasu","name":"Nasu"}}]"#;
        let items = parse_response(body, "{}", 123).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "qiita:abc123");
        assert_eq!(items[0].author.as_deref(), Some("Nasu"));
        assert_eq!(items[0].image_url, None);
        assert!(items[0].payload_json.contains("likesCount"));
    }
}
