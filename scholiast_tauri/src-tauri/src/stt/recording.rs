//! Session-based voice recording: streaming 16 kHz mono PCM16 WAV assembly.
//!
//! The four `voice_*` commands are intentionally not registered in
//! `lib.rs` yet (integration is deferred); they are self-contained —
//! registering them with `tauri::generate_handler!` requires nothing else.

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const SAMPLE_RATE_HZ: u32 = 16_000;
const CHANNELS: u16 = 1;
const BITS_PER_SAMPLE: u16 = 16;

static SESSIONS: LazyLock<Mutex<HashMap<String, RecordingSession>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static NEXT_SESSION: AtomicU64 = AtomicU64::new(1);

struct RecordingSession {
    file: File,
    path: PathBuf,
    data_bytes: u32,
}

fn wav_header(data_len: u32) -> [u8; 44] {
    let mut header = [0u8; 44];
    let byte_rate = SAMPLE_RATE_HZ * CHANNELS as u32 * (BITS_PER_SAMPLE / 8) as u32;
    let block_align = CHANNELS * (BITS_PER_SAMPLE / 8);
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&data_len.saturating_add(36).to_le_bytes());
    header[8..12].copy_from_slice(b"WAVE");
    header[12..16].copy_from_slice(b"fmt ");
    header[16..20].copy_from_slice(&16u32.to_le_bytes());
    header[20..22].copy_from_slice(&1u16.to_le_bytes());
    header[22..24].copy_from_slice(&CHANNELS.to_le_bytes());
    header[24..28].copy_from_slice(&SAMPLE_RATE_HZ.to_le_bytes());
    header[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    header[32..34].copy_from_slice(&block_align.to_le_bytes());
    header[34..36].copy_from_slice(&BITS_PER_SAMPLE.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data_len.to_le_bytes());
    header
}

impl RecordingSession {
    fn create(path: PathBuf) -> std::io::Result<Self> {
        let mut file = File::create(&path)?;
        file.write_all(&wav_header(0))?;
        Ok(Self {
            file,
            path,
            data_bytes: 0,
        })
    }

    fn append(&mut self, pcm: &[u8]) -> std::io::Result<()> {
        self.file.write_all(pcm)?;
        self.data_bytes = self.data_bytes.saturating_add(pcm.len() as u32);
        Ok(())
    }

    fn finalize(mut self) -> std::io::Result<u32> {
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(&wav_header(self.data_bytes))?;
        self.file.flush()?;
        Ok(self.data_bytes)
    }
}

fn sessions() -> MutexGuard<'static, HashMap<String, RecordingSession>> {
    SESSIONS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn new_session_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!(
        "v{nanos:x}-{:04x}",
        NEXT_SESSION.fetch_add(1, Ordering::Relaxed)
    )
}

fn begin_session(voice_dir: &Path) -> Result<String, String> {
    fs::create_dir_all(voice_dir).map_err(|err| err.to_string())?;
    let id = new_session_id();
    let session =
        RecordingSession::create(voice_dir.join(format!("{id}.wav"))).map_err(|err| err.to_string())?;
    sessions().insert(id.clone(), session);
    Ok(id)
}

fn append_chunk(session_id: &str, pcm_base64: &str) -> Result<(), String> {
    let pcm = BASE64_STANDARD
        .decode(pcm_base64.trim())
        .map_err(|err| format!("invalid base64 chunk: {err}"))?;
    sessions()
        .get_mut(session_id)
        .ok_or_else(|| format!("unknown voice session: {session_id}"))?
        .append(&pcm)
        .map_err(|err| err.to_string())
}

fn finish_session(session_id: &str) -> Result<String, String> {
    let session = sessions()
        .remove(session_id)
        .ok_or_else(|| format!("unknown voice session: {session_id}"))?;
    let path = session.path.clone();
    session.finalize().map_err(|err| err.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

fn cancel_session(session_id: &str) -> Result<(), String> {
    let session = sessions()
        .remove(session_id)
        .ok_or_else(|| format!("unknown voice session: {session_id}"))?;
    match fs::remove_file(&session.path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
#[allow(dead_code)]
pub fn voice_begin(app_handle: tauri::AppHandle) -> Result<String, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    // Warm the whisper context while the user speaks (FUTO preloads on
    // recording start); best-effort, never fails recording when no model
    // is installed yet.
    super::local::warm_default_model(&data_dir.join("models"));
    begin_session(&data_dir.join("voice"))
}

#[tauri::command]
#[allow(dead_code)]
pub fn voice_append_chunk(session_id: String, pcm_base64: String) -> Result<(), String> {
    append_chunk(&session_id, &pcm_base64)
}

#[tauri::command]
#[allow(dead_code)]
pub fn voice_finish(session_id: String) -> Result<String, String> {
    finish_session(&session_id)
}

#[tauri::command]
#[allow(dead_code)]
pub fn voice_cancel(session_id: String) -> Result<(), String> {
    cancel_session(&session_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    struct TempWav(PathBuf);

    impl TempWav {
        fn new(tag: &str) -> Self {
            Self(std::env::temp_dir().join(format!(
                "scholiast-wav-{tag}-{}.wav",
                std::process::id()
            )))
        }
    }

    impl Drop for TempWav {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    #[test]
    fn assembled_chunks_parse_back_as_valid_wav() {
        let temp = TempWav::new("assemble");
        let mut writer = RecordingSession::create(temp.0.clone()).unwrap();

        let pattern = |seed: u16| -> Vec<u8> {
            (0..1600u16)
                .flat_map(|i| (seed.wrapping_add(i)).to_le_bytes())
                .collect()
        };
        let chunk_a = pattern(0);
        let chunk_b = pattern(1000);
        writer.append(&chunk_a).unwrap();
        writer.append(&chunk_b).unwrap();
        writer.finalize().unwrap();

        let mut file = File::open(&temp.0).unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();

        let expected_payload = [chunk_a, chunk_b].concat();
        assert_eq!(bytes.len(), 44 + expected_payload.len());
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 36 + expected_payload.len() as u32);
        assert_eq!(u32::from_le_bytes(bytes[16..20].try_into().unwrap()), 16);
        assert_eq!(u16::from_le_bytes(bytes[20..22].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), CHANNELS);
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            SAMPLE_RATE_HZ
        );
        assert_eq!(
            u32::from_le_bytes(bytes[28..32].try_into().unwrap()),
            SAMPLE_RATE_HZ * CHANNELS as u32 * 2
        );
        assert_eq!(u16::from_le_bytes(bytes[32..34].try_into().unwrap()), 2);
        assert_eq!(u16::from_le_bytes(bytes[34..36].try_into().unwrap()), BITS_PER_SAMPLE);
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(
            u32::from_le_bytes(bytes[40..44].try_into().unwrap()),
            expected_payload.len() as u32
        );
        assert_eq!(&bytes[44..], &expected_payload[..]);
    }

    #[test]
    fn cancel_removes_partial_file_and_session() {
        let id = begin_session(&std::env::temp_dir()).unwrap();
        let path = std::env::temp_dir().join(format!("{id}.wav"));
        assert!(path.exists());

        append_chunk(&id, &BASE64_STANDARD.encode([1u8, 2, 3, 4])).unwrap();
        cancel_session(&id).unwrap();
        assert!(!path.exists());
        assert!(append_chunk(&id, "").is_err());
        assert!(finish_session(&id).is_err());
    }
}
