//! Secret storage for Scholiast (service `scholiast`).
//!
//! Desktop (not Android): OS keyring via the `keyring` crate. Android: no
//! keyring backend exists, so v1 stores values as 0600 files under
//! `<app_data>/secrets/` — app-private storage, NOT hardware-backed; see the
//! TODO in the android module for the Keystore follow-up.
//!
//! Values never cross back over IPC: commands expose existence status only
//! (plan §3.3). Internal callers use [`get_secret`] directly.

#[cfg(not(target_os = "android"))]
use keyring::Entry;

use crate::drive::DriveError;

#[cfg(not(target_os = "android"))]
pub const SERVICE: &str = "scholiast";

/// The named entries Scholiast keeps in the secret store.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretName {
    GroqApiKey,
    GeminiApiKey,
    GoogleRefreshToken,
    GithubClientId,
    GithubClientSecret,
    GithubRefreshToken,
}

impl SecretName {
    pub fn entry_id(self) -> &'static str {
        match self {
            SecretName::GroqApiKey => "groq.api_key",
            SecretName::GeminiApiKey => "gemini.api_key",
            SecretName::GoogleRefreshToken => "google.refresh_token",
            SecretName::GithubClientId => "github.client_id",
            SecretName::GithubClientSecret => "github.client_secret",
            SecretName::GithubRefreshToken => "github.refresh_token",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "groq" | "groq.api_key" => Some(SecretName::GroqApiKey),
            "gemini" | "gemini.api_key" => Some(SecretName::GeminiApiKey),
            "google" | "google.refresh_token" | "google_refresh_token" => {
                Some(SecretName::GoogleRefreshToken)
            }
            "github.client_id" | "github_client_id" => Some(SecretName::GithubClientId),
            "github.client_secret" | "github_client_secret" => {
                Some(SecretName::GithubClientSecret)
            }
            "github.refresh_token" | "github_refresh_token" | "github" => {
                Some(SecretName::GithubRefreshToken)
            }
            _ => None,
        }
    }
}

#[cfg(not(target_os = "android"))]
fn entry(name: SecretName) -> Result<Entry, DriveError> {
    Entry::new(SERVICE, name.entry_id())
        .map_err(|err| DriveError::internal(format!("keyring entry: {err}")))
}

#[cfg(target_os = "android")]
mod android {
    //! App-private file store (`<app_data>/secrets/<entry_id>`, mode 0600).
    //! TODO(security): back this with Android Keystore (e.g. an
    //! EncryptedSharedPreferences-style scheme via a small Kotlin plugin or a
    //! Rust Keystore crate) so values are hardware-protected at rest.

    use std::path::PathBuf;
    use std::sync::OnceLock;

    use super::{DriveError, SecretName};

    static SECRETS_DIR: OnceLock<PathBuf> = OnceLock::new();

    /// Seeds the store location from the app data dir resolved during setup
    /// (`lib.rs`). No-op after the first call.
    pub fn init_dir(data_dir: &std::path::Path) {
        let _ = SECRETS_DIR.set(data_dir.join("secrets"));
    }

    fn path(name: SecretName) -> Result<PathBuf, DriveError> {
        SECRETS_DIR
            .get()
            .map(|dir| dir.join(name.entry_id()))
            .ok_or_else(|| DriveError::internal("secrets dir not initialised"))
    }

    pub fn set(name: SecretName, value: &str) -> Result<(), DriveError> {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let path = path(name)?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)
                .map_err(|err| DriveError::internal(format!("secrets mkdir: {err}")))?;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
                .map_err(|err| DriveError::internal(format!("secrets chmod dir: {err}")))?;
        }
        let mut file = std::fs::File::create(&path)
            .map_err(|err| DriveError::internal(format!("secrets create {}: {err}", name.entry_id())))?;
        file.write_all(value.as_bytes())
            .map_err(|err| DriveError::internal(format!("secrets write {}: {err}", name.entry_id())))?;
        // Best-effort tighten; create happened 0644 by umask.
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        Ok(())
    }

    /// Returns the stored value, or `None` when no secret exists under `name`.
    pub fn get(name: SecretName) -> Result<Option<String>, DriveError> {
        match std::fs::read_to_string(path(name)?) {
            Ok(value) => Ok(Some(value)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(DriveError::internal(format!(
                "secrets read {}: {err}",
                name.entry_id()
            ))),
        }
    }

    /// Deletes the entry; returns whether anything existed.
    pub fn delete(name: SecretName) -> Result<bool, DriveError> {
        match std::fs::remove_file(path(name)?) {
            Ok(()) => Ok(true),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(err) => Err(DriveError::internal(format!(
                "secrets delete {}: {err}",
                name.entry_id()
            ))),
        }
    }
}

pub fn set_secret(name: SecretName, value: &str) -> Result<(), DriveError> {
    #[cfg(not(target_os = "android"))]
    {
        entry(name)?
            .set_password(value)
            .map_err(|err| DriveError::internal(format!("keyring set {}: {err}", name.entry_id())))
    }
    #[cfg(target_os = "android")]
    {
        android::set(name, value)
    }
}

/// Returns the stored value, or `None` when no secret exists under `name`.
pub fn get_secret(name: SecretName) -> Result<Option<String>, DriveError> {
    #[cfg(not(target_os = "android"))]
    {
        match entry(name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(DriveError::internal(format!(
                "keyring get {}: {err}",
                name.entry_id()
            ))),
        }
    }
    #[cfg(target_os = "android")]
    {
        android::get(name)
    }
}

/// Deletes the entry; returns whether anything existed.
pub fn delete_secret(name: SecretName) -> Result<bool, DriveError> {
    #[cfg(not(target_os = "android"))]
    {
        match entry(name)?.delete_credential() {
            Ok(()) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(err) => Err(DriveError::internal(format!(
                "keyring delete {}: {err}",
                name.entry_id()
            ))),
        }
    }
    #[cfg(target_os = "android")]
    {
        android::delete(name)
    }
}

/// Seeds the Android file-store location; called from app setup.
#[cfg(target_os = "android")]
pub fn init_store(data_dir: &std::path::Path) {
    android::init_dir(data_dir);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_ids_are_stable() {
        assert_eq!(SecretName::GroqApiKey.entry_id(), "groq.api_key");
        assert_eq!(SecretName::GeminiApiKey.entry_id(), "gemini.api_key");
        assert_eq!(SecretName::GoogleRefreshToken.entry_id(), "google.refresh_token");
        assert_eq!(SecretName::GithubClientId.entry_id(), "github.client_id");
        assert_eq!(SecretName::GithubClientSecret.entry_id(), "github.client_secret");
        assert_eq!(SecretName::GithubRefreshToken.entry_id(), "github.refresh_token");
    }

    #[test]
    fn parses_ipc_names() {
        assert_eq!(SecretName::parse("groq"), Some(SecretName::GroqApiKey));
        assert_eq!(SecretName::parse("gemini"), Some(SecretName::GeminiApiKey));
        assert_eq!(
            SecretName::parse("google"),
            Some(SecretName::GoogleRefreshToken)
        );
        assert_eq!(
            SecretName::parse("github.client_id"),
            Some(SecretName::GithubClientId)
        );
        assert_eq!(
            SecretName::parse("github.client_secret"),
            Some(SecretName::GithubClientSecret)
        );
        assert_eq!(
            SecretName::parse("github.refresh_token"),
            Some(SecretName::GithubRefreshToken)
        );
        assert!(SecretName::parse("nope").is_none());
    }

    #[cfg(target_os = "android")]
    #[test]
    fn android_file_store_roundtrips() {
        let tmp = tempfile::tempdir().unwrap();
        android::init_dir(tmp.path());
        assert_eq!(android::get(SecretName::GroqApiKey).unwrap(), None);
        android::set(SecretName::GroqApiKey, "sk-test").unwrap();
        assert_eq!(android::get(SecretName::GroqApiKey).unwrap().as_deref(), Some("sk-test"));
        assert!(android::delete(SecretName::GroqApiKey).unwrap());
        assert!(!android::delete(SecretName::GroqApiKey).unwrap());

        use std::os::unix::fs::PermissionsExt;
        android::set(SecretName::GroqApiKey, "sk-test").unwrap();
        let mode = std::fs::metadata(
            tmp.path().join("secrets").join(SecretName::GroqApiKey.entry_id()),
        )
        .unwrap()
        .permissions()
        .mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
