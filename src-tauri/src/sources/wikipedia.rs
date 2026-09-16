use super::http::{fetch_text, SourceFetchError};
use crate::{db::cache::CacheWriteItem, source_config};
use serde::Deserialize;
use serde_json::{Map, Value};

const DEFAULT_LANGUAGE: &str = "ja";
const DEFAULT_MAX_RESULTS: usize = 3;
const MAX_RESULTS: usize = 25;
const WIKIPEDIA_FALLBACK_IMAGE: &str = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20640%20360'%3E%3Crect%20width='640'%20height='360'%20rx='28'%20fill='%23f1f3f5'/%3E%3Ctext%20x='320'%20y='190'%20text-anchor='middle'%20font-family='Georgia,serif'%20font-size='58'%20fill='%23495057'%3EWikipedia%3C/text%3E%3C/svg%3E";

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct WikipediaConfig {
    language: String,
    max_results: usize,
}

impl Default for WikipediaConfig {
    fn default() -> Self {
        Self {
            language: DEFAULT_LANGUAGE.to_owned(),
            max_results: DEFAULT_MAX_RESULTS,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ApiResponse {
    #[serde(default)]
    query: Option<ApiQuery>,
}

#[derive(Debug, Deserialize)]
struct ApiQuery {
    #[serde(default)]
    pages: Vec<ApiPage>,
}

#[derive(Debug, Deserialize)]
struct ApiPage {
    pageid: i64,
    title: String,
    #[serde(default)]
    thumbnail: Option<ApiThumbnail>,
}

#[derive(Debug, Deserialize)]
struct ApiThumbnail {
    source: String,
}

pub(crate) async fn fetch(
    http: &reqwest::Client,
    canonical_source_config_json: &str,
    fetched_at: i64,
) -> Result<Vec<CacheWriteItem>, SourceFetchError> {
    let config = parse_config(canonical_source_config_json)
        .map_err(|error| SourceFetchError::invalid_config("Wikipedia", error))?;
    let endpoint = format!("https://{}.wikipedia.org/w/api.php", config.language);
    let limit = config.max_results.to_string();
    let request = http.get(endpoint).query(&[
        ("action", "query"),
        ("format", "json"),
        ("formatversion", "2"),
        ("generator", "random"),
        ("grnnamespace", "0"),
        ("grnlimit", limit.as_str()),
        ("prop", "pageimages"),
        ("piprop", "thumbnail"),
        ("pithumbsize", "640"),
    ]);
    let body = fetch_text(request, "Wikipedia").await?;
    parse_response(&body, &config, canonical_source_config_json, fetched_at)
        .map_err(|error| SourceFetchError::decode("Wikipedia", error))
}

pub(crate) fn normalize_config(input: &str) -> Result<String, String> {
    let config = parse_config(input)?;
    let mut sparse = Map::new();
    if config.language != DEFAULT_LANGUAGE {
        sparse.insert("language".to_owned(), Value::String(config.language));
    }
    if config.max_results != DEFAULT_MAX_RESULTS {
        sparse.insert(
            "maxResults".to_owned(),
            Value::from(u64::try_from(config.max_results).unwrap_or(u64::MAX)),
        );
    }
    source_config::canonicalize(&Value::Object(sparse).to_string())
}

fn parse_config(input: &str) -> Result<WikipediaConfig, String> {
    let mut config: WikipediaConfig = serde_json::from_str(input)
        .map_err(|error| format!("invalid Wikipedia source configuration: {error}"))?;
    config.language = config.language.trim().to_ascii_lowercase();
    let valid_language = (2..=16).contains(&config.language.len())
        && config
            .language
            .chars()
            .all(|character| character.is_ascii_lowercase() || character == '-');
    if !valid_language {
        return Err("Wikipedia language must be a 2 to 16 character language code".to_owned());
    }
    if !(1..=MAX_RESULTS).contains(&config.max_results) {
        return Err(format!(
            "Wikipedia maxResults must be between 1 and {MAX_RESULTS}"
        ));
    }
    Ok(config)
}

fn parse_response(
    body: &str,
    config: &WikipediaConfig,
    canonical_source_config_json: &str,
    fetched_at: i64,
) -> Result<Vec<CacheWriteItem>, String> {
    let response: ApiResponse = serde_json::from_str(body)
        .map_err(|error| format!("failed to parse Wikipedia response: {error}"))?;
    let pages = response.query.map(|query| query.pages).unwrap_or_default();
    let count = pages.len();
    Ok(pages
        .into_iter()
        .enumerate()
        .map(|(index, page)| CacheWriteItem {
            id: format!("wikipedia:{}:{}", config.language, page.pageid),
            source_kind: "wikipedia".to_owned(),
            source_config_json: canonical_source_config_json.to_owned(),
            external_url: format!(
                "https://{}.wikipedia.org/?curid={}",
                config.language, page.pageid
            ),
            title: Some(page.title),
            image_url: Some(
                page.thumbnail
                    .map(|thumbnail| thumbnail.source)
                    .unwrap_or_else(|| WIKIPEDIA_FALLBACK_IMAGE.to_owned()),
            ),
            author: None,
            published_at: None,
            fetched_at,
            score: (count.saturating_sub(index)) as f64 * 100.0,
            payload_json: serde_json::json!({"language": config.language}).to_string(),
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_sparse_and_language_is_normalized() {
        assert_eq!(normalize_config("{}").unwrap(), "{}");
        assert_eq!(parse_config("{}").unwrap().max_results, 3);
        assert_eq!(
            normalize_config(r#"{"language":" EN ","maxResults":5}"#).unwrap(),
            r#"{"language":"en","maxResults":5}"#
        );
        assert!(normalize_config(r#"{"language":"../bad"}"#).is_err());
    }

    #[test]
    fn api_pages_use_real_or_fallback_thumbnails() {
        let config = parse_config("{}").unwrap();
        let body = r#"{"query":{"pages":[{"pageid":42,"title":"Example","thumbnail":{"source":"https://upload.wikimedia.org/example.jpg"}},{"pageid":43,"title":"No image"}]}}"#;
        let items = parse_response(body, &config, "{}", 123).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "wikipedia:ja:42");
        assert_eq!(items[0].title.as_deref(), Some("Example"));
        assert_eq!(
            items[0].image_url.as_deref(),
            Some("https://upload.wikimedia.org/example.jpg")
        );
        assert_eq!(
            items[1].image_url.as_deref(),
            Some(WIKIPEDIA_FALLBACK_IMAGE)
        );
    }
}
