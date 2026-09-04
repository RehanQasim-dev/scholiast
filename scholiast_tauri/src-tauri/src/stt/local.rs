//! Local speech-to-text on whisper.cpp (feature `local-stt`), mirroring FUTO `WhisperGGML`:
//! one inference context owned by a dedicated worker thread, a cooperative cancel flag checked
//! inside whisper's abort callback (mid-inference) plus between segments, partial-segment
//! emission through a channel hook, language selection, a 2..=16 thread clamp and
//! `no_timestamps` for clips under 25 s.
//!
//! The commands below are not yet registered in `lib.rs` (integration deferred, same as
//! `recording.rs`); partial segments and download progress are logged where the real
//! `stt://partial` / progress event emits will go.

use crate::stt::models::{self, ModelSpec};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::fs;
#[cfg(feature = "local-stt")]
use std::{fs::File, io::Read, io::Seek, io::SeekFrom};
use tauri::Manager;
#[cfg(feature = "local-stt")]
use whisper_rs::{
    FullParams, SamplingStrategy, SegmentCallbackData, WhisperContext, WhisperContextParameters,
};

#[cfg(feature = "local-stt")]
const SAMPLE_RATE_HZ: u32 = 16_000;
#[cfg(feature = "local-stt")]
const NO_TIMESTAMPS_MAX_SECS: f32 = 25.0;
#[cfg(feature = "local-stt")]
const MIN_THREADS: i32 = 2;
#[cfg(feature = "local-stt")]
const MAX_THREADS: i32 = 16;

#[cfg(feature = "local-stt")]
fn clamp_threads(requested: Option<i32>) -> i32 {
    let detected = std::thread::available_parallelism().map_or(MIN_THREADS, |n| n.get() as i32);
    requested.unwrap_or(detected).clamp(MIN_THREADS, MAX_THREADS)
}

// ---------------------------------------------------------------------------
// WAV -> PCM (recording.rs writes canonical 44-byte-header PCM16 mono @16 kHz;
// this parser accepts exactly that shape and rejects anything else loudly).
// ---------------------------------------------------------------------------

#[cfg(feature = "local-stt")]
#[derive(Debug)]
pub struct WavPcm {
    pub sample_rate: u32,
    pub samples: Vec<f32>,
}

#[cfg(feature = "local-stt")]
pub fn parse_wav_pcm16(path: &Path) -> Result<WavPcm, String> {
    let mut file = File::open(path).map_err(|err| format!("open {}: {err}", path.display()))?;

    let mut riff = [0u8; 12];
    file.read_exact(&mut riff)
        .map_err(|err| format!("{}, not a RIFF file: {err}", path.display()))?;
    if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
        return Err(format!("{} is not a WAVE file", path.display()));
    }

    let mut fmt: Option<(u16, u16, u32, u16)> = None;
    let mut data: Option<Vec<u8>> = None;

    while data.is_none() {
        let mut header = [0u8; 8];
        match file.read_exact(&mut header) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(err) => return Err(format!("read chunk header: {err}")),
        }
        let id: [u8; 4] = header[0..4].try_into().unwrap();
        let size = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;

        if id == *b"fmt " {
            let mut body = [0u8; 16];
            file.read_exact(&mut body).map_err(|err| format!("read fmt: {err}"))?;
            let audio_format = u16::from_le_bytes(body[0..2].try_into().unwrap());
            let channels = u16::from_le_bytes(body[2..4].try_into().unwrap());
            let sample_rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
            let bits = u16::from_le_bytes(body[14..16].try_into().unwrap());
            if size > 16 {
                file.seek(SeekFrom::Current((size - 16) as i64))
                    .map_err(|err| format!("skip extra fmt bytes: {err}"))?;
            }
            fmt = Some((audio_format, channels, sample_rate, bits));
        } else if id == *b"data" {
            let mut body = vec![0u8; size];
            file.read_exact(&mut body)
                .map_err(|err| format!("read data: {err}"))?;
            data = Some(body);
        } else {
            let skip = size + (size % 2);
            file.seek(SeekFrom::Current(skip as i64))
                .map_err(|err| format!("skip chunk {id:?}: {err}"))?;
        }
    }

    let (audio_format, channels, sample_rate, bits) =
        fmt.ok_or_else(|| format!("{} has no fmt chunk", path.display()))?;
    if audio_format != 1 {
        return Err(format!("unsupported WAV encoding {audio_format} (want PCM)"));
    }
    if channels != 1 {
        return Err(format!("unsupported channel count {channels} (want mono)"));
    }
    if bits != 16 {
        return Err(format!("unsupported bit depth {bits} (want 16-bit PCM)"));
    }
    if sample_rate != SAMPLE_RATE_HZ {
        return Err(format!(
            "unsupported sample rate {sample_rate} Hz (voice recordings are {SAMPLE_RATE_HZ} Hz)"
        ));
    }
    let bytes = data.ok_or_else(|| format!("{} has no data chunk", path.display()))?;

    let samples: Vec<f32> = bytes
        .chunks_exact(2)
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32768.0)
        .collect();
    Ok(WavPcm { sample_rate, samples })
}

// ---------------------------------------------------------------------------
// Inference seam. Task 10 owns the shared `Transcriber` trait; until it lands,
// this local seam keeps the engine swappable for tests (and sherpa-onnx later).
// ---------------------------------------------------------------------------

#[cfg(feature = "local-stt")]
pub struct TranscribeRequest<'a> {
    pub pcm: &'a [f32],
    #[allow(dead_code)]
    pub sample_rate: u32,
    pub language: Option<&'a str>,
    pub no_timestamps: bool,
}

#[cfg(feature = "local-stt")]
pub type PartialHook = Box<dyn FnMut(String)>;

#[cfg(feature = "local-stt")]
pub trait InferenceBackend: Send + Sync {
    fn transcribe(
        &self,
        req: &TranscribeRequest<'_>,
        cancel: &Arc<AtomicBool>,
        partial: PartialHook,
    ) -> Result<String, String>;
}

#[cfg(feature = "local-stt")]
pub fn transcribe_with_backend(
    backend: &dyn InferenceBackend,
    wav_path: &Path,
    language: Option<&str>,
    cancel: &Arc<AtomicBool>,
    partial: impl FnMut(String) + 'static,
) -> Result<String, String> {
    let pcm = parse_wav_pcm16(wav_path)?;
    let duration_secs = pcm.samples.len() as f32 / pcm.sample_rate.max(1) as f32;
    let req = TranscribeRequest {
        pcm: &pcm.samples,
        sample_rate: pcm.sample_rate,
        language,
        no_timestamps: duration_secs < NO_TIMESTAMPS_MAX_SECS,
    };
    backend.transcribe(&req, cancel, Box::new(partial))
}

/// Real backend: one `WhisperContext` per model file is created once and reused across jobs
/// (FUTO `WhisperGGML` keeps a single context too); each job gets its own cheap `WhisperState`
/// because states own callbacks and cannot be shared concurrently.
#[cfg(feature = "local-stt")]
pub struct WhisperBackend {
    model_path: PathBuf,
    threads: i32,
}

#[cfg(feature = "local-stt")]
impl WhisperBackend {
    pub fn new(model_path: PathBuf, requested_threads: Option<i32>) -> Self {
        Self {
            model_path,
            threads: clamp_threads(requested_threads),
        }
    }
}

#[cfg(feature = "local-stt")]
type CachedContext = (PathBuf, Arc<WhisperContext>);

#[cfg(feature = "local-stt")]
static CONTEXT_CACHE: LazyLock<Mutex<Option<CachedContext>>> = LazyLock::new(|| Mutex::new(None));

#[cfg(feature = "local-stt")]
fn context_for(model_path: &Path) -> Result<Arc<WhisperContext>, String> {
    let mut cache = CONTEXT_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((path, ctx)) = cache.as_ref() {
        if path == model_path {
            return Ok(ctx.clone());
        }
    }
    let ctx = WhisperContext::new_with_params(
        &model_path.to_string_lossy(),
        WhisperContextParameters::default(),
    )
    .map_err(|err| format!("load model {}: {err}", model_path.display()))?;
    let ctx = Arc::new(ctx);
    *cache = Some((model_path.to_path_buf(), ctx.clone()));
    Ok(ctx)
}

#[cfg(feature = "local-stt")]
impl InferenceBackend for WhisperBackend {
    fn transcribe(
        &self,
        req: &TranscribeRequest<'_>,
        cancel: &Arc<AtomicBool>,
        mut partial: PartialHook,
    ) -> Result<String, String> {
        let ctx = context_for(&self.model_path)?;
        let mut state = ctx.create_state().map_err(|err| err.to_string())?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(self.threads);
        params.set_language(req.language);
        params.set_no_timestamps(req.no_timestamps);

        let segment_cancel = Arc::clone(cancel);
        params.set_segment_callback_safe(move |data: SegmentCallbackData| {
            // Checked here AND in the abort callback: the abort hook stops further decode
            // steps, the segment hook surfaces only text decoded before cancellation.
            if !segment_cancel.load(Ordering::Relaxed) {
                partial(data.text);
            }
        });

        let abort_flag = Arc::clone(cancel);
        params.set_abort_callback_safe(move || abort_flag.load(Ordering::Relaxed));

        state.full(params, req.pcm).map_err(|err| err.to_string())?;

        let n = state.full_n_segments().map_err(|err| err.to_string())?;
        let mut text = String::new();
        for i in 0..n {
            text.push_str(&state.full_get_segment_text(i).map_err(|err| err.to_string())?);
        }
        Ok(text.trim().to_string())
    }
}

// ---------------------------------------------------------------------------
// Worker thread + job queue (one inference at a time, FUTO-style).
// ---------------------------------------------------------------------------

#[allow(dead_code)]
pub struct Job {
    pub session_id: String,
    pub model_path: PathBuf,
    pub wav_path: PathBuf,
    pub language: Option<String>,
    pub requested_threads: Option<i32>,
    pub cancel: Arc<AtomicBool>,
    /// Partial-segment hook. When absent, partials are logged only; the real
    /// `stt://partial {sessionId,text}` event emit lands with lib.rs integration.
    pub partial_tx: Option<mpsc::Sender<String>>,
    pub reply: mpsc::SyncSender<Result<String, String>>,
}

enum WorkerMsg {
    Run(Job),
}

static WORKER_SENDER: LazyLock<Mutex<Option<mpsc::Sender<WorkerMsg>>>> =
    LazyLock::new(|| Mutex::new(None));

fn worker_sender() -> mpsc::Sender<WorkerMsg> {
    let mut slot = WORKER_SENDER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(sender) = slot.as_ref() {
        return sender.clone();
    }
    let (sender, receiver) = mpsc::channel::<WorkerMsg>();
    std::thread::Builder::new()
        .name("stt-local-worker".into())
        .spawn(move || worker_loop(receiver))
        .expect("spawn stt-local-worker");
    *slot = Some(sender.clone());
    sender
}

fn worker_loop(receiver: mpsc::Receiver<WorkerMsg>) {
    for msg in receiver {
        let WorkerMsg::Run(job) = msg;
        if job.cancel.load(Ordering::Relaxed) {
            let _ = job.reply.send(Err("cancelled".into()));
            continue;
        }
        #[cfg(feature = "local-stt")]
        let result = {
            let backend = WhisperBackend::new(job.model_path.clone(), job.requested_threads);
            let partial_tx = job.partial_tx.clone();
            transcribe_with_backend(
                &backend,
                &job.wav_path,
                job.language.as_deref(),
                &job.cancel,
                move |text| match partial_tx.as_ref() {
                    Some(tx) => {
                        let _ = tx.send(text);
                    }
                    None => eprintln!("stt://partial {}", text.trim()),
                },
            )
        };
        #[cfg(not(feature = "local-stt"))]
        let result = Err("local-stt inference engine is not enabled in this build".into());
        let _ = job.reply.send(result);
    }
}

static SESSIONS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

fn new_session_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!(
        "{prefix}{nanos:x}-{:04x}",
        NEXT_SESSION.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn register_session(session_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    SESSIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(session_id.to_string(), flag.clone());
    flag
}

pub fn release_session(session_id: &str) {
    SESSIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(session_id);
}

pub fn cancel_session(session_id: &str) -> bool {
    let sessions = SESSIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    sessions
        .get(session_id)
        .map(|flag| flag.store(true, Ordering::Relaxed))
        .is_some()
}

pub fn submit_job(job: Job) -> Result<(), String> {
    worker_sender()
        .send(WorkerMsg::Run(job))
        .map_err(|err| err.to_string())
}

fn models_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_handle
        .path()
        .app_data_dir()
        .map(|dir| dir.join("models"))
        .map_err(|err| err.to_string())
}

fn resolve_model(models_dir: &Path, explicit_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(explicit) = explicit_path {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
        let in_dir = models_dir.join(explicit);
        if in_dir.is_file() {
            return Ok(in_dir);
        }
        if let Some(spec) = models::find_model(explicit) {
            let p = models_dir.join(spec.file_name);
            if p.is_file() {
                return Ok(p);
            }
        }
        return Err(format!("model not found: {explicit}"));
    }
    models::first_installed_model_path(models_dir)
        .ok_or_else(|| "no local STT model installed; download or import one first".to_string())
}

#[tauri::command]
#[allow(dead_code)]
pub async fn stt_local_transcribe(
    app_handle: tauri::AppHandle,
    wav_path: String,
    language: Option<String>,
    model_path: Option<String>,
) -> Result<String, String> {
    let dir = models_dir(&app_handle)?;
    let resolved = resolve_model(&dir, model_path.as_deref())?;
    let session_id = new_session_id("stt");
    let cancel = register_session(&session_id);
    let (reply_tx, reply_rx) = mpsc::sync_channel::<Result<String, String>>(1);

    submit_job(Job {
        session_id: session_id.clone(),
        model_path: resolved,
        wav_path: PathBuf::from(&wav_path),
        language,
        requested_threads: None,
        cancel,
        partial_tx: None,
        reply: reply_tx,
    })?;

    let joined = tauri::async_runtime::spawn_blocking(move || reply_rx.recv()).await;
    release_session(&session_id);
    match joined {
        Ok(Ok(result)) => result,
        Ok(Err(err)) => Err(err.to_string()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
#[allow(dead_code)]
pub fn stt_local_cancel(session_id: String) -> Result<bool, String> {
    Ok(cancel_session(&session_id))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResponse {
    pub models: Vec<models::CatalogEntry>,
}

/// Whether the whisper inference engine is compiled into this build.
/// Deliberately ungated: the catalog commands always exist, so without this
/// the frontend cannot tell "model installed but engine missing" (record →
/// guaranteed transcribe failure) apart from ready. The transcriber itself
/// stays behind `local-stt`.
#[tauri::command]
#[allow(dead_code)]
pub fn stt_local_engine_available() -> bool {
    cfg!(feature = "local-stt")
}

#[tauri::command]
#[allow(dead_code)]
pub fn list_stt_models(app_handle: tauri::AppHandle) -> Result<ModelListResponse, String> {
    let dir = models_dir(&app_handle)?;
    Ok(ModelListResponse {
        models: models::catalog_json(&dir),
    })
}

#[tauri::command]
#[allow(dead_code)]
pub async fn download_stt_model(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<models::CatalogEntry, String> {
    let spec: &'static ModelSpec =
        models::find_model(&id).ok_or_else(|| format!("unknown model id: {id}"))?;
    let dir = models_dir(&app_handle)?;

    if models::model_path(&dir, spec).is_file() {
        return Ok(models::catalog_json(&dir)
            .into_iter()
            .find(|entry| entry.id == spec.id)
            .expect("entry exists"));
    }

    let session_id = new_session_id("dl");
    let cancel = register_session(&session_id);
    let result = download_and_install(spec, &dir, &cancel).await;
    release_session(&session_id);
    result?;
    Ok(models::catalog_json(&dir)
        .into_iter()
        .find(|entry| entry.id == spec.id)
        .expect("entry exists"))
}

#[tauri::command]
#[allow(dead_code)]
pub async fn import_stt_model_chunk(
    app_handle: tauri::AppHandle,
    file_name: String,
    chunk_base64: String,
    append: bool,
) -> Result<bool, String> {
    use base64::Engine;
    use std::io::Write;

    let dir = models_dir(&app_handle)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let clean_name = Path::new(&file_name)
        .file_name()
        .ok_or_else(|| "invalid file name".to_string())?
        .to_string_lossy()
        .into_owned();

    let target_path = dir.join(&clean_name);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&chunk_base64)
        .map_err(|e| format!("decode base64: {e}"))?;

    let mut options = fs::OpenOptions::new();
    options.create(true).write(true);
    if append {
        options.append(true);
    } else {
        options.truncate(true);
    }

    let mut file = options
        .open(&target_path)
        .map_err(|e| format!("open {}: {e}", target_path.display()))?;
    file.write_all(&bytes)
        .map_err(|e| format!("write {}: {e}", target_path.display()))?;

    Ok(true)
}

#[tauri::command]
#[allow(dead_code)]
pub async fn delete_stt_model(app_handle: tauri::AppHandle, id: String) -> Result<bool, String> {
    let dir = models_dir(&app_handle)?;
    // If id is a catalog model, find spec file_name
    let file_name = if let Some(spec) = models::find_model(&id) {
        spec.file_name.to_string()
    } else {
        id
    };
    let path = dir.join(file_name);
    if path.is_file() {
        let _ = fs::remove_file(path);
    }
    Ok(true)
}

async fn download_and_install(
    spec: &'static ModelSpec,
    dir: &Path,
    cancel: &AtomicBool,
) -> Result<PathBuf, String> {
    let mut response = reqwest::Client::new()
        .get(spec.url)
        .timeout(Duration::from_secs(30 * 60))
        .send()
        .await
        .map_err(|err| format!("download {}: {err}", spec.url))?
        .error_for_status()
        .map_err(|err| format!("download {}: {err}", spec.url))?;

    let mut installer = models::ModelInstaller::start(spec, dir)?;
    let mut last_logged_mb = 0u64;
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(err) => {
                installer.abort();
                return Err(format!("download stream: {err}"));
            }
        };
        if cancel.load(Ordering::Relaxed) {
            installer.abort();
            return Err("cancelled".to_string());
        }
        if let Err(err) = installer.push(&chunk) {
            installer.abort();
            return Err(err);
        }
        let mb = installer.progress() / (1024 * 1024);
        if mb >= last_logged_mb + 10 {
            last_logged_mb += 10;
            eprintln!("stt://download-progress {} {}MB", spec.id, last_logged_mb);
        }
    }
    installer.finish(spec)
}

#[cfg(all(test, feature = "local-stt"))]
mod tests {
    use super::*;
    use std::io::Write;

    struct TempWav(PathBuf);

    impl TempWav {
        fn new(tag: &str) -> Self {
            Self(std::env::temp_dir().join(format!(
                "scholiast-stt-{tag}-{}-{:?}.wav",
                std::process::id(),
                std::thread::current().id()
            )))
        }
    }

    impl Drop for TempWav {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn write_test_wav(tag: &str, pcm16: &[i16], sample_rate: u32) -> TempWav {
        let temp = TempWav::new(tag);
        let mut file = File::create(&temp.0).unwrap();
        let data_len = (pcm16.len() * 2) as u32;
        let mut header = [0u8; 44];
        header[0..4].copy_from_slice(b"RIFF");
        header[4..8].copy_from_slice(&(36 + data_len).to_le_bytes());
        header[8..12].copy_from_slice(b"WAVE");
        header[12..16].copy_from_slice(b"fmt ");
        header[16..20].copy_from_slice(&16u32.to_le_bytes());
        header[20..22].copy_from_slice(&1u16.to_le_bytes());
        header[22..24].copy_from_slice(&1u16.to_le_bytes());
        header[24..28].copy_from_slice(&sample_rate.to_le_bytes());
        header[28..32].copy_from_slice(&(sample_rate * 2).to_le_bytes());
        header[32..34].copy_from_slice(&2u16.to_le_bytes());
        header[34..36].copy_from_slice(&16u16.to_le_bytes());
        header[36..40].copy_from_slice(b"data");
        header[40..44].copy_from_slice(&data_len.to_le_bytes());
        file.write_all(&header).unwrap();
        for sample in pcm16 {
            file.write_all(&sample.to_le_bytes()).unwrap();
        }
        temp
    }

    struct EchoBackend;

    impl InferenceBackend for EchoBackend {
        fn transcribe(
            &self,
            req: &TranscribeRequest<'_>,
            _cancel: &Arc<AtomicBool>,
            mut partial: PartialHook,
        ) -> Result<String, String> {
            partial(format!("partial:{}:{}", req.pcm.len(), req.no_timestamps));
            Ok(format!(
                "echo|len={}|lang={:?}|no_ts={}",
                req.pcm.len(),
                req.language,
                req.no_timestamps
            ))
        }
    }

    #[test]
    fn parses_synthetic_wav_to_pcm() {
        let pcm16: Vec<i16> = (0..320i16).map(|i| i.wrapping_mul(100)).collect();
        let temp = write_test_wav("parse", &pcm16, SAMPLE_RATE_HZ);

        let parsed = parse_wav_pcm16(&temp.0).unwrap();
        assert_eq!(parsed.sample_rate, SAMPLE_RATE_HZ);
        assert_eq!(parsed.samples.len(), 320);
        assert!((parsed.samples[0] - 0.0).abs() < 1e-9);
        assert!((parsed.samples[1] - 100f32 / 32768.0).abs() < 1e-6);
    }

    #[test]
    fn rejects_wrong_format_wavs() {
        let low_rate = write_test_wav("lowrate", &[0i16; 4], 8000);
        let err = parse_wav_pcm16(&low_rate.0).unwrap_err();
        assert!(err.contains("sample rate"), "got: {err}");

        let good = write_test_wav("accept", &[0i16; 4], SAMPLE_RATE_HZ);
        assert!(parse_wav_pcm16(&good.0).is_ok());

        let missing = TempWav::new("missing");
        assert!(parse_wav_pcm16(&missing.0).is_err());
    }

    #[test]
    fn mock_backend_receives_parsed_request_with_no_timestamps_policy() {
        // 1600 samples @16 kHz = 0.1 s clip => no_timestamps must be on.
        let temp = write_test_wav("mock", &vec![16384; 1600], SAMPLE_RATE_HZ);

        let cancel = Arc::new(AtomicBool::new(false));
        let (partial_tx, partial_rx) = mpsc::channel::<String>();
        let text =
            transcribe_with_backend(&EchoBackend, &temp.0, Some("en"), &cancel, move |p| {
                let _ = partial_tx.send(p);
            })
            .unwrap();

        assert_eq!(text, "echo|len=1600|lang=Some(\"en\")|no_ts=true");
        assert_eq!(
            partial_rx.try_iter().collect::<Vec<_>>(),
            vec!["partial:1600:true".to_string()]
        );
    }

    #[test]
    fn long_clip_leaves_timestamps_on() {
        // 26 s of silence crosses the 25 s policy boundary.
        let pcm16 = vec![0i16; SAMPLE_RATE_HZ as usize * 26];
        let temp = write_test_wav("long", &pcm16, SAMPLE_RATE_HZ);

        let cancel = Arc::new(AtomicBool::new(false));
        let text =
            transcribe_with_backend(&EchoBackend, &temp.0, None, &cancel, |_| {}).unwrap();
        assert!(text.ends_with("no_ts=false"));
    }

    struct LatchBackend {
        started_tx: mpsc::Sender<()>,
    }

    impl InferenceBackend for LatchBackend {
        fn transcribe(
            &self,
            _req: &TranscribeRequest<'_>,
            cancel: &Arc<AtomicBool>,
            _partial: PartialHook,
        ) -> Result<String, String> {
            let _ = self.started_tx.send(());
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            while std::time::Instant::now() < deadline {
                if cancel.load(Ordering::Relaxed) {
                    return Err("cancelled".to_string());
                }
                std::thread::yield_now();
            }
            Ok("never cancelled".to_string())
        }
    }

    #[test]
    fn cancel_flag_stops_mock_promptly() {
        let temp = write_test_wav("cancel", &[0i16; 160], SAMPLE_RATE_HZ);
        let cancel = Arc::new(AtomicBool::new(false));
        let job_cancel = Arc::clone(&cancel);
        let (started_tx, started_rx) = mpsc::channel::<()>();
        let handle = std::thread::spawn(move || {
            transcribe_with_backend(
                &LatchBackend { started_tx },
                &temp.0,
                None,
                &job_cancel,
                |_| {},
            )
        });
        // Wait until inference is demonstrably inside the backend loop, then cancel.
        started_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("backend never signalled start");
        let since_cancel = std::time::Instant::now();
        cancel.store(true, Ordering::Relaxed);
        let result = handle.join().unwrap();
        assert_eq!(result.unwrap_err(), "cancelled");
        assert!(
            since_cancel.elapsed() < Duration::from_secs(5),
            "cancel returned too late"
        );
    }

    #[test]
    fn thread_count_is_clamped() {
        assert_eq!(clamp_threads(Some(0)), MIN_THREADS);
        assert_eq!(clamp_threads(Some(1)), MIN_THREADS);
        assert_eq!(clamp_threads(Some(999)), MAX_THREADS);
        assert_eq!(clamp_threads(Some(4)), 4);
        assert!((MIN_THREADS..=MAX_THREADS).contains(&clamp_threads(None)));
    }

    #[test]
    fn session_cancel_roundtrip() {
        let id = new_session_id("t");
        assert!(!cancel_session(&id), "unknown session must not claim success");
        register_session(&id);
        assert!(cancel_session(&id));
        release_session(&id);
        release_session(&id); // double release is a no-op
    }

    // Manual real-inference smoke (never runs in CI):
    //   SCHOLIAST_STT_SMOKE_MODEL=/path/to/ggml-tiny.en.bin \
    //   SCHOLIAST_STT_SMOKE_WAV=/path/to/sample.wav \
    //   cargo test -p <crate> --features local-stt -- --ignored stt_local_smoke
    #[test]
    #[ignore = "manual only: needs a downloaded whisper GGML model + sample WAV"]
    fn stt_local_smoke() {
        let model_path = std::env::var("SCHOLIAST_STT_SMOKE_MODEL").expect("set SCHOLIAST_STT_SMOKE_MODEL");
        let wav_path = std::env::var("SCHOLIAST_STT_SMOKE_WAV").expect("set SCHOLIAST_STT_SMOKE_WAV");
        let backend = WhisperBackend::new(PathBuf::from(model_path), None);
        let cancel = Arc::new(AtomicBool::new(false));
        let started = std::time::Instant::now();
        let text = transcribe_with_backend(&backend, Path::new(&wav_path), Some("en"), &cancel, |_| {})
            .expect("smoke inference failed");
        println!("stt_local_smoke: {} ms -> {:?}", started.elapsed().as_millis(), text);
    }
}
