//! itag classification (NewPipe `ItagItem` table, trimmed to what the player
//! needs). Unknown itags are skipped, never fatal — YouTube adds them
//! without notice.

use serde::Serialize;

/// Delivery kind from the app's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StreamKind {
    /// Muxed audio+video: direct `<video>` src.
    Progressive,
    Audio,
    VideoOnly,
}

/// One classified, URL-bearing format.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifiedStream {
    pub itag: i64,
    pub kind: StreamKind,
    pub mime: String,
    pub codecs: String,
    pub quality_label: Option<String>,
    pub bitrate: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub fps: Option<i64>,
    pub audio_sample_rate: Option<i64>,
    pub audio_channels: Option<i64>,
    pub content_length: Option<String>,
    pub init_range: Option<String>,
    pub index_range: Option<String>,
    pub url: String,
}

fn range_str(v: &serde_json::Value) -> Option<String> {
    let (s, e) = (v.get("start")?.as_str()?, v.get("end")?.as_str()?);
    Some(format!("{s}-{e}"))
}

/// InnerTube omits `hasAudio`/`hasVideo` on real responses (youtubei.js
/// computes them); derive delivery from mime + codecs when flags are absent.
fn delivery(mime: &str, codecs: &str, flag_audio: bool, flag_video: bool) -> Option<StreamKind> {
    let lower = codecs.to_lowercase();
    let audio_codec = ["mp4a", "opus", "vorbis", "ec-3", "ec3", "ac-3", "ac3", "dts"]
        .iter()
        .any(|c| lower.contains(c));
    let video_codec = ["avc", "vp9", "vp8", "av01", "hev1", "hvc1", "dvh", "dav"]
        .iter()
        .any(|c| lower.contains(c));
    let has_audio = flag_audio || mime.starts_with("audio/") || (mime.starts_with("video/") && audio_codec);
    let has_video = flag_video || mime.starts_with("video/") || video_codec;
    match (has_audio, has_video) {
        (true, true) => Some(StreamKind::Progressive),
        (true, false) => Some(StreamKind::Audio),
        (false, true) => Some(StreamKind::VideoOnly),
        _ => None,
    }
}
/// Classify one `streamingData` format entry. `None` = skip (text track or
/// unusable shape). Flags win when present; real responses omit them.
pub fn classify(format: &serde_json::Value, url: String) -> Option<ClassifiedStream> {
    let itag = format.get("itag")?.as_i64()?;
    let mime_full = format.get("mimeType")?.as_str().unwrap_or("");
    let (mime, codecs) = match mime_full.split_once(';') {
        Some((m, c)) => (m.trim().to_string(), c.trim().to_string()),
        None => (mime_full.to_string(), String::new()),
    };
    let flag_audio = format.get("hasAudio").and_then(|v| v.as_bool()).unwrap_or(false);
    let flag_video = format.get("hasVideo").and_then(|v| v.as_bool()).unwrap_or(false);
    let kind = delivery(&mime, &codecs, flag_audio, flag_video)?;
    // Guard the allowlist by delivery shape, not bare itag numbers: any
    // muxed mp4/webm, any audio-only, any video-only stream is usable.
    let usable = match kind {
        StreamKind::Progressive => mime == "video/mp4" || mime == "video/webm",
        StreamKind::Audio => mime.starts_with("audio/"),
        StreamKind::VideoOnly => mime.starts_with("video/"),
    };
    if !usable {
        return None;
    }
    Some(ClassifiedStream {
        itag,
        kind,
        mime,
        codecs,
        quality_label: format
            .get("qualityLabel")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        bitrate: format.get("bitrate").and_then(|v| v.as_i64()),
        width: format.get("width").and_then(|v| v.as_i64()),
        height: format.get("height").and_then(|v| v.as_i64()),
        fps: format.get("fps").and_then(|v| v.as_i64()),
        audio_sample_rate: format.get("audioSampleRate").and_then(|v| {
            v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_i64())
        }),
        audio_channels: format.get("audioChannels").and_then(|v| v.as_i64()),
        content_length: format
            .get("contentLength")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        init_range: format.get("initRange").and_then(range_str),
        index_range: format.get("indexRange").and_then(range_str),
        url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fmt(itag: i64, mime: &str, audio: bool, video: bool) -> serde_json::Value {
        serde_json::json!({
            "itag": itag, "mimeType": mime,
            "hasAudio": audio, "hasVideo": video,
            "qualityLabel": "360p", "width": 640, "height": 360,
        })
    }

    #[test]
    fn classifies_delivery_shapes() {
        let p = classify(&fmt(18, "video/mp4; codecs=\"avc1\"", true, true), "u".into()).unwrap();
        assert_eq!(p.kind, StreamKind::Progressive);
        assert_eq!(p.mime, "video/mp4");
        let a = classify(&fmt(140, "audio/mp4; codecs=\"mp4a\"", true, false), "u".into()).unwrap();
        assert_eq!(a.kind, StreamKind::Audio);
        let v = classify(&fmt(401, "video/mp4; codecs=\"vp9\"", false, true), "u".into()).unwrap();
        assert_eq!(v.kind, StreamKind::VideoOnly);
        assert!(v.init_range.is_none());
    }

    #[test]
    fn skips_text_and_unknown_shapes() {
        assert!(classify(&fmt(1, "text/vtt", false, false), "u".into()).is_none());
        assert!(classify(&fmt(2, "application/octet-stream", true, false), "u".into()).is_none());
    }

    #[test]
    fn derives_delivery_without_flags_like_live_responses() {
        // Real InnerTube entries carry no hasAudio/hasVideo keys.
        let muxed = serde_json::json!({
            "itag": 18, "mimeType": "video/mp4; codecs=\"avc1.42001E, mp4a.40.2\"",
        });
        assert_eq!(
            classify(&muxed, "u".into()).unwrap().kind,
            StreamKind::Progressive
        );
        let audio = serde_json::json!({
            "itag": 140, "mimeType": "audio/mp4; codecs=\"mp4a.40.2\"",
        });
        assert_eq!(classify(&audio, "u".into()).unwrap().kind, StreamKind::Audio);
        let vonly = serde_json::json!({
            "itag": 401, "mimeType": "video/mp4; codecs=\"av01.0.12M.08\"",
        });
        assert_eq!(
            classify(&vonly, "u".into()).unwrap().kind,
            StreamKind::VideoOnly
        );
    }
}
