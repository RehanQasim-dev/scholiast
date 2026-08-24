//! Innertube caption-track client — port of the desktop extension's
//! `tracksFromInnertube` + `loadTranscript` network paths
//! (`src/utils/video/video-transcript.ts`), minus the DOM/inline-script/Defuddle
//! paths, which do not exist outside a browser page.
//!
//! Flow (plan §6.6): `POST youtubei/v1/player` with the IOS client context →
//! WEB fallback → `captionTracks` extraction → `pick_track` (session pref →
//! English non-ASR → first) → fetch the chosen track's `baseUrl` with
//! `&fmt=json3` → parse cues (`scholiast_core::cue`) → chunk into paragraphs.
//! Results are cached in memory (small LRU) and optionally on disk under
//! `<cache_dir>/transcripts/<videoId>_<lang>.json`, so a transcript survives
//! offline restarts.
//!
//! **Fallback trigger** (exact TS semantics, video-transcript.ts:158–165): the
//! client flips from IOS to WEB whenever the IOS attempt yields *zero usable
//! caption tracks* — a transport error, a non-success HTTP status, an
//! unparseable body, a missing `captions.playerCaptionsTracklistRenderer`
//! object, or an empty list after dropping baseUrl-less entries. There is no
//! distinction between "hard failure" and "no captions" at this layer; only
//! after both contexts fail does the fetch report `TranscriptError::NoCaptions`.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use scholiast_core::cue::{self, Cue, Paragraph};
use scholiast_core::error::ScholiastError;
use serde::{Deserialize, Serialize};

/// Same endpoint as the desktop (video-transcript.ts:144).
pub const INNERTUBE_PLAYER_URL: &str =
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

const MEM_CACHE_CAP: usize = 32;

// Client contexts — same values as the desktop (video-transcript.ts:145–146).
fn ios_context() -> serde_json::Value {
    serde_json::json!({ "client": { "clientName": "IOS", "clientVersion": "20.10.3" } })
}

fn web_context() -> serde_json::Value {
    serde_json::json!({ "client": { "clientName": "WEB", "clientVersion": "2.20240101.00.00" } })
}

/// One entry of `captions.playerCaptionsTracklistRenderer.captionTracks`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptionTrack {
    pub language_code: String,
    pub name: String,
    pub base_url: String,
    pub is_asr: bool,
}

/// IPC payload for `fetch_transcript`.
#[derive(Debug, Clone, Serialize)]
pub struct TranscriptResult {
    pub lang: String,
    pub paragraphs: Vec<Paragraph>,
    pub cues: Vec<Cue>,
}

/// Graceful failure variants for the transcript pipeline.
#[derive(Debug)]
pub enum TranscriptError {
    /// Neither client context surfaced any usable caption track.
    NoCaptions,
    Network(String),
    Http(u16),
    Parse(String),
}

impl std::fmt::Display for TranscriptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TranscriptError::NoCaptions => write!(f, "no captions"),
            TranscriptError::Network(m) => write!(f, "transcript network error: {m}"),
            TranscriptError::Http(s) => write!(f, "youtube HTTP {s}"),
            TranscriptError::Parse(m) => write!(f, "transcript parse error: {m}"),
        }
    }
}

impl std::error::Error for TranscriptError {}

impl From<TranscriptError> for ScholiastError {
    fn from(err: TranscriptError) -> Self {
        match err {
            TranscriptError::NoCaptions => ScholiastError::NotFound("no captions".into()),
            TranscriptError::Network(m) => ScholiastError::Io(m),
            TranscriptError::Http(s) => ScholiastError::Internal(format!("youtube HTTP {s}")),
            TranscriptError::Parse(m) => ScholiastError::InvalidInput(m),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CachedTranscript {
    cues: Vec<Cue>,
    paragraphs: Vec<Paragraph>,
}

/// Tiny hand-rolled LRU (capacity [`MEM_CACHE_CAP`]); the cache is small enough
/// that linear-order maintenance beats pulling in a dependency.
struct Lru {
    map: HashMap<(String, String), CachedTranscript>,
    order: VecDeque<(String, String)>,
}

impl Lru {
    fn new() -> Self {
        Lru {
            map: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    fn get(&mut self, key: &(String, String)) -> Option<&CachedTranscript> {
        if self.map.contains_key(key) {
            if let Some(pos) = self.order.iter().position(|k| k == key) {
                if let Some(k) = self.order.remove(pos) {
                    self.order.push_back(k);
                }
            }
        }
        self.map.get(key)
    }

    fn put(&mut self, key: (String, String), value: CachedTranscript) {
        if let Some(pos) = self.order.iter().position(|k| k == &key) {
            if let Some(k) = self.order.remove(pos) {
                self.order.push_back(k);
            }
        } else {
            self.order.push_back(key.clone());
        }
        self.map.insert(key, value);
        while self.order.len() > MEM_CACHE_CAP {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
    }
}

pub struct TranscriptClient {
    http: reqwest::Client,
    player_endpoint: String,
    mem: Mutex<Lru>,
    cache_dir: Option<PathBuf>,
}

impl TranscriptClient {
    pub fn new(cache_dir: Option<PathBuf>) -> Self {
        TranscriptClient {
            http: reqwest::Client::new(),
            player_endpoint: INNERTUBE_PLAYER_URL.to_string(),
            mem: Mutex::new(Lru::new()),
            cache_dir,
        }
    }

    /// Override the innertube endpoint (tests point this at a wiremock server).
    /// Test seam: point the client at a mock player endpoint.
    #[cfg(test)]
    pub fn with_player_endpoint(mut self, endpoint: String) -> Self {
        self.player_endpoint = endpoint;
        self
    }

    pub async fn fetch_transcript(
        &self,
        video_id: &str,
        lang_pref: Option<&str>,
    ) -> Result<TranscriptResult, TranscriptError> {
        let tracks = self.discover_tracks(video_id).await;
        let track = pick_track(lang_pref, &tracks).ok_or(TranscriptError::NoCaptions)?;
        let lang = track.language_code.clone();
        let key = (video_id.to_string(), lang.clone());

        if let Some(hit) = self.mem.lock().expect("lru").get(&key) {
            return Ok(self.build_result(&lang, hit));
        }
        if let Some(dir) = &self.cache_dir {
            if let Some(hit) = read_disk_cache(dir, video_id, &lang) {
                self.mem.lock().expect("lru").put(key.clone(), hit.clone());
                return Ok(self.build_result(&lang, &hit));
            }
        }

        let url = append_fmt_json3(&track.base_url);
        let mut request = self.http.get(&url);
        if !lang.is_empty() {
            request = request.header("Accept-Language", &lang);
        }
        let response = request.send().await.map_err(|e| TranscriptError::Network(e.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(TranscriptError::Http(status.as_u16()));
        }
        let body = response
            .text()
            .await
            .map_err(|e| TranscriptError::Parse(e.to_string()))?;
        let parsed = cue::parse(&body);
        if parsed.is_empty() {
            return Err(TranscriptError::NoCaptions);
        }
        let paragraphs = cue::chunk(&parsed);

        let cached = CachedTranscript {
            cues: parsed.clone(),
            paragraphs,
        };
        self.mem.lock().expect("lru").put(key.clone(), cached.clone());
        if let Some(dir) = &self.cache_dir {
            write_disk_cache(dir, video_id, &lang, &cached);
        }

        Ok(self.build_result(&lang, &cached))
    }

    fn build_result(&self, lang: &str, cached: &CachedTranscript) -> TranscriptResult {
        TranscriptResult {
            lang: lang.to_string(),
            paragraphs: cached.paragraphs.clone(),
            cues: cached.cues.clone(),
        }
    }

    async fn discover_tracks(&self, video_id: &str) -> Vec<CaptionTrack> {
        for context in [ios_context(), web_context()] {
            if let Some(tracks) = self.player_tracks(video_id, context).await {
                if !tracks.is_empty() {
                    return tracks;
                }
            }
        }
        Vec::new()
    }

    /// One innertube attempt; `None` on any failure shape (TS parity).
    async fn player_tracks(&self, video_id: &str, context: serde_json::Value) -> Option<Vec<CaptionTrack>> {
        let response = self
            .http
            .post(&self.player_endpoint)
            .header("Content-Type", "application/json")
            .body(serde_json::json!({ "context": context, "videoId": video_id }).to_string())
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let text = response.text().await.ok()?;
        let value: serde_json::Value = serde_json::from_str(&text).ok()?;
        Some(extract_caption_tracks(&value))
    }
}

/// Walk `captions.playerCaptionsTracklistRenderer.captionTracks[]`; drop
/// entries without a `baseUrl` string (desktop behavior,
/// video-transcript.ts:87–98).
pub fn extract_caption_tracks(player_response: &serde_json::Value) -> Vec<CaptionTrack> {
    player_response
        .pointer("/captions/playerCaptionsTracklistRenderer/captionTracks")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|t| {
                    let base_url = t.get("baseUrl")?.as_str()?.to_string();
                    Some(CaptionTrack {
                        language_code: t
                            .get("languageCode")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        name: track_name(t),
                        base_url,
                        is_asr: t.get("kind").and_then(|v| v.as_str()) == Some("asr"),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// `name.simpleText || name.runs[].text.join('') || languageCode || ''`.
fn track_name(track: &serde_json::Value) -> String {
    let name = match track.get("name") {
        Some(n) => n,
        None => {
            return track
                .get("languageCode")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        }
    };
    if let Some(simple) = name.get("simpleText").and_then(|v| v.as_str()) {
        if !simple.is_empty() {
            return simple.to_string();
        }
    }
    if let Some(runs) = name.get("runs").and_then(|v| v.as_array()) {
        let joined: String = runs
            .iter()
            .filter_map(|r| r.get("text").and_then(|v| v.as_str()))
            .collect();
        if !joined.is_empty() {
            return joined;
        }
    }
    track
        .get("languageCode")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Track picking — exact port of the desktop `pickTrack`
/// (video-transcript.ts:179–189): session preference (exact `languageCode`
/// match, ASR not deprioritized) → English-prefix non-ASR → first English
/// (ASR acceptable) → any-language non-ASR → first track.
pub fn pick_track(session_pref: Option<&str>, tracks: &[CaptionTrack]) -> Option<CaptionTrack> {
    if tracks.is_empty() {
        return None;
    }
    if let Some(pref) = session_pref.filter(|p| !p.is_empty()) {
        if let Some(matched) = tracks.iter().find(|t| t.language_code == pref) {
            return Some(matched.clone());
        }
    }
    let en: Vec<&CaptionTrack> = tracks
        .iter()
        .filter(|t| t.language_code.to_lowercase().starts_with("en"))
        .collect();
    if !en.is_empty() {
        return Some(
            en.iter()
                .find(|t| !t.is_asr)
                .map(|t| (*t).clone())
                .unwrap_or_else(|| en[0].clone()),
        );
    }
    tracks
        .iter()
        .find(|t| !t.is_asr)
        .or_else(|| tracks.first())
        .cloned()
}

fn append_fmt_json3(base_url: &str) -> String {
    if base_url.contains('?') {
        format!("{base_url}&fmt=json3")
    } else {
        format!("{base_url}?fmt=json3")
    }
}

// --- Disk cache ----------------------------------------------------------------

fn sanitize_component(component: &str) -> String {
    let cleaned: String = component
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                c
            } else {
                '_'
            }
        })
        .collect();
    if cleaned.is_empty() {
        "_".to_string()
    } else {
        cleaned
    }
}

fn disk_cache_path(cache_dir: &Path, video_id: &str, lang: &str) -> PathBuf {
    cache_dir
        .join("transcripts")
        .join(format!("{}_{}.json", sanitize_component(video_id), sanitize_component(lang)))
}

fn read_disk_cache(cache_dir: &Path, video_id: &str, lang: &str) -> Option<CachedTranscript> {
    let raw = std::fs::read_to_string(disk_cache_path(cache_dir, video_id, lang)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_disk_cache(cache_dir: &Path, video_id: &str, lang: &str, cached: &CachedTranscript) {
    let path = disk_cache_path(cache_dir, video_id, lang);
    let Some(parent) = path.parent() else { return };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    if let Ok(body) = serde_json::to_string(cached) {
        let _ = std::fs::write(path, body);
    }
}

/// Tauri command: fetch (or load from cache) the transcript for a video.
/// The disk cache lives under `app_data/transcripts/`.
#[tauri::command]
pub async fn fetch_transcript(
    app: tauri::AppHandle,
    video_id: String,
    lang_pref: Option<String>,
) -> Result<TranscriptResult, ScholiastError> {
    use tauri::Manager;
    let cache_dir = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("transcripts"))
        .map_err(|err| ScholiastError::Internal(err.to_string()))?;
    let client = TranscriptClient::new(Some(cache_dir));
    client
        .fetch_transcript(&video_id, lang_pref.as_deref())
        .await
        .map_err(Into::into)
}

#[cfg(test)]
mod transcript_client_tests {
    use super::*;
    use wiremock::matchers::{body_string_contains, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const JSON3_SAMPLE: &str =
        include_str!("../../../crates/core/tests/fixtures/captions/sample.json3");

    fn track(code: &str, base: &str, asr: bool) -> CaptionTrack {
        CaptionTrack {
            language_code: code.to_string(),
            name: code.to_string(),
            base_url: base.to_string(),
            is_asr: asr,
        }
    }

    fn player_response(base: &str) -> serde_json::Value {
        serde_json::json!({
            "captions": {
                "playerCaptionsTracklistRenderer": {
                    "captionTracks": [
                        {
                            "languageCode": "fr",
                            "name": { "simpleText": "French" },
                            "baseUrl": format!("{base}/captions?v=2"),
                        },
                        {
                            "languageCode": "en",
                            "name": { "simpleText": "English (auto-generated)" },
                            "baseUrl": format!("{base}/captions?v=1"),
                            "kind": "asr",
                        }
                    ]
                }
            }
        })
    }

    #[tokio::test]
    async fn ios_failure_falls_back_to_web_then_fetches_json3() {
        let server = MockServer::start().await;

        // IOS attempt answers 200 but carries no captions at all.
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .and(body_string_contains(r#""clientName":"IOS""#))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                serde_json::json!({ "playabilityStatus": { "status": "OK" } }),
            ))
            .expect(1)
            .mount(&server)
            .await;
        // WEB attempt surfaces the captionTracks.
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .and(body_string_contains(r#""clientName":"WEB""#))
            .respond_with(ResponseTemplate::new(200).set_body_json(player_response(&server.uri())))
            .expect(1)
            .mount(&server)
            .await;
        // The chosen track is fetched with fmt=json3 appended.
        Mock::given(method("GET"))
            .and(path("/captions"))
            .and(query_param("v", "1"))
            .and(query_param("fmt", "json3"))
            .respond_with(ResponseTemplate::new(200).set_body_string(JSON3_SAMPLE))
            .expect(1)
            .mount(&server)
            .await;

        let client = TranscriptClient::new(None)
            .with_player_endpoint(format!("{}/youtubei/v1/player", server.uri()));
        let result = client
            .fetch_transcript("abc123XYZ_-", None)
            .await
            .expect("transcript");

        assert_eq!(result.lang, "en");
        assert_eq!(result.cues.len(), 3);
        assert_eq!(result.cues[0].text, "Welcome to the course, everyone.");
        assert_eq!(result.paragraphs.len(), 2);
        assert_eq!(result.paragraphs[0].text, "Welcome to the course, everyone.");
        assert_eq!(
            result.paragraphs[1].text,
            "Today we cover parsing & lexing Third line continued."
        );

        let requests = server.received_requests().await.expect("requests");
        let body = |i: usize| String::from_utf8(requests[i].body.clone()).unwrap();
        assert!(body(0).contains(r#""clientName":"IOS""#));
        assert!(body(1).contains(r#""clientName":"WEB""#));
        assert!(requests[2].url.as_str().contains("/captions?v=1&fmt=json3"));
    }

    #[tokio::test]
    async fn both_contexts_without_captions_is_a_nocaptions_error() {
        let server = MockServer::start().await;
        let empty = ResponseTemplate::new(200)
            .set_body_json(serde_json::json!({ "playabilityStatus": { "status": "OK" } }));
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .and(body_string_contains(r#""clientName":"IOS""#))
            .respond_with(empty.clone())
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .and(body_string_contains(r#""clientName":"WEB""#))
            .respond_with(empty)
            .mount(&server)
            .await;

        let client = TranscriptClient::new(None)
            .with_player_endpoint(format!("{}/youtubei/v1/player", server.uri()));
        match client.fetch_transcript("vid", None).await {
            Err(TranscriptError::NoCaptions) => {}
            other => panic!("expected NoCaptions, got {other:?}"),
        }
    }

    #[test]
    fn pick_track_precedence_matrix() {
        // Empty list → none.
        assert!(pick_track(None, &[]).is_none());

        let tracks = vec![
            track("es", "u1", true),
            track("en", "u2", true),
            track("es", "u3", false),
            track("en", "u4", false),
        ];

        // Session preference wins with an exact match, ASR not deprioritized.
        assert_eq!(pick_track(Some("es"), &tracks).unwrap().base_url, "u1");
        // English non-ASR beats English ASR and every non-English track.
        assert_eq!(pick_track(None, &tracks).unwrap().base_url, "u4");
        // Only an English ASR track → it is used.
        let en_asr_only = vec![track("fr", "f1", false), track("en", "e1", true)];
        assert_eq!(pick_track(None, &en_asr_only).unwrap().base_url, "e1");
        // No English → first non-ASR anywhere.
        let no_en = vec![track("de", "d1", true), track("fr", "f1", false)];
        assert_eq!(pick_track(None, &no_en).unwrap().base_url, "f1");
        // Everything ASR → first track.
        let all_asr = vec![track("de", "d1", true), track("fr", "f2", true)];
        assert_eq!(pick_track(None, &all_asr).unwrap().base_url, "d1");
        // Unknown session preference falls through to the default ladder.
        assert_eq!(pick_track(Some("zz"), &no_en).unwrap().base_url, "f1");
    }

    #[tokio::test]
    async fn disk_cache_serves_a_new_client_without_the_network() {
        let server = MockServer::start().await;
        // Track discovery happens on every fetch (TS parity), but the caption
        // payload itself may only be downloaded once across both clients.
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .and(body_string_contains(r#""clientName":"WEB""#))
            .respond_with(ResponseTemplate::new(200).set_body_json(player_response(&server.uri())))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/youtubei/v1/player"))
            .and(body_string_contains(r#""clientName":"IOS""#))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                serde_json::json!({ "playabilityStatus": { "status": "OK" } }),
            ))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/captions"))
            .and(query_param("v", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_string(JSON3_SAMPLE))
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().expect("tempdir");
        let endpoint = format!("{}/youtubei/v1/player", server.uri());
        let first = TranscriptClient::new(Some(dir.path().to_path_buf()))
            .with_player_endpoint(endpoint.clone());
        let initial = first.fetch_transcript("vid01", None).await.expect("first fetch");
        drop(first);

        let cached_file = dir.path().join("transcripts").join("vid01_en.json");
        assert!(cached_file.exists());

        let second = TranscriptClient::new(Some(dir.path().to_path_buf()))
            .with_player_endpoint(endpoint);
        let again = second.fetch_transcript("vid01", None).await.expect("cached fetch");
        assert_eq!(initial.lang, again.lang);
        assert_eq!(initial.cues, again.cues);
        assert_eq!(initial.paragraphs, again.paragraphs);

        let requests = server.received_requests().await.expect("requests");
        let caption_downloads = requests.iter().filter(|r| r.url.as_str().contains("/captions")).count();
        assert_eq!(caption_downloads, 1);
    }
}
