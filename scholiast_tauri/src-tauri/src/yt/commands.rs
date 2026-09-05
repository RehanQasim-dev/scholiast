//! Tauri commands for native stream resolution.

use scholiast_core::error::ScholiastError;
use serde::Serialize;

use super::client::YtClient;
use super::decipher::DecipherEngine;
use super::resolve::{build_manifest, StreamManifest};

/// Resolve a video id to a fresh (never persisted) stream manifest.
#[tauri::command]
pub async fn yt_resolve(video_id: String) -> Result<StreamManifest, ScholiastError> {
    let video_id = video_id.trim().to_string();
    if video_id.is_empty() || video_id.len() > 32 {
        return Err(ScholiastError::InvalidInput("bad video id".into()));
    }
    let client = YtClient::new();
    let decipher = DecipherEngine::new();
    let player_id = decipher.player_id(&video_id).await?;
    let response = client.player_response(&video_id, None).await?;
    // Signature timestamp comes from the same base.js the decipher runs.
    let with_sts = match decipher.sources(&player_id, &video_id).await {
        Ok(sources) => {
            // Re-request with sts when known (youtubei.js sends it); the
            // first response is kept if this fails.
            match sources.sts {
                Some(sts) => client.player_response(&video_id, Some(sts)).await.unwrap_or(response),
                None => response,
            }
        }
        Err(_) => response,
    };
    build_manifest(&decipher, &player_id, &video_id, &with_sts)
        .await
        .map_err(ScholiastError::from)
}

/// Timedtext (VTT) for one caption track — what `<track>` elements load.
#[derive(Debug, Clone, Serialize)]
pub struct YtCaptions {
    pub language_code: String,
    pub vtt: String,
}

#[tauri::command]
pub async fn yt_captions(video_id: String, language_code: String) -> Result<YtCaptions, ScholiastError> {
    let client = YtClient::new();
    // Captions need no deciphering: playability + track list suffice.
    let response = client.player_response(&video_id, None).await?;
    super::resolve::check_playability(&response).map_err(ScholiastError::from)?;
    let tracks = crate::transcript::client::extract_caption_tracks(&response);
    let track = tracks
        .iter()
        .find(|t| t.language_code == language_code)
        .or_else(|| tracks.iter().find(|t| t.language_code.starts_with("en")))
        .or_else(|| tracks.first())
        .ok_or_else(|| ScholiastError::NotFound("no captions".into()))?;
    let url = if track.base_url.contains("fmt=") {
        track.base_url.clone()
    } else {
        format!("{}&fmt=vtt", track.base_url)
    };
    let vtt = reqwest::Client::new()
        .get(&url)
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| ScholiastError::Network(e.to_string()))?
        .text()
        .await
        .map_err(|e| ScholiastError::Network(e.to_string()))?;
    Ok(YtCaptions { language_code: track.language_code.clone(), vtt })
}

#[cfg(test)]
mod tests {
    use super::super::resolve::build_manifest;
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn player_ok() -> serde_json::Value {
        serde_json::json!({
            "playabilityStatus": { "status": "OK" },
            "videoDetails": { "videoId": "vid9", "title": "Live James", "lengthSeconds": "30" },
            "streamingData": {
                "formats": [{
                    "itag": 18, "mimeType": "video/mp4",
                    "hasAudio": true, "hasVideo": true,
                    "qualityLabel": "360p",
                    "url": "https://example.com/v",
                }],
                "hlsManifestUrl": "https://example.com/hls.m3u8",
            },
        })
    }

    #[tokio::test]
    async fn resolve_end_to_end_over_wiremock() {
        let server = MockServer::start().await;
        // iframe_api player-id bootstrap.
        Mock::given(method("GET"))
            .and(path("/iframe_api"))
            .respond_with(ResponseTemplate::new(200).set_body_string("player\\/ab12cd34\\/"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .respond_with(ResponseTemplate::new(200).set_body_json(player_ok()))
            .mount(&server)
            .await;

        let base = server.uri();
        let client = YtClient::with_player_endpoint(format!("{base}/youtubei/v1/player"));
        let decipher = DecipherEngine::with_base(&base);
        let player_id = decipher.player_id("vid9").await.unwrap();
        assert_eq!(player_id, "ab12cd34");
        let response = client.player_response("vid9", None).await.unwrap();
        let manifest = build_manifest(&decipher, &player_id, "vid9", &response)
            .await
            .unwrap();
        assert_eq!(manifest.video_id, "vid9");
        assert_eq!(manifest.streams.len(), 1);
        assert_eq!(manifest.hls_url.as_deref(), Some("https://example.com/hls.m3u8"));
    }

    #[tokio::test]
    async fn ciphered_format_deciphers_over_wiremock() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/s/player/ab12cd34/player_ias.vflset/en_US/base.js"))
            .respond_with(ResponseTemplate::new(200).set_body_string(
                "var AB={kq:function(a,b){var c=a[0];a[0]=a[b%a.length];a[b]=c;return a;}};\
                 var xy=function(a){a=a.split(\"\");AB.kq(a,1);return a.join(\"\")};",
            ))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "playabilityStatus": { "status": "OK" },
                "videoDetails": { "videoId": "vid9", "title": "T", "lengthSeconds": "10" },
                "streamingData": { "formats": [{
                    "itag": 18, "mimeType": "video/mp4",
                    "hasAudio": true, "hasVideo": true,
                    "signatureCipher": "url=https%3A%2F%2Fex.com%2Fv&s=cba&sp=sig",
                }] },
            })))
            .mount(&server)
            .await;

        let base = server.uri();
        let client = YtClient::with_player_endpoint(format!("{base}/youtubei/v1/player"));
        let decipher = DecipherEngine::with_base(&base);
        // Player id is passed straight through: only base.js + the player
        // response are exercised here.
        let response = client.player_response("vid9", None).await.unwrap();
        // xy("cba"): split → kq(a,1) swaps [0]<->[1] → "bca".
        let manifest = build_manifest(&decipher, "ab12cd34", "vid9", &response)
            .await
            .unwrap();
        assert_eq!(manifest.streams.len(), 1);
        assert!(manifest.streams[0].url.contains("https://ex.com/v&sig=bca"));
    }

    /// Live proof against real YouTube (ignored in CI; run on demand):
    /// `cargo test -p scholiast --lib live_ -- --ignored --nocapture`.
    /// Asserts the full chain — discovery, VISIONOS streams, decipher,
    /// captions — outside fixtures.
    #[tokio::test]
    #[ignore]
    async fn live_resolve_real_video() {
        let out = yt_resolve("dQw4w9WgXcQ".to_string()).await.unwrap();
        assert!(!out.streams.is_empty(), "expected streams");
        // VISIONOS serves adaptive-only here: separate audio + video tracks
        // (muxed progressive appears on other videos/clients).
        use super::super::formats::StreamKind;
        assert!(
            out.streams.iter().any(|s| s.kind == StreamKind::Audio),
            "expected an audio stream"
        );
        assert!(
            out.streams.iter().any(|s| s.kind == StreamKind::VideoOnly),
            "expected a video-only stream"
        );
        assert!(!out.captions.is_empty(), "expected caption tracks");
    }
}
