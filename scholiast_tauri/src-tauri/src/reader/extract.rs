//! Article extraction pipeline (plan §6.9 step 1): fetch a URL like a
//! browser, extract the readable article, and hand back sanitizer-ready HTML.
//!
//! - Fetching: `reqwest` with a desktop-browser User-Agent, 30 s timeout,
//!   rustls. The body is decoded from BOM → header charset → `<meta charset>`
//!   sniff → UTF-8 lossy, mirroring what browsers do.
//! - Extraction: `dom_smoothie`, the maintained pure-Rust port of Mozilla
//!   Readability (the legacy `readability` crate has been dormant since 2023
//!   and pulls unmaintained deps). Title/byline come from OpenGraph/JSON-LD
//!   when present, falling back to `<title>`/`<h1>` heuristics.
//! - Errors are typed so the frontend can route each to its own empty state:
//!   network failure vs. blocked/paywalled (HTTP status) vs. "this page has
//!   no article in it".

use std::time::Duration;

use dom_smoothie::Readability;
use scholiast_core::error::ScholiastError;
use scholiast_core::sanitize::sanitize_html;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
/// How many leading bytes to scan for a `<meta charset>` declaration.
const META_SNIFF_LEN: usize = 4096;

#[derive(Debug, Clone)]
pub struct ExtractedArticle {
    pub title: String,
    pub byline: Option<String>,
    /// Readability output — still untrusted; sanitize before storing.
    pub body_html: String,
}

#[derive(Debug)]
pub enum ExtractError {
    Network(String),
    FetchBlocked(u16),
    NotReadable(String),
}

impl From<ExtractError> for ScholiastError {
    fn from(err: ExtractError) -> Self {
        match err {
            ExtractError::Network(message) => ScholiastError::Network(message),
            ExtractError::FetchBlocked(status) => ScholiastError::FetchBlocked(status),
            ExtractError::NotReadable(message) => ScholiastError::NotReadable(message),
        }
    }
}

/// One-shot client per fetch: a capture issues exactly one GET, so there is
/// nothing to pool — and no keep-alive connection that could outlive the
/// server it was opened against (matters in tests where many mock servers
/// bind short-lived ephemeral ports concurrently).
fn make_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(FETCH_TIMEOUT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// GETs `url` and decodes the body to a Rust string per browser rules:
/// BOM, then Content-Type charset param, then `<meta charset>` sniff inside
/// the first [`META_SNIFF_LEN`] bytes, then UTF-8 replacement-decoded.
pub async fn fetch_html(url: &str) -> Result<String, ExtractError> {
    let response = make_client()
        .get(url)
        .send()
        .await
        .map_err(|err| ExtractError::Network(err.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(ExtractError::FetchBlocked(status.as_u16()));
    }
    let header_charset = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(content_type_charset);
    let bytes = response
        .bytes()
        .await
        .map_err(|err| ExtractError::Network(err.to_string()))?;
    Ok(decode_html(&bytes, header_charset.as_deref()))
}

fn content_type_charset(content_type: &str) -> Option<String> {
    content_type.split(';').skip(1).find_map(|param| {
        let param = param.trim();
        param.strip_prefix("charset=").map(|label| {
            label.trim_matches(|c| c == '"' || c == '\'').to_string()
        })
    })
}

fn decode_html(bytes: &[u8], header_charset: Option<&str>) -> String {
    if let Some((encoding, _)) = encoding_rs::Encoding::for_bom(bytes) {
        return decode_with(encoding, bytes);
    }
    if let Some(label) = header_charset.and_then(|l| encoding_rs::Encoding::for_label(l.as_bytes()))
    {
        return decode_with(label, bytes);
    }
    if let Some(encoding) =
        meta_charset(&bytes[..bytes.len().min(META_SNIFF_LEN)])
            .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
    {
        return decode_with(encoding, bytes);
    }
    String::from_utf8_lossy(bytes).into_owned()
}

// `Encoding::decode` takes `&'static self`; every lookup here
// (`for_bom` / `for_label`) yields a `&'static Encoding`, so keep that
// lifetime through the helper instead of shortening it to an anonymous one.
fn decode_with(encoding: &'static encoding_rs::Encoding, bytes: &[u8]) -> String {
    let (decoded, _, _) = encoding.decode(bytes);
    decoded.into_owned()
}

/// Finds the charset label of a `<meta charset=…>` /
/// `<meta http-equiv="content-type" content="…; charset=…">` declaration in
/// the document head. Only meaningful for ASCII-compatible encodings, which
/// is exactly when meta sniffing is allowed anyway.
fn meta_charset(head: &[u8]) -> Option<String> {
    let lower: Vec<u8> = head.iter().map(|b| b.to_ascii_lowercase()).collect();
    let text = String::from_utf8_lossy(&lower);
    let rest = &text[text.find("charset=")? + "charset=".len()..];
    let rest = rest
        .strip_prefix('"')
        .or_else(|| rest.strip_prefix('\''))
        .unwrap_or(rest);
    let end = rest
        .find(['"', '\'', '>', ' ', '/', ';'])
        .unwrap_or(rest.len());
    let label = rest[..end].trim();
    (!label.is_empty()).then(|| label.to_string())
}

/// Runs Readability over fetched HTML. CPU-heavy: call from
/// `spawn_blocking` (see [`capture_article_html`]).
pub fn extract_article(html: &str, url: &str) -> Result<ExtractedArticle, ExtractError> {
    let mut readability = Readability::new(html, Some(url), None)
        .map_err(|err| ExtractError::NotReadable(format!("unreadable page: {err}")))?;
    if !readability.is_probably_readable() {
        // Navigation chrome / app shells score zero on the p/pre/article
        // heuristic — extraction would happily "succeed" with menu links.
        return Err(ExtractError::NotReadable(
            "page carries no article-like content".into(),
        ));
    }
    let article = readability
        .parse()
        .map_err(|err| ExtractError::NotReadable(format!("no article found: {err}")))?;
    let body_html = article.content.trim().to_string();
    if body_html.is_empty() || article.length == 0 {
        return Err(ExtractError::NotReadable("no readable content found".into()));
    }
    Ok(ExtractedArticle {
        title: article.title.trim().to_string(),
        byline: article
            .byline
            .map(|b| b.trim().to_string())
            .filter(|b| !b.is_empty()),
        body_html,
    })
}

/// Full capture pipeline for one URL: fetch (async IO), then extract +
/// sanitize off-thread (`spawn_blocking` — Readability walks the whole DOM).
/// The returned body is safe-to-render HTML with absolute URLs.
pub async fn capture_article_html(url: &str) -> Result<ExtractedArticle, ScholiastError> {
    let html = fetch_html(url).await?;
    let base_url = url.to_string();
    tokio::task::spawn_blocking(move || {
        let extracted = extract_article(&html, &base_url)?;
        let body_html = sanitize_html(&extracted.body_html, Some(&base_url));
        if body_html.trim().is_empty() {
            return Err(ScholiastError::NotReadable(
                "article was empty after sanitization".into(),
            ));
        }
        Ok(ExtractedArticle {
            title: extracted.title,
            byline: extracted.byline,
            body_html,
        })
    })
    .await
    .map_err(|err| ScholiastError::Internal(err.to_string()))?
}

pub const UBLOCK_COSMETIC_CSS: &str = r#"
/* Universal uBlock Origin / EasyList Ad & Tracker Element Hiding */
.adsbygoogle, [id^="google_ads_"], [id*="-ad-"], [id$="-ad"], [id*="advertisement"],
.ad-banner, .ad-container, .ad-wrapper, .ad-slot, .ad-box, .advertisement, .advert,
.ad_top, .ad_bottom, .ad-placeholder, .top-ad, .sidebar-ad, .banner-ad,
.sponsor-container, .sponsored-post, .sponsored-content, [data-ad-unit], [data-ad-slot], [data-ad-client],
.outbrain, .taboola, .revcontent, .zergnet-widget,
#onetrust-consent-sdk, .onetrust-pc-dark-filter, .cookie-banner, .cookie-notice,
.cookie-consent, .gdpr-banner, .consent-banner, [id*="cookie-notice"],
[class*="cookie-banner"], [class*="floating-ad"], [id*="floating-ad"],
.sticky-ad, [data-ad-type="sticky"], [class*="Sponsored"],
[aria-label*="advertisement" i], [aria-label*="sponsored" i],
.pane-ad, .sidebar-ads, .ad-leaderboard {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  max-height: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
html, body {
  overflow: auto !important;
  position: static !important;
}
"#;

/// Prepares full authentic HTML for in-app viewing:
/// Injects <base> URL for styles/assets, no-referrer meta to bypass CDN hotlink protection,
/// uBlock Origin cosmetic element hiding CSS, and neutralizes ad tracker scripts.
pub fn prepare_authentic_html(html: &str, base_url: &str) -> String {
    let base_tag = format!(r#"<base href="{}"><meta name="referrer" content="no-referrer">"#, base_url);
    let ublock_style = format!(r#"<style id="ublock-cosmetic-filters">{}</style>"#, UBLOCK_COSMETIC_CSS);
    let injection = format!("{}\n{}", base_tag, ublock_style);

    let lower = html.to_ascii_lowercase();
    let mut output = if let Some(pos) = lower.find("<head>") {
        let insert_idx = pos + "<head>".len();
        format!("{}\n{}{}", &html[..insert_idx], injection, &html[insert_idx..])
    } else if let Some(pos) = lower.find("<head ") {
        if let Some(end_head) = html[pos..].find('>') {
            let insert_idx = pos + end_head + 1;
            format!("{}\n{}{}", &html[..insert_idx], injection, &html[insert_idx..])
        } else {
            format!("{}\n{}", injection, html)
        }
    } else {
        format!("{}\n{}", injection, html)
    };

    const AD_DOMAINS: &[&str] = &[
        "pagead2.googlesyndication.com",
        "doubleclick.net",
        "adservice.google",
        "googletagmanager.com/gtm.js",
        "criteo.net",
        "outbrain.com",
        "taboola.com",
        "adnxs.com",
        "amazon-adsystem.com",
    ];

    for domain in AD_DOMAINS {
        output = output.replace(domain, "blocked-tracker.invalid");
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const DIRTY_ARTICLE: &str = include_str!(
        "../../../crates/core/tests/fixtures/reader/dirty-article.html"
    );
    const JUNK_PAGE: &str =
        include_str!("../../../crates/core/tests/fixtures/reader/junk-nav-page.html");

    /// Starts a server that must be held (the returned `MockServer` guard)
    /// for the whole test: dropping it frees the port while sibling tests
    /// run concurrently, and a rebound port would serve someone else's mock.
    async fn serve(body: impl Into<Vec<u8>>, content_type: &'static str) -> (MockServer, String) {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/a"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_bytes(body.into())
                    .insert_header("Content-Type", content_type),
            )
            .mount(&server)
            .await;
        let url = format!("{}/a", server.uri());
        (server, url)
    }

    #[tokio::test]
    async fn fetch_decodes_header_declared_latin1() {
        let (encoded, _, _) = encoding_rs::WINDOWS_1252.encode("<p>caf\u{e9} cr\u{e8}me</p>");
        let (_server, url) = serve(encoded.to_vec(), "text/html; charset=iso-8859-1").await;
        assert!(fetch_html(&url).await.unwrap().contains("café crème"));
    }

    #[tokio::test]
    async fn fetch_falls_back_to_meta_charset() {
        let html = "<html><head><meta http-equiv=\"Content-Type\" \
                    content=\"text/html; charset=iso-8859-1\"></head>\
                    <body><p>na\u{ef}ve</p></body></html>";
        let (encoded, _, _) = encoding_rs::WINDOWS_1252.encode(html);
        // Content-Type without a charset parameter forces the meta sniff.
        let (_server, url) = serve(encoded.to_vec(), "text/html").await;
        assert!(fetch_html(&url).await.unwrap().contains("naïve"));
    }

    #[tokio::test]
    async fn http_403_maps_to_fetch_blocked() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        let err = fetch_html(&format!("{}/a", server.uri())).await.unwrap_err();
        assert!(matches!(err, ExtractError::FetchBlocked(403)));
    }

    #[tokio::test]
    async fn unreachable_host_maps_to_network() {
        // Grab an ephemeral port and free it: connecting there is refused.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        let err = fetch_html(&format!("http://{addr}/x")).await.unwrap_err();
        assert!(matches!(err, ExtractError::Network(_)));
    }

    #[test]
    fn extraction_pulls_title_byline_and_body_from_fixture() {
        let extracted = extract_article(DIRTY_ARTICLE, "https://blog.example.org/posts/h")
            .expect("fixture is readable");
        assert_eq!(extracted.title, "The Hidden Lives of Highlighters");
        // Readability keeps the byline's leading "By " from the markup.
        assert!(
            extracted
                .byline
                .as_deref()
                .is_some_and(|b| b.contains("Mira Kellermann")),
            "byline: {:?}",
            extracted.byline
        );
        assert!(extracted.body_html.contains("<h2>"), "body keeps headings");
        assert!(extracted.body_html.contains("pyranine"));
        assert!(!extracted.body_html.contains("<script"));
        assert!(!extracted.body_html.contains("site-nav"));
    }

    #[test]
    fn extraction_is_stable_across_runs() {
        let url = "https://blog.example.org/posts/highlighters";
        let first = extract_article(DIRTY_ARTICLE, url).unwrap();
        let second = extract_article(DIRTY_ARTICLE, url).unwrap();
        assert_eq!(first.title, second.title);
        assert_eq!(first.body_html, second.body_html);
    }

    #[test]
    fn nav_heavy_junk_page_is_not_readable() {
        let err = extract_article(JUNK_PAGE, "https://shop.example.org/")
            .expect_err("junk page must not parse as an article");
        assert!(matches!(err, ExtractError::NotReadable(_)));
    }

    #[tokio::test]
    async fn full_pipeline_sanitizes_and_makes_urls_absolute() {
        let (_server, base) = serve(DIRTY_ARTICLE, "text/html; charset=utf-8").await;
        let article = capture_article_html(&base).await.expect("pipeline ok");
        assert_eq!(article.title, "The Hidden Lives of Highlighters");
        assert!(!article.body_html.contains("<script"));
        assert!(!article.body_html.contains("onclick"));
        assert!(!article.body_html.contains("srcset"));
        assert!(
            article.body_html.contains("/images/header.jpg"),
            "relative img resolved against capture url: {}",
            article.body_html
        );
        assert!(
            article.body_html.contains("cdn.example.org/img/inline.png"),
            "protocol-relative img resolved against capture url (base is http on loopback): {}",
            article.body_html
        );
    }

    #[tokio::test]
    async fn pipeline_surfaces_fetch_blocked_as_scholiast_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/paywalled"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        let err = capture_article_html(&format!("{}/paywalled", server.uri()))
            .await
            .unwrap_err();
        assert!(matches!(err, ScholiastError::FetchBlocked(401)));
        assert_eq!(err.kind(), "fetchBlocked");
    }
}
