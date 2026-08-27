//! Local STT model catalog, checksum verification and download/installation.
//!
//! Model artifacts are the official whisper.cpp GGML builds from
//! `https://huggingface.co/ggerganov/whisper.cpp` (whisper-rs *is* whisper.cpp, so these are the
//! guaranteed-compatible binaries). The FUTO `*_acft_q8_0.bin` pins from the Android keyboard's
//! `Models.kt` are recorded below as provenance but their URLs 404 in the wild (verified by the
//! android port, see `tauri-tasks/task-11-local-stt-whisper/LOG.md`) and FUTO publishes no hashes
//! for its live replacements; a wrong/dead URL therefore fails safely at checksum time.
//!
//! SHA-256 pins are the HuggingFace LFS OIDs queried from the repo tree API.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub url: &'static str,
    pub file_name: &'static str,
    pub size_bytes: u64,
    pub sha256: &'static str,
}

/// English-only tiny model, ~78 MB. Default: fastest CPU inference for short voice notes.
pub const DEFAULT_MODEL_ID: &str = "tiny_en";

/// FUTO provenance (`voiceinput-shared/.../Models.kt`, files dead upstream):
/// base_en_acft_q8_0.bin = e9b4b7b81b8a28769e8aa9962aa39bb9f21b622cf6a63982e93f065ed5caf1c8
/// small_en_acft_q8_0.bin = 58fbe949992dafed917590d58bc12ca577b08b9957f0b3e0d7ee71b64bed3aa8
pub const MODEL_CATALOG: [ModelSpec; 3] = [
    ModelSpec {
        id: "tiny_en",
        label: "Tiny (English) ~78 MB",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        file_name: "ggml-tiny.en.bin",
        size_bytes: 77_704_715,
        sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
    },
    ModelSpec {
        id: "base_en",
        label: "Base (English) ~148 MB",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        file_name: "ggml-base.en.bin",
        size_bytes: 147_964_211,
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    },
    ModelSpec {
        id: "small_en",
        label: "Small (English) ~488 MB",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
        file_name: "ggml-small.en.bin",
        size_bytes: 487_614_201,
        sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
    },
];

pub fn find_model(id: &str) -> Option<&'static ModelSpec> {
    MODEL_CATALOG.iter().find(|m| m.id == id)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub id: String,
    pub label: String,
    pub url: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub is_default: bool,
    pub installed: bool,
    pub local_path: Option<String>,
}

pub fn catalog_json(models_dir: &Path) -> Vec<CatalogEntry> {
    let mut entries: Vec<CatalogEntry> = MODEL_CATALOG
        .iter()
        .map(|spec| {
            let path = model_path(models_dir, spec);
            let installed = path.is_file();
            CatalogEntry {
                id: spec.id.to_string(),
                label: spec.label.to_string(),
                url: spec.url.to_string(),
                file_name: spec.file_name.to_string(),
                size_bytes: spec.size_bytes,
                is_default: spec.id == DEFAULT_MODEL_ID,
                installed,
                local_path: installed.then(|| path.to_string_lossy().into_owned()),
            }
        })
        .collect();

    // Scan models_dir for custom .bin models imported by the user
    if let Ok(read_dir) = fs::read_dir(models_dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "bin") {
                let fname = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
                if !entries.iter().any(|e| e.file_name == fname) {
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    let mb = size / (1024 * 1024);
                    entries.push(CatalogEntry {
                        id: fname.clone(),
                        label: format!("{fname} (~{mb} MB)"),
                        url: String::new(),
                        file_name: fname,
                        size_bytes: size,
                        is_default: false,
                        installed: true,
                        local_path: Some(path.to_string_lossy().into_owned()),
                    });
                }
            }
        }
    }

    entries
}

pub fn model_path(models_dir: &Path, spec: &ModelSpec) -> PathBuf {
    models_dir.join(spec.file_name)
}

/// First installed catalog model, preferring the default; `None` when nothing is installed.
pub fn first_installed_model(models_dir: &Path) -> Option<&'static ModelSpec> {
    let default_first = |spec: &&'static ModelSpec| match spec.id == DEFAULT_MODEL_ID {
        true => 0,
        false => 1,
    };
    MODEL_CATALOG
        .iter()
        .filter(|spec| model_path(models_dir, spec).is_file())
        .min_by_key(default_first)
}

pub fn first_installed_model_path(models_dir: &Path) -> Option<PathBuf> {
    if let Some(spec) = first_installed_model(models_dir) {
        return Some(model_path(models_dir, spec));
    }
    // Check if any custom .bin model exists
    if let Ok(read_dir) = fs::read_dir(models_dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "bin") {
                return Some(path);
            }
        }
    }
    None
}

#[allow(dead_code)]
fn hash_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|err| format!("open {}: {err}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|err| format!("read {}: {err}", path.display()))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[allow(dead_code)]
pub fn verify_checksum(path: &Path, expected_sha256: &str) -> Result<bool, String> {
    Ok(hash_file(path)?.eq_ignore_ascii_case(expected_sha256))
}

/// Streaming installer: write downloaded chunks through [`push`], then [`finish`] verifies the
/// pinned checksum and renames into place atomically. A cancelled or failed install leaves only
/// the `.part` file behind (removed), never a corrupt final model.
pub struct ModelInstaller {
    tmp_path: PathBuf,
    file: File,
    hasher: Sha256,
    written: u64,
}

impl ModelInstaller {
    pub fn start(spec: &ModelSpec, models_dir: &Path) -> Result<Self, String> {
        fs::create_dir_all(models_dir).map_err(|err| err.to_string())?;
        let tmp_path = models_dir.join(format!("{}.part", spec.file_name));
        let file = File::create(&tmp_path).map_err(|err| err.to_string())?;
        Ok(Self {
            tmp_path,
            file,
            hasher: Sha256::new(),
            written: 0,
        })
    }

    pub fn push(&mut self, bytes: &[u8]) -> Result<(), String> {
        self.file
            .write_all(bytes)
            .map_err(|err| err.to_string())?;
        self.hasher.update(bytes);
        self.written += bytes.len() as u64;
        Ok(())
    }

    pub fn progress(&self) -> u64 {
        self.written
    }

    pub fn finish(self, spec: &ModelSpec) -> Result<PathBuf, String> {
        let Self {
            tmp_path,
            file,
            hasher,
            ..
        } = self;
        drop(file);
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(spec.sha256) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "checksum mismatch for {} (got {actual}, want {})",
                spec.file_name, spec.sha256
            ));
        }
        let final_path = tmp_path.with_extension("");
        fs::rename(&tmp_path, &final_path).map_err(|err| err.to_string())?;
        Ok(final_path)
    }

    pub fn abort(self) {
        drop(self.file);
        let _ = fs::remove_file(&self.tmp_path);
    }
}

/// Blocking convenience wrapper over [`ModelInstaller`] for reader sources (tests).
#[allow(dead_code)]
pub fn install_model_from_reader<R: Read>(
    mut source: R,
    spec: &ModelSpec,
    models_dir: &Path,
    cancel: Option<&AtomicBool>,
    mut progress: impl FnMut(u64, u64),
) -> Result<PathBuf, String> {
    let mut installer = ModelInstaller::start(spec, models_dir)?;
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        if cancel.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            installer.abort();
            return Err("cancelled".to_string());
        }
        let n = match source.read(&mut buf) {
            Ok(n) => n,
            Err(err) => {
                installer.abort();
                return Err(err.to_string());
            }
        };
        if n == 0 {
            break;
        }
        if let Err(err) = installer.push(&buf[..n]) {
            installer.abort();
            return Err(err);
        }
        progress(installer.progress(), spec.size_bytes);
    }
    installer.finish(spec)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            Self(std::env::temp_dir().join(format!(
                "scholiast-models-{tag}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            )))
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn sha256_matches_known_vectors() {
        let digest = |data: &[u8]| format!("{:x}", Sha256::digest(data));
        assert_eq!(
            digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            digest(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn checksum_verify_on_temp_file() {
        let dir = TempDir::new("verify");
        fs::create_dir_all(&dir.0).unwrap();
        let path = dir.0.join("blob.bin");
        fs::write(&path, b"scholiast").unwrap();

        let actual = hash_file(&path).unwrap();
        assert!(verify_checksum(&path, &actual).unwrap());
        let tampered = format!("{}0", &actual[..63]);
        assert!(!verify_checksum(&path, &tampered).unwrap());
    }

    #[test]
    fn installer_verifies_before_rename_and_cleans_up() {
        let dir = TempDir::new("install");
        let spec = ModelSpec {
            id: "fake",
            label: "fake",
            url: "",
            file_name: "fake.bin",
            size_bytes: 9,
            sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        };

        let bad = install_model_from_reader(
            &b"abcd"[..],
            &spec,
            &dir.0,
            None,
            |_, _| {},
        );
        assert!(bad.is_err());
        assert!(!dir.0.join("fake.bin").exists());
        assert!(!dir.0.join("fake.bin.part").exists());

        install_model_from_reader(&b"abc"[..], &spec, &dir.0, None, |_, _| {}).unwrap();
        assert!(dir.0.join("fake.bin").exists());
        assert!(!dir.0.join("fake.bin.part").exists());
    }

    #[test]
    fn installer_honours_cancel_flag() {
        let dir = TempDir::new("cancel");
        let spec = ModelSpec {
            id: "fake",
            label: "fake",
            url: "",
            file_name: "fake.bin",
            size_bytes: 9,
            sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        };
        let cancel = AtomicBool::new(true);
        let result =
            install_model_from_reader(&b"abc"[..], &spec, &dir.0, Some(&cancel), |_, _| {});
        assert_eq!(result.unwrap_err(), "cancelled");
        assert!(!dir.0.join("fake.bin").exists());
        assert!(!dir.0.join("fake.bin.part").exists());
    }

    #[test]
    fn catalog_reports_installed_and_default() {
        let dir = TempDir::new("catalog");
        fs::create_dir_all(&dir.0).unwrap();
        fs::write(dir.0.join("ggml-tiny.en.bin"), b"placeholder").unwrap();

        let entries = catalog_json(&dir.0);
        assert_eq!(entries.len(), MODEL_CATALOG.len());
        let tiny = entries.iter().find(|e| e.id == "tiny_en").unwrap();
        assert!(tiny.is_default && tiny.installed);
        assert!(tiny.local_path.is_some());
        let small = entries.iter().find(|e| e.id == "small_en").unwrap();
        assert!(!small.is_default && !small.installed);
    }
}
