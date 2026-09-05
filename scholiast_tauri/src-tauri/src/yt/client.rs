//! `VISIONOS` InnerTube player client.
//!
//! Request shape recorded live from youtubei.js v18 (2026-09-05): endpoint
//! `youtubei/v1/player` on `www.youtube.com` with the VISIONOS context below
//! is what returns URL-bearing adaptive formats; ANDROID/WEB return
//! cipherless adaptive lists (spike-verified).

use std::sync::Mutex;

use super::error::YtError;

/// Live endpoint; tests override it (mirror `transcript/client.rs:163`).
pub const INNERTUBE_PLAYER_URL: &str =
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false&alt=json";

const BASE_JS_URL: &str = "https://www.youtube.com";

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

/// Pinned client identity (youtubei.js v18 values that resolved streams).
/// Bump together when `YouTube` rotates (see TECH.md maintenance notes).
pub const VISIONOS_NAME: &str = "VISIONOS";
pub const VISIONOS_VERSION: &str = "1.02";
pub const VISIONOS_OS: &str = "visionOS";
pub const VISIONOS_OS_VERSION: &str = "26.5.23O471";
pub const VISIONOS_DEVICE_MAKE: &str = "Apple";
pub const VISIONOS_DEVICE_MODEL: &str = "RealityDevice17,1";

/// The exact context block that resolved streams in the spike.
pub fn visionos_context(visitor_data: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "client": {
            "hl": "en",
            "gl": "US",
            "remoteHost": "",
            "screenDensityFloat": 1,
            "screenHeightPoints": 1440,
            "screenPixelDensity": 1,
            "screenWidthPoints": 2560,
            "visitorData": visitor_data.unwrap_or(""),
            "clientName": VISIONOS_NAME,
            "clientVersion": VISIONOS_VERSION,
            "osName": VISIONOS_OS,
            "osVersion": VISIONOS_OS_VERSION,
            "userAgent": UA,
            "platform": "MOBILE",
            "clientFormFactor": "UNKNOWN_FORM_FACTOR",
            "userInterfaceTheme": "USER_INTERFACE_THEME_LIGHT",
            "originalUrl": "https://www.youtube.com",
            "deviceMake": VISIONOS_DEVICE_MAKE,
            "deviceModel": VISIONOS_DEVICE_MODEL,
            "memoryTotalKbytes": "8000000",
            "mainAppWebInfo": {
                "graftUrl": "https://www.youtube.com",
                "pwaInstallabilityStatus": "PWA_INSTALLABILITY_STATUS_UNKNOWN",
                "webDisplayMode": "WEB_DISPLAY_MODE_BROWSER",
                "isWebNativeShareAvailable": true,
            },
        },
        "user": { "enableSafetyMode": false, "lockedSafetyMode": false },
        "request": { "useSsl": true, "internalExperimentFlags": [] },
    })
}

pub struct YtClient {
    http: reqwest::Client,
    player_endpoint: String,
    visitor_cache: Mutex<Option<String>>,
}

impl YtClient {
    pub fn new() -> Self {
        YtClient {
            http: reqwest::Client::new(),
            player_endpoint: INNERTUBE_PLAYER_URL.to_string(),
            visitor_cache: Mutex::new(None),
        }
    }

    /// Test seam: point the player endpoint at a wiremock server.
    #[cfg(test)]
    pub fn with_player_endpoint(url: impl Into<String>) -> Self {
        YtClient {
            http: reqwest::Client::new(),
            player_endpoint: url.into(),
            visitor_cache: Mutex::new(None),
        }
    }

    fn base_url(&self) -> String {
        if self.player_endpoint == INNERTUBE_PLAYER_URL {
            BASE_JS_URL.to_string()
        } else {
            // Wiremock: same server hosts every fixture path.
            self.player_endpoint
                .split("/youtubei/")
                .next()
                .unwrap_or(BASE_JS_URL)
                .to_string()
        }
    }

    /// Best-effort visitorData handshake (`responseContext.visitorData`);
    /// `None` on any failure — the player call still goes out.
    pub async fn visitor_data(&self) -> Option<String> {
        if let Some(cached) = self.visitor_cache.lock().ok().and_then(|g| g.clone()) {
            return Some(cached);
        }
        let url = format!("{}/youtubei/v1/visitor_id?prettyPrint=false&alt=json", self.base_url());
        let body = serde_json::json!({ "context": visionos_context(None) }).to_string();
        let visitor = self
            .http
            .post(&url)
            .header("Content-Type", "application/json")
            .header("User-Agent", UA)
            .body(body)
            .send()
            .await
            .ok()
            .filter(|r| r.status().is_success())?
            .text()
            .await
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())?
            .pointer("/responseContext/visitorData")
            .and_then(|v| v.as_str())
            .map(str::to_owned);
        if let (Some(v), Ok(mut guard)) = (visitor.clone(), self.visitor_cache.lock()) {
            *guard = Some(v);
        }
        visitor
    }

    /// Raw VISIONOS player response for one video id.
    pub async fn player_response(
        &self,
        video_id: &str,
        sts: Option<u64>,
    ) -> Result<serde_json::Value, YtError> {
        if video_id.trim().is_empty() {
            return Err(YtError::Parse("empty video id".into()));
        }
        let visitor = self.visitor_data().await;
        let mut playback = serde_json::json!({
            "vis": 0,
            "splay": false,
            "lactMilliseconds": "-1",
        });
        if let Some(sts) = sts {
            playback["signatureTimestamp"] = sts.into();
        }
        let body = serde_json::json!({
            "videoId": video_id,
            "racyCheckOk": true,
            "contentCheckOk": true,
            "playbackContext": { "contentPlaybackContext": playback },
            "context": visionos_context(visitor.as_deref()),
        })
        .to_string();
        let response = self
            .http
            .post(&self.player_endpoint)
            .header("Content-Type", "application/json")
            .header("User-Agent", UA)
            .body(body)
            .send()
            .await
            .map_err(|e| YtError::Network(e.to_string()))?;
        if !response.status().is_success() {
            return Err(YtError::Http(response.status().as_u16()));
        }
        let text = response
            .text()
            .await
            .map_err(|e| YtError::Network(e.to_string()))?;
        serde_json::from_str::<serde_json::Value>(&text).map_err(|e| YtError::Parse(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn player_posts_visionos_context() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .and(body_string_contains("\"clientName\":\"VISIONOS\""))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                serde_json::json!({ "playabilityStatus": { "status": "OK" } }),
            ))
            .mount(&server)
            .await;

        let client = YtClient::with_player_endpoint(format!(
            "{}/youtubei/v1/player",
            server.uri()
        ));
        let value = client.player_response("abc12345678", None).await.unwrap();
        assert_eq!(
            value.pointer("/playabilityStatus/status").and_then(|v| v.as_str()),
            Some("OK")
        );
    }

    #[tokio::test]
    async fn visitor_failure_still_plays() {
        // No visitor mock mounted: handshake 404s, player call proceeds.
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                serde_json::json!({ "playabilityStatus": { "status": "OK" } }),
            ))
            .mount(&server)
            .await;

        let client = YtClient::with_player_endpoint(format!(
            "{}/youtubei/v1/player",
            server.uri()
        ));
        assert!(client.visitor_data().await.is_none());
        assert!(client.player_response("abc12345678", None).await.is_ok());
    }
}
