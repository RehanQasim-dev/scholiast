//! Cloud speech providers: Groq transcription + Gemini prompt-driven voice edit.
//!
//! Flows (plan §6.5.2/§6.5.3):
//! - **Add-comment, verbatim branch** — the WAV is posted to Groq's OpenAI-compatible
//!   `audio/transcriptions` endpoint and the response text is inserted verbatim.
//! - **Edit-existing-comment** — the WAV plus the original note go to Gemini
//!   `generateContent` with an edit-prompt system instruction; the reply is the revised note.
//!
//! Capability split (plan §6.5.5): Groq is `VERBATIM`, Gemini is `PROMPTED`. The
//! [`Transcriber`] trait mirrors the plan's shape; native async-fn-in-trait keeps it
//! dependency-free (no dyn dispatch is needed — commands construct clients directly).
//!
//! Keys come from the OS keyring (service `scholiast`, entries `groq.api_key` /
//! `gemini.api_key`) through the [`KeyProvider`] seam so tests inject static maps and never
//! touch the real keychain. Keys are never logged; HTTP failures surface provider-agnostically.
//!
//! Prompt/model prefs (`prompt.edit_comment`, `stt.groq_model`, `stt.gemini_model`) are read
//! read-only from the settings store in command context with defaults from the consts below;
//! seeding defaults into the store belongs to the Settings task.

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use scholiast_core::error::Reply;
use std::path::Path;
use std::sync::Arc;

const GROQ_TRANSCRIPTIONS_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const GEMINI_GENERATE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";

/// Keyring entry holding the Groq API key.
pub const KEY_GROQ: &str = "groq.api_key";
/// Keyring entry holding the Gemini API key.
pub const KEY_GEMINI: &str = "gemini.api_key";
/// Store pref overriding the Groq whisper model id.
pub const PREF_GROQ_MODEL: &str = "stt.groq_model";
/// Store pref overriding the Gemini model id.
pub const PREF_GEMINI_MODEL: &str = "stt.gemini_model";
/// Store pref holding the user-editable edit-comment prompt.
pub const PREF_EDIT_PROMPT: &str = "prompt.edit_comment";

/// Store pref overriding the active STT model (local, groq, or gemini).
pub const PREF_ACTIVE_MODEL: &str = "stt.active_model";
/// Store pref holding the personal dictionary (one word per line), shared with
/// local STT's `initial_prompt` bias.
pub const PREF_GLOSSARY: &str = "stt.glossary";
/// Groq `prompt` field limit is 224 tokens; cap well under it at a word boundary.
const GROQ_PROMPT_MAX_CHARS: usize = 900;
/// Store pref overriding the add-comment prompt.
pub const PREF_ADD_PROMPT: &str = "prompt.add_comment";
/// Default Groq model (plan §6.5.6).
pub const DEFAULT_GROQ_MODEL: &str = "whisper-large-v3-turbo";
/// Default Gemini model (plan §6.5.6).
pub const DEFAULT_GEMINI_MODEL: &str = "gemini-flash-latest";
/// Default add-comment prompt (plan §6.5.6) — exported for the Settings task to seed.
pub const ADD_PROMPT_DEFAULT: &str = "You are helping write study notes. Turn the user's speech into a clear, concise note, keeping technical terms and key facts. Output only the note text.";
/// Default edit-comment prompt (plan §6.5.6) — used when no override is supplied.
pub const EDIT_PROMPT_DEFAULT: &str = "The user wants to modify their note below. Follow their spoken instructions, keep it concise, output only the revised note.";

// ---------------------------------------------------------------------------
// Errors — same `{ok:false, error:{kind,message}}` wire shape as ScholiastError,
// with speech-specific kinds the frontend can act on.
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum SttError {
    /// No provider configured for the requested flow.
    NoProvider,
    /// Edit-by-voice requires a Gemini key which is not configured.
    GeminiRequired,
    Network(String),
    Http(u16),
    Io(String),
    Parse(String),
    InvalidInput(String),
}

impl SttError {
    fn kind(&self) -> &'static str {
        match self {
            SttError::NoProvider => "no_provider",
            SttError::GeminiRequired => "gemini_required",
            SttError::Network(_) => "network",
            SttError::Http(_) => "http",
            SttError::Io(_) => "io",
            SttError::Parse(_) => "parse",
            SttError::InvalidInput(_) => "invalidInput",
        }
    }

    fn message(&self) -> String {
        match self {
            SttError::NoProvider => "Set up speech in Settings".into(),
            SttError::GeminiRequired => "Edit by voice needs a Gemini key".into(),
            SttError::Network(m) => format!("Speech failed: {m}"),
            // Provider-agnostic on purpose (task.md notes): never name the vendor.
            SttError::Http(status) => format!("Speech failed: HTTP {status}"),
            SttError::Io(m) => format!("Speech failed: {m}"),
            SttError::Parse(m) => format!("Speech failed: {m}"),
            SttError::InvalidInput(m) => format!("Speech failed: {m}"),
        }
    }
}

impl std::fmt::Display for SttError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind(), self.message())
    }
}

impl std::error::Error for SttError {}

impl serde::Serialize for SttError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut outer = serializer.serialize_struct("SttError", 2)?;
        outer.serialize_field("ok", &false)?;
        outer.serialize_field(
            "error",
            &serde_json::json!({ "kind": self.kind(), "message": self.message() }),
        )?;
        outer.end()
    }
}

// ---------------------------------------------------------------------------
// Key access seam
// ---------------------------------------------------------------------------

/// Source of provider keys. The production impl reads the OS keyring; tests swap in
/// a static map so no secret-service/session daemon is required.
pub trait KeyProvider: Send + Sync {
    fn key(&self, entry: &str) -> Option<String>;
}

/// Reads secrets from the platform store under service `scholiast` (OS keyring
/// on desktop, app-private file store on Android — see `crate::secrets`).
pub struct KeyringProvider;

impl KeyProvider for KeyringProvider {
    fn key(&self, entry: &str) -> Option<String> {
        let name = crate::secrets::SecretName::parse(entry)?;
        crate::secrets::get_secret(name)
            .ok()
            .flatten()
            .filter(|k| !k.is_empty())
    }
}

#[cfg(test)]
struct StaticKeys(std::collections::HashMap<&'static str, String>);

#[cfg(test)]
impl KeyProvider for StaticKeys {
    fn key(&self, entry: &str) -> Option<String> {
        self.0.get(entry).cloned()
    }
}

fn wav_bytes(path: &Path) -> Result<Vec<u8>, SttError> {
    let bytes = std::fs::read(path).map_err(|err| match err.kind() {
        std::io::ErrorKind::NotFound => {
            SttError::InvalidInput(format!("recording not found: {}", path.display()))
        }
        _ => SttError::Io(err.to_string()),
    })?;
    if bytes.is_empty() {
        return Err(SttError::InvalidInput("recording is empty".into()));
    }
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Transcriber trait (plan §6.5.5)
// ---------------------------------------------------------------------------

/// Bit set of what a provider can do: verbatim dictation, prompt-shaped output, or both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Caps(pub u8);

impl Caps {
    pub const VERBATIM: Caps = Caps(1);
    pub const PROMPTED: Caps = Caps(2);

    #[allow(dead_code)]
    pub fn contains(self, other: Caps) -> bool {
        self.0 & other.0 == other.0
    }
}

/// Plan §6.5.5's provider registry seam; commands construct clients directly for now,
/// but task-11 (local whisper) and the Settings "Test connection" pings hang off this.
#[allow(dead_code)]
pub trait Transcriber {
    /// Transcribe `wav`; when `prompt` is given the provider shapes the output with it.
    async fn transcribe(
        &self,
        wav: &Path,
        language: Option<&str>,
        prompt: Option<&str>,
    ) -> Result<String, SttError>;

    fn capabilities(&self) -> Caps;
}

// ---------------------------------------------------------------------------
// Groq (OpenAI-compatible audio API) — VERBATIM
// ---------------------------------------------------------------------------

pub struct GroqTranscriber {
    http: reqwest::Client,
    endpoint: String,
    model: String,
    keys: Arc<dyn KeyProvider>,
}

impl GroqTranscriber {
    pub fn new(keys: Arc<dyn KeyProvider>, model: String) -> Self {
        GroqTranscriber {
            http: reqwest::Client::new(),
            endpoint: GROQ_TRANSCRIPTIONS_URL.to_string(),
            model,
            keys,
        }
    }

    #[cfg(test)]
    fn with_endpoint(mut self, endpoint: String) -> Self {
        self.endpoint = endpoint;
        self
    }
}

impl Transcriber for GroqTranscriber {
    fn capabilities(&self) -> Caps {
        Caps::VERBATIM
    }

    async fn transcribe(
        &self,
        wav: &Path,
        language: Option<&str>,
        prompt: Option<&str>,
    ) -> Result<String, SttError> {
        let key = self.keys.key(KEY_GROQ).ok_or(SttError::NoProvider)?;
        let audio = wav_bytes(wav)?;

        let mut form = reqwest::multipart::Form::new()
            .text("model", self.model.clone())
            .part(
                "file",
                reqwest::multipart::Part::bytes(audio)
                    .file_name("audio.wav")
                    .mime_str("audio/wav")
                    .map_err(|err| SttError::Network(err.to_string()))?,
            );
        if let Some(lang) = language.filter(|l| !l.trim().is_empty()) {
            form = form.text("language", lang.trim().to_string());
        }
        if let Some(hint) = prompt.filter(|p| !p.trim().is_empty()) {
            form = form.text("prompt", hint.trim().to_string());
        }

        let response = self
            .http
            .post(&self.endpoint)
            .bearer_auth(key)
            .multipart(form)
            .send()
            .await
            .map_err(|err| SttError::Network(err.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(SttError::Http(status.as_u16()));
        }
        let body: serde_json::Value = serde_json::from_str(
            &response
                .text()
                .await
                .map_err(|err| SttError::Parse(err.to_string()))?,
        )
        .map_err(|err| SttError::Parse(err.to_string()))?;
        body.get("text")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| SttError::Parse("transcription response missing text".into()))
    }
}

// ---------------------------------------------------------------------------
// Gemini (generateContent, inline audio) — PROMPTED
// ---------------------------------------------------------------------------

pub struct GeminiTranscriber {
    http: reqwest::Client,
    endpoint_base: String,
    model: String,
    keys: Arc<dyn KeyProvider>,
}

impl GeminiTranscriber {
    pub fn new(keys: Arc<dyn KeyProvider>, model: String) -> Self {
        GeminiTranscriber {
            http: reqwest::Client::new(),
            endpoint_base: GEMINI_GENERATE_URL.to_string(),
            model,
            keys,
        }
    }

    #[cfg(test)]
    fn with_endpoint_base(mut self, endpoint_base: String) -> Self {
        self.endpoint_base = endpoint_base;
        self
    }

    /// One `generateContent` round trip: inline WAV + system-instruction shaping,
    /// optionally followed by a text part (`note`) in the same user turn.
    async fn generate(
        &self,
        wav: &Path,
        instruction: &str,
        note: Option<&str>,
    ) -> Result<String, SttError> {
        let key = self.keys.key(KEY_GEMINI).ok_or(SttError::GeminiRequired)?;
        let audio = wav_bytes(wav)?;

        let mut parts = serde_json::json!([
            { "inline_data": { "mime_type": "audio/wav", "data": BASE64_STANDARD.encode(audio) } }
        ]);
        if let Some(text) = note {
            parts.as_array_mut().expect("array literal").push(serde_json::json!({ "text": text }));
        }

        let url = format!("{}/{}:generateContent", self.endpoint_base, self.model);
        let body = serde_json::json!({
            "system_instruction": { "parts": [{ "text": instruction }] },
            "contents": [{ "parts": parts }]
        });

        let response = self
            .http
            .post(&url)
            .header("x-goog-api-key", key)
            .header("Content-Type", "application/json")
            .body(serde_json::to_string(&body).map_err(|err| SttError::Parse(err.to_string()))?)
            .send()
            .await
            .map_err(|err| SttError::Network(err.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(SttError::Http(status.as_u16()));
        }
        let payload: serde_json::Value = serde_json::from_str(
            &response
                .text()
                .await
                .map_err(|err| SttError::Parse(err.to_string()))?,
        )
        .map_err(|err| SttError::Parse(err.to_string()))?;
        extract_candidate_text(&payload)
            .ok_or_else(|| SttError::Parse("gemini response missing candidate text".into()))
    }

    /// Voice-edit one note: audio + the current text, shaped by the edit prompt.
    pub async fn edit_text(
        &self,
        wav: &Path,
        original: &str,
        prompt_override: Option<&str>,
    ) -> Result<String, SttError> {
        if original.trim().is_empty() {
            return Err(SttError::InvalidInput("original note is empty".into()));
        }
        let prompt = prompt_override
            .filter(|p| !p.trim().is_empty())
            .unwrap_or(EDIT_PROMPT_DEFAULT);
        self.generate(wav, prompt, Some(original)).await
    }
}

impl Transcriber for GeminiTranscriber {
    fn capabilities(&self) -> Caps {
        Caps::PROMPTED
    }

    /// Prompted draft (plan §6.5.2, Gemini branch): WAV + Add-comment prompt.
    async fn transcribe(
        &self,
        wav: &Path,
        _language: Option<&str>,
        prompt: Option<&str>,
    ) -> Result<String, SttError> {
        let prompt = prompt
            .filter(|p| !p.trim().is_empty())
            .unwrap_or(ADD_PROMPT_DEFAULT);
        self.generate(wav, prompt, None).await
    }
}

/// Join the text parts of `candidates[0].content.parts[]`.
fn extract_candidate_text(payload: &serde_json::Value) -> Option<String> {
    let parts = payload
        .pointer("/candidates/0/content/parts")?
        .as_array()?;
    let joined: String = parts
        .iter()
        .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
        .collect::<Vec<_>>()
        .join("");
    (!joined.is_empty()).then_some(joined)
}

// ---------------------------------------------------------------------------
// Prefs (read-only) + commands
// ---------------------------------------------------------------------------

/// Read a string pref from the settings store, falling back silently to the default.
/// Rust never *writes* prefs here (seeding is the Settings task's job).
fn pref(app: &tauri::AppHandle, key: &str) -> Option<String> {
    use tauri_plugin_store::StoreExt;
    let store = app.store("settings.json").ok()?;
    match store.get(key)? {
        serde_json::Value::String(s) if !s.is_empty() => Some(s),
        _ => None,
    }
}

/// FUTO glossary prompt from the `stt.glossary` pref (one word per line):
/// `"(Glossary: a, b)"`, capped for Groq's 224-token `prompt` limit. None when
/// the dictionary is empty. Same words local STT feeds `initial_prompt`.
fn glossary_prompt(app: &tauri::AppHandle) -> Option<String> {
    let words: Vec<String> = pref(app, PREF_GLOSSARY)?
        .lines()
        .map(|line| line.trim().replace('\0', ""))
        .filter(|line| !line.is_empty())
        .collect();
    if words.is_empty() {
        return None;
    }
    let mut prompt = format!("(Glossary: {})", words.join(", "));
    if prompt.len() > GROQ_PROMPT_MAX_CHARS {
        let mut end = GROQ_PROMPT_MAX_CHARS;
        while !prompt.is_char_boundary(end) {
            end -= 1;
        }
        prompt.truncate(end);
    }
    Some(prompt)
}

/// Tauri command: transcribe a finished WAV verbatim or prompted via Groq or Gemini.
/// Routing per plan §6.5.2 — honors `stt.active_model`, falling back to whichever key is configured.
#[tauri::command]
pub async fn stt_transcribe(
    app_handle: tauri::AppHandle,
    wav_path: String,
    language: Option<String>,
) -> Result<Reply<String>, SttError> {
    let active_model = pref(&app_handle, PREF_ACTIVE_MODEL);
    let keys = Arc::new(KeyringProvider);

    let use_gemini = if let Some(ref am) = active_model {
        if am.starts_with("gemini:") {
            true
        } else if am.starts_with("groq:") {
            false
        } else {
            keys.key(KEY_GROQ).is_none() && keys.key(KEY_GEMINI).is_some()
        }
    } else {
        keys.key(KEY_GROQ).is_none() && keys.key(KEY_GEMINI).is_some()
    };

    if use_gemini {
        let model = active_model
            .as_deref()
            .and_then(|m| m.strip_prefix("gemini:"))
            .map(str::to_string)
            .or_else(|| pref(&app_handle, PREF_GEMINI_MODEL))
            .unwrap_or_else(|| DEFAULT_GEMINI_MODEL.into());
        let gemini = GeminiTranscriber::new(keys, model);
        let prompt = pref(&app_handle, PREF_ADD_PROMPT);
        let text = gemini
            .transcribe(Path::new(&wav_path), language.as_deref(), prompt.as_deref())
            .await?;
        Ok(Reply::new(text))
    } else {
        let model = active_model
            .as_deref()
            .and_then(|m| m.strip_prefix("groq:"))
            .map(str::to_string)
            .or_else(|| pref(&app_handle, PREF_GROQ_MODEL))
            .unwrap_or_else(|| DEFAULT_GROQ_MODEL.into());
        let groq = GroqTranscriber::new(keys, model);
        let glossary = glossary_prompt(&app_handle);
        let text = groq
            .transcribe(
                Path::new(&wav_path),
                language.as_deref(),
                glossary.as_deref(),
            )
            .await?;
        Ok(Reply::new(text))
    }
}

/// Tauri command: revise `original` by voice via Gemini (plan §6.5.3).
/// Gemini-only by design — without its key this is `gemini_required`. The instruction is
/// the caller's `prompt_override` if given, else the `prompt.edit_comment` pref, else
/// the plan default.
#[tauri::command]
pub async fn stt_edit_text(
    app_handle: tauri::AppHandle,
    wav_path: String,
    original: String,
    prompt_override: Option<String>,
) -> Result<Reply<String>, SttError> {
    let model =
        pref(&app_handle, PREF_GEMINI_MODEL).unwrap_or_else(|| DEFAULT_GEMINI_MODEL.into());
    let prompt = prompt_override
        .filter(|p| !p.trim().is_empty())
        .or_else(|| pref(&app_handle, PREF_EDIT_PROMPT));
    let gemini = GeminiTranscriber::new(Arc::new(KeyringProvider), model);
    let text = gemini
        .edit_text(Path::new(&wav_path), &original, prompt.as_deref())
        .await?;
    Ok(Reply::new(text))
}

// ---------------------------------------------------------------------------
// Tests — wiremock against injected endpoints + static key seam (no OS keyring)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn keys(pairs: &[(&'static str, &str)]) -> Arc<dyn KeyProvider> {
        let mut map = std::collections::HashMap::new();
        for (entry, key) in pairs {
            map.insert(*entry, (*key).to_string());
        }
        Arc::new(StaticKeys(map))
    }

    fn temp_wav(tag: &str, len: usize) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "scholiast-cloud-{tag}-{}.wav",
            std::process::id()
        ));
        std::fs::write(&path, vec![0u8; len]).expect("write wav");
        path
    }

    #[tokio::test]
    async fn groq_happy_path_posts_multipart_and_returns_text() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/openai/v1/audio/transcriptions"))
            .and(header("Authorization", "Bearer gsk-test"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                serde_json::json!({ "text": "hello world", "x_groq": {} }),
            ))
            .expect(1)
            .mount(&server)
            .await;

        let wav = temp_wav("groq-ok", 64);
        let groq = GroqTranscriber::new(keys(&[(KEY_GROQ, "gsk-test")]), DEFAULT_GROQ_MODEL.into())
            .with_endpoint(format!("{}/openai/v1/audio/transcriptions", server.uri()));

        let text = groq.transcribe(&wav, Some("en"), None).await.expect("text");
        assert_eq!(text, "hello world");

        let requests = server.received_requests().await.expect("requests");
        assert_eq!(requests.len(), 1);
        let content_type = requests[0]
            .headers
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .expect("content-type")
            .to_string();
        assert!(content_type.starts_with("multipart/form-data"));
        let body = String::from_utf8_lossy(&requests[0].body);
        assert!(body.contains(r#"name="model""#));
        assert!(body.contains(DEFAULT_GROQ_MODEL));
        assert!(body.contains(r#"name="language""#));
        assert!(body.contains("en"));
        assert!(body.contains(r#"name="file""#));
        assert!(!body.contains(r#"name="prompt""#));
        std::fs::remove_file(wav).unwrap();
    }

    #[tokio::test]
    async fn groq_forwards_glossary_as_prompt_bias() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/openai/v1/audio/transcriptions"))
            .respond_with(ResponseTemplate::new(200)
                .set_body_json(serde_json::json!({ "text": "biased draft" })))
            .expect(1)
            .mount(&server)
            .await;

        let wav = temp_wav("groq-prompt", 64);
        let groq = GroqTranscriber::new(keys(&[(KEY_GROQ, "gsk-test")]), DEFAULT_GROQ_MODEL.into())
            .with_endpoint(format!("{}/openai/v1/audio/transcriptions", server.uri()));

        let text = groq
            .transcribe(&wav, Some("en"), Some("(Glossary: Scholiast, Tauri)"))
            .await
            .expect("text");
        assert_eq!(text, "biased draft");

        let requests = server.received_requests().await.expect("requests");
        let body = String::from_utf8_lossy(&requests[0].body);
        assert!(body.contains(r#"name="prompt""#));
        assert!(body.contains("(Glossary: Scholiast, Tauri)"));
        std::fs::remove_file(wav).unwrap();
    }

    #[tokio::test]
    async fn groq_401_surfaces_provider_agnostic_http_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401).set_body_json(
                serde_json::json!({ "error": { "message": "invalid api key" } }),
            ))
            .mount(&server)
            .await;

        let wav = temp_wav("groq-401", 16);
        let groq = GroqTranscriber::new(keys(&[(KEY_GROQ, "bad")]), DEFAULT_GROQ_MODEL.into())
            .with_endpoint(format!("{}/openai/v1/audio/transcriptions", server.uri()));

        match groq.transcribe(&wav, None, None).await {
            Err(err @ SttError::Http(401)) => {
                assert!(err.to_string().contains("HTTP 401"));
                assert!(!err.to_string().contains("groq"));
            }
            other => panic!("expected Http(401), got {other:?}"),
        }
        std::fs::remove_file(wav).unwrap();
    }

    #[tokio::test]
    async fn gemini_happy_path_sends_audio_original_prompt_and_parses_candidates() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1beta/models/gemini-flash-latest:generateContent"))
            .and(header("x-goog-api-key", "gm-test"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "candidates": [{
                    "content": { "parts": [{ "text": "revised note" }], "role": "model" }
                }]
            })))
            .expect(1)
            .mount(&server)
            .await;

        let wav = temp_wav("gem-ok", 32);
        let gemini =
            GeminiTranscriber::new(keys(&[(KEY_GEMINI, "gm-test")]), DEFAULT_GEMINI_MODEL.into())
                .with_endpoint_base(format!("{}/v1beta/models", server.uri()));

        let text = gemini
            .edit_text(&wav, "original note", None)
            .await
            .expect("edited");
        assert_eq!(text, "revised note");

        let requests = server.received_requests().await.expect("requests");
        let body: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        assert_eq!(
            body.pointer("/system_instruction/parts/0/text"),
            Some(&serde_json::json!(EDIT_PROMPT_DEFAULT))
        );
        assert_eq!(
            body.pointer("/contents/0/parts/1/text"),
            Some(&serde_json::json!("original note"))
        );
        let inline = body
            .pointer("/contents/0/parts/0/inline_data/data")
            .and_then(|v| v.as_str())
            .expect("inline data");
        assert_eq!(BASE64_STANDARD.decode(inline).unwrap(), vec![0u8; 32]);
        std::fs::remove_file(wav).unwrap();
    }

    #[tokio::test]
    async fn gemini_missing_key_is_gemini_required_without_network() {
        let gemini = GeminiTranscriber::new(keys(&[]), DEFAULT_GEMINI_MODEL.into());
        let wav = temp_wav("gem-nokey", 8);
        match gemini.edit_text(&wav, "note", None).await {
            Err(err @ SttError::GeminiRequired) => {
                assert_eq!(err.kind(), "gemini_required");
            }
            other => panic!("expected GeminiRequired, got {other:?}"),
        }
        std::fs::remove_file(wav).unwrap();
    }

    #[tokio::test]
    async fn groq_missing_key_is_no_provider_before_any_request() {
        let groq = GroqTranscriber::new(keys(&[]), DEFAULT_GROQ_MODEL.into());
        let wav = temp_wav("groq-nokey", 8);
        match groq.transcribe(&wav, None, None).await {
            Err(err @ SttError::NoProvider) => assert_eq!(err.kind(), "no_provider"),
            other => panic!("expected NoProvider, got {other:?}"),
        }
        std::fs::remove_file(wav).unwrap();
    }

    #[tokio::test]
    async fn missing_wav_is_invalid_input() {
        let groq =
            GroqTranscriber::new(keys(&[(KEY_GROQ, "k")]), DEFAULT_GROQ_MODEL.into());
        match groq
            .transcribe(Path::new("/nonexistent/scholiast.wav"), None, None)
            .await
        {
            Err(err @ SttError::InvalidInput(_)) => assert_eq!(err.kind(), "invalidInput"),
            other => panic!("expected InvalidInput, got {other:?}"),
        }
    }

    #[test]
    fn caps_flags_behave() {
        assert!(Caps::VERBATIM.contains(Caps::VERBATIM));
        assert!(!Caps::VERBATIM.contains(Caps::PROMPTED));
        assert_eq!(
            GroqTranscriber::new(keys(&[]), "m".into()).capabilities(),
            Caps::VERBATIM
        );
        assert_eq!(
            GeminiTranscriber::new(keys(&[]), "m".into()).capabilities(),
            Caps::PROMPTED
        );
    }

    #[test]
    fn stt_error_serializes_ipc_envelope_with_typed_kind() {
        let value = serde_json::to_value(SttError::NoProvider).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "ok": false,
                "error": { "kind": "no_provider", "message": "Set up speech in Settings" }
            })
        );
        let value = serde_json::to_value(SttError::GeminiRequired).unwrap();
        assert_eq!(value.pointer("/error/kind"), Some(&serde_json::json!("gemini_required")));
    }
}
