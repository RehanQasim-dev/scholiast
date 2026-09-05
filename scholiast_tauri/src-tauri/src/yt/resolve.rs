//! Resolve orchestration: player response → playability gate → deciphered
//! manifest. Pure over `serde_json::Value` except the decipher step, so the
//! mapping is wiremock-testable without JavaScript.

use super::decipher::DecipherEngine;
use super::error::YtError;
use super::formats::{classify, ClassifiedStream};
use crate::transcript::client::extract_caption_tracks;

/// Caption track as exposed to the player (timedtext URL included).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestCaption {
    pub language_code: String,
    pub name: String,
    pub base_url: String,
    pub is_asr: bool,
}

/// Everything the native player needs for one video.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamManifest {
    pub video_id: String,
    pub title: Option<String>,
    pub length_seconds: Option<i64>,
    pub streams: Vec<ClassifiedStream>,
    pub hls_url: Option<String>,
    pub captions: Vec<ManifestCaption>,
}

/// 16-char playback nonce (`cpn`), same alphabet youtubei.js uses.
fn nonce() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    const ABC: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15);
    let mut out = String::with_capacity(16);
    for _ in 0..16 {
        seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        out.push(ABC[(seed >> 33) as usize % ABC.len()] as char);
    }
    out
}

/// Split a `signatureCipher`/`cipher` query map (`url`, `s`, `sp` keys).
fn parse_cipher_map(raw: &str) -> Option<(String, String, String)> {
    let mut url = None;
    let mut sig = None;
    let mut sp = None;
    for pair in raw.split('&') {
        let (k, v) = pair.split_once('=')?;
        match k {
            "url" => url = Some(v.to_string()),
            "s" => sig = Some(v.to_string()),
            "sp" => sp = Some(v.to_string()),
            _ => {}
        }
    }
    Some((url?, sig?, sp?))
}

/// Percent-decode a query value (cipher maps are URL-encoded).
fn pct_decode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h << 4 | l) as char);
                i += 3;
                continue;
            }
        }
        out.push(if bytes[i] == b'+' { ' ' } else { bytes[i] as char });
        i += 1;
    }
    out
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Resolve one format entry to a playable URL (direct, or deciphered).
async fn format_url(
    decipher: &DecipherEngine,
    player_id: &str,
    video_id: &str,
    cpn: &str,
    format: &serde_json::Value,
) -> Option<String> {
    if let Some(direct) = format.get("url").and_then(|v| v.as_str()) {
        return Some(with_cpn(direct, cpn));
    }
    let cipher_raw = format
        .get("signatureCipher")
        .or_else(|| format.get("cipher"))
        .and_then(|v| v.as_str())?;
    let (url_enc, sig_enc, sp_enc) = parse_cipher_map(cipher_raw)?;
    let (url, sig, sp) = (pct_decode(&url_enc), pct_decode(&sig_enc), pct_decode(&sp_enc));
    let clear = decipher.deobfuscate_sig(player_id, video_id, &sig).await.ok()?;
    let mut full = format!("{url}&{sp}={clear}");
    // Descramble the throttling parameter when present (wrong `n` = 403 or
    // ~50 KB/s per YoutubeJavaScriptPlayerManager docs).
    if let Some(n_pos) = full.find("&n=") {
        let rest = &full[n_pos + 3..];
        let end = rest.find('&').map(|e| n_pos + 3 + e).unwrap_or(full.len());
        let n_in = full[n_pos + 3..end].to_string();
        if let Ok(n_out) = decipher.descramble_n(player_id, video_id, &n_in).await {
            full.replace_range(n_pos + 3..end, &n_out);
        }
    }
    Some(with_cpn(&full, cpn))
}

fn with_cpn(url: &str, cpn: &str) -> String {
    if url.contains("cpn=") {
        url.to_string()
    } else if url.contains('?') {
        format!("{url}&cpn={cpn}")
    } else {
        format!("{url}?cpn={cpn}")
    }
}

/// Fail the resolve when the playability gate is not `OK`.
pub fn check_playability(response: &serde_json::Value) -> Result<(), YtError> {
    let status = response
        .pointer("/playabilityStatus/status")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if status == "OK" {
        return Ok(());
    }
    if status == "LIVE_STREAM_OFFLINE" {
        return Err(YtError::Upcoming);
    }
    let reason = response
        .pointer("/playabilityStatus/reason")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let messages = response
        .pointer("/playabilityStatus/errorScreen/playerErrorMessageRenderer/reason/runs")
        .and_then(|v| v.as_array())
        .map(|runs| {
            runs.iter()
                .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
        })
        .unwrap_or_default();
    let hay = format!("{reason} {messages}");
    if status == "LOGIN_REQUIRED" && hay.contains("private") {
        return Err(YtError::Private);
    }
    if hay.contains("private") {
        return Err(YtError::Private);
    }
    if hay.contains("premium") || hay.contains("members") || hay.contains("payment") {
        return Err(YtError::Paid);
    }
    if hay.contains("country") || hay.contains("region") {
        return Err(YtError::GeoBlocked);
    }
    if status == "LOGIN_REQUIRED" && hay.contains("bot") {
        return Err(YtError::BotGuard);
    }
    if status == "LOGIN_REQUIRED" {
        return Err(YtError::LoginRequired);
    }
    if hay.contains("drm") || hay.contains("widevine") {
        return Err(YtError::Drm);
    }
    Err(YtError::Unavailable(
        response
            .pointer("/playabilityStatus/reason")
            .and_then(|v| v.as_str())
            .unwrap_or(status)
            .to_string(),
    ))
}

/// Ghost-response guard: the returned video must be the requested one
/// (ANDROID ghost responses + rate-limit substitutes, NewPipe #8713).
pub fn check_video_id(response: &serde_json::Value, video_id: &str) -> Result<(), YtError> {
    match response
        .pointer("/videoDetails/videoId")
        .and_then(|v| v.as_str())
    {
        Some(got) if got == video_id => Ok(()),
        Some(got) => Err(YtError::Parse(format!("ghost response for {got}"))),
        // player responses without videoDetails (e.g. minimal fixtures) skip
        // the guard — playability + streams still decide.
        None => Ok(()),
    }
}

/// Build the manifest from a validated player response.
pub async fn build_manifest(
    decipher: &DecipherEngine,
    player_id: &str,
    video_id: &str,
    response: &serde_json::Value,
) -> Result<StreamManifest, YtError> {
    check_playability(response)?;
    check_video_id(response, video_id)?;
    let cpn = nonce();
    let mut streams = Vec::new();
    let debug = std::env::var("YT_DEBUG").is_ok();
    for key in ["formats", "adaptiveFormats"] {
        if let Some(list) = response
            .pointer(&format!("/streamingData/{key}"))
            .and_then(|v| v.as_array())
        {
            if debug {
                eprintln!("YT_DEBUG {key}: {} entries", list.len());
                for f in list {
                    eprintln!(
                        "YT_DEBUG   itag={:?} url={} cipher={} mime={:?}",
                        f.get("itag"),
                        f.get("url").is_some(),
                        f.get("signatureCipher").is_some() || f.get("cipher").is_some(),
                        f.get("mimeType"),
                    );
                }
            }
            for format in list {
                match format_url(decipher, player_id, video_id, &cpn, format).await {
                    Some(url) => {
                        if let Some(classified) = classify(format, url) {
                            streams.push(classified);
                        } else if debug {
                            eprintln!("YT_DEBUG   dropped by classify itag={:?}", format.get("itag"));
                        }
                    }
                    None => {
                        if debug {
                            eprintln!("YT_DEBUG   url resolve failed itag={:?}", format.get("itag"));
                        }
                    }
                }
            }
        } else if debug {
            eprintln!("YT_DEBUG {key}: missing");
        }
    }
    if streams.is_empty() {
        return Err(YtError::NoStreams);
    }
    let captions = extract_caption_tracks(response)
        .into_iter()
        .map(|t| ManifestCaption {
            language_code: t.language_code,
            name: t.name,
            base_url: t.base_url,
            is_asr: t.is_asr,
        })
        .collect();
    Ok(StreamManifest {
        video_id: video_id.to_string(),
        title: response
            .pointer("/videoDetails/title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        length_seconds: response
            .pointer("/videoDetails/lengthSeconds")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok()),
        streams,
        hls_url: response
            .pointer("/streamingData/hlsManifestUrl")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        captions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_player() -> serde_json::Value {
        serde_json::json!({
            "playabilityStatus": { "status": "OK" },
            "videoDetails": { "videoId": "vid1", "title": "T", "lengthSeconds": "60" },
            "streamingData": {
                "formats": [{
                    "itag": 18, "mimeType": "video/mp4",
                    "hasAudio": true, "hasVideo": true,
                    "qualityLabel": "360p",
                    "url": "https://example.com/v18?x=1",
                }],
            },
            "captions": { "playerCaptionsTracklistRenderer": { "captionTracks": [{
                "languageCode": "en",
                "name": { "simpleText": "English" },
                "baseUrl": "https://example.com/cap",
            }] } },
        })
    }

    #[test]
    fn playability_table() {
        let err = |status: &str, reason: &str| {
            check_playability(&serde_json::json!({
                "playabilityStatus": { "status": status, "reason": reason },
            }))
            .unwrap_err()
        };
        assert!(check_playability(&serde_json::json!(
            {"playabilityStatus": {"status": "OK"}})).is_ok());
        assert_eq!(err("LOGIN_REQUIRED", "private video"), YtError::Private);
        assert_eq!(err("ERROR", "join members to watch"), YtError::Paid);
        assert_eq!(err("UNPLAYABLE", "not available in your country"), YtError::GeoBlocked);
        assert_eq!(err("LOGIN_REQUIRED", "sign in to confirm"), YtError::LoginRequired);
        assert!(matches!(err("ERROR", "brave new world"), YtError::Unavailable(_)));
    }

    #[test]
    fn ghost_responses_rejected() {
        let mut resp = ok_player();
        assert!(check_video_id(&resp, "vid1").is_ok());
        resp["videoDetails"]["videoId"] = serde_json::json!("other");
        assert!(check_video_id(&resp, "vid1").is_err());
    }

    #[tokio::test]
    async fn direct_url_manifest_skips_decipher() {
        // No cipher anywhere: build_manifest must not touch the network.
        let decipher = DecipherEngine::with_base("http://127.0.0.1:9");
        let manifest = build_manifest(&decipher, "deadbeef", "vid1", &ok_player())
            .await
            .unwrap();
        assert_eq!(manifest.streams.len(), 1);
        assert_eq!(manifest.streams[0].itag, 18);
        assert!(manifest.streams[0].url.contains("&cpn="));
        assert_eq!(manifest.captions.len(), 1);
        assert_eq!(manifest.title.as_deref(), Some("T"));
    }

    #[test]
    fn cipher_map_parsing() {
        let (u, s, sp) = parse_cipher_map("url=https%3A%2F%2Fx&s=ABC&sp=sig").unwrap();
        assert_eq!(pct_decode(&u), "https://x");
        assert_eq!(s, "ABC");
        assert_eq!(sp, "sig");
        assert!(parse_cipher_map("url=x").is_none());
    }
}
