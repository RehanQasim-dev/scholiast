//! OS keyring storage for Scholiast secrets (service `scholiast`).
//!
//! Values never cross back over IPC: commands expose existence status only
//! (plan §3.3). Internal callers use [`get_secret`] directly.

use keyring::Entry;

use crate::drive::DriveError;

pub const SERVICE: &str = "scholiast";

/// The named entries Scholiast keeps in the OS keyring.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretName {
    GroqApiKey,
    GeminiApiKey,
    GoogleRefreshToken,
}

impl SecretName {
    pub fn entry_id(self) -> &'static str {
        match self {
            SecretName::GroqApiKey => "groq.api_key",
            SecretName::GeminiApiKey => "gemini.api_key",
            SecretName::GoogleRefreshToken => "google.refresh_token",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "groq" | "groq.api_key" => Some(SecretName::GroqApiKey),
            "gemini" | "gemini.api_key" => Some(SecretName::GeminiApiKey),
            "google" | "google.refresh_token" | "google_refresh_token" => {
                Some(SecretName::GoogleRefreshToken)
            }
            _ => None,
        }
    }
}

fn entry(name: SecretName) -> Result<Entry, DriveError> {
    Entry::new(SERVICE, name.entry_id())
        .map_err(|err| DriveError::internal(format!("keyring entry: {err}")))
}

pub fn set_secret(name: SecretName, value: &str) -> Result<(), DriveError> {
    let entry = entry(name)?;
    entry
        .set_password(value)
        .map_err(|err| DriveError::internal(format!("keyring set {}: {err}", name.entry_id())))
}

/// Returns the stored value, or `None` when no secret exists under `name`.
pub fn get_secret(name: SecretName) -> Result<Option<String>, DriveError> {
    let entry = entry(name)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(DriveError::internal(format!(
            "keyring get {}: {err}",
            name.entry_id()
        ))),
    }
}

/// Deletes the entry; returns whether anything existed.
pub fn delete_secret(name: SecretName) -> Result<bool, DriveError> {
    let entry = entry(name)?;
    match entry.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(err) => Err(DriveError::internal(format!(
            "keyring delete {}: {err}",
            name.entry_id()
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_ids_are_stable() {
        assert_eq!(SecretName::GroqApiKey.entry_id(), "groq.api_key");
        assert_eq!(SecretName::GeminiApiKey.entry_id(), "gemini.api_key");
        assert_eq!(SecretName::GoogleRefreshToken.entry_id(), "google.refresh_token");
    }

    #[test]
    fn parses_ipc_names() {
        assert_eq!(SecretName::parse("groq"), Some(SecretName::GroqApiKey));
        assert_eq!(SecretName::parse("gemini"), Some(SecretName::GeminiApiKey));
        assert_eq!(
            SecretName::parse("google"),
            Some(SecretName::GoogleRefreshToken)
        );
        assert!(SecretName::parse("nope").is_none());
    }
}
