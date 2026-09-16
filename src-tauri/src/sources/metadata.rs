use super::http::fetch_text;
use reqwest::Client;
use std::time::Duration;

const METADATA_TIMEOUT: Duration = Duration::from_secs(3);

pub(crate) async fn fetch_og_image(http: &Client, url: &str) -> Option<String> {
    let body = fetch_text(
        http.get(url).timeout(METADATA_TIMEOUT),
        "article metadata",
    )
    .await
    .ok()?;
    extract_og_image(&body)
}

fn extract_og_image(html: &str) -> Option<String> {
    let lower = html.to_ascii_lowercase();
    let mut offset = 0;

    while let Some(relative_start) = lower[offset..].find("<meta") {
        let start = offset + relative_start;
        let Some(relative_end) = lower[start..].find('>') else {
            break;
        };
        let end = start + relative_end + 1;
        let tag = &html[start..end];

        let property = html_attribute(tag, "property").or_else(|| html_attribute(tag, "name"));
        if property
            .as_deref()
            .is_some_and(|value| value.eq_ignore_ascii_case("og:image"))
        {
            if let Some(content) = html_attribute(tag, "content") {
                let decoded = decode_html_attribute(&content);
                if decoded.starts_with("https://") || decoded.starts_with("http://") {
                    return Some(decoded);
                }
            }
        }

        offset = end;
    }

    None
}

fn html_attribute(tag: &str, name: &str) -> Option<String> {
    let bytes = tag.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        while index < bytes.len() && !is_attribute_name_byte(bytes[index]) {
            index += 1;
        }
        let name_start = index;
        while index < bytes.len() && is_attribute_name_byte(bytes[index]) {
            index += 1;
        }
        if name_start == index {
            continue;
        }
        let candidate = &tag[name_start..index];
        if !candidate.eq_ignore_ascii_case(name) {
            continue;
        }

        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if bytes.get(index) != Some(&b'=') {
            continue;
        }
        index += 1;
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }

        let quote = *bytes.get(index)?;
        if quote != b'\'' && quote != b'"' {
            continue;
        }
        index += 1;
        let value_start = index;
        while index < bytes.len() && bytes[index] != quote {
            index += 1;
        }
        if index >= bytes.len() {
            return None;
        }
        return Some(tag[value_start..index].to_owned());
    }

    None
}

fn is_attribute_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':')
}

fn decode_html_attribute(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_og_image_regardless_of_attribute_order_or_quote_style() {
        assert_eq!(
            extract_og_image(
                r#"<html><head><meta property="og:image" content="https://example.com/og.png?a=1&amp;b=2"></head></html>"#,
            )
            .as_deref(),
            Some("https://example.com/og.png?a=1&b=2")
        );
        assert_eq!(
            extract_og_image(
                r#"<meta content='https://example.com/second.jpg' property='OG:IMAGE'>"#,
            )
            .as_deref(),
            Some("https://example.com/second.jpg")
        );
    }

    #[test]
    fn skips_malformed_og_image_before_a_valid_one() {
        assert_eq!(
            extract_og_image(
                r#"<meta property="og:image"><meta property="og:image" content="https://example.com/valid.png">"#,
            )
            .as_deref(),
            Some("https://example.com/valid.png")
        );
    }

    #[test]
    fn ignores_non_http_or_unrelated_metadata() {
        assert_eq!(
            extract_og_image(r#"<meta property="og:title" content="Hello">"#),
            None
        );
        assert_eq!(
            extract_og_image(r#"<meta property="og:image" content="data:image/png;base64,abc">"#),
            None
        );
    }
}
