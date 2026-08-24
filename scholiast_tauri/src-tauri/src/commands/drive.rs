//! Drive OAuth + keyring commands (task-16).
//!
//! Secrets never travel back over this boundary: `get_secret_status` reports
//! existence only, and Drive state is a boolean.

use scholiast_core::error::Reply;

use crate::drive::{self, ConnectStart, DriveError};
use crate::secrets::{self, SecretName};

#[derive(serde::Serialize)]
pub struct DriveStatus {
    pub connected: bool,
}

#[derive(serde::Serialize)]
pub struct SecretStatus {
    pub configured: bool,
}

#[tauri::command]
pub async fn drive_connect() -> Result<Reply<ConnectStart>, DriveError> {
    Ok(Reply::new(drive::connect().await?))
}

#[tauri::command]
pub async fn drive_disconnect() -> Result<Reply<bool>, DriveError> {
    Ok(Reply::new(drive::disconnect()?))
}

#[tauri::command]
pub async fn drive_status() -> Result<Reply<DriveStatus>, DriveError> {
    Ok(Reply::new(DriveStatus {
        connected: drive::connected()?,
    }))
}

#[tauri::command]
pub async fn set_secret(name: String, value: String) -> Result<Reply<()>, DriveError> {
    let name = SecretName::parse(&name)
        .ok_or_else(|| DriveError::InvalidInput(format!("unknown secret {name:?}")))?;
    if value.is_empty() {
        return Err(DriveError::InvalidInput("secret value is empty".into()));
    }
    secrets::set_secret(name, &value)?;
    Ok(Reply::new(()))
}

/// Existence only — the value itself is never returned to the frontend.
#[tauri::command]
pub async fn get_secret_status(name: String) -> Result<Reply<SecretStatus>, DriveError> {
    let name = SecretName::parse(&name)
        .ok_or_else(|| DriveError::InvalidInput(format!("unknown secret {name:?}")))?;
    Ok(Reply::new(SecretStatus {
        configured: secrets::get_secret(name)?.is_some(),
    }))
}

#[tauri::command]
pub async fn delete_secret(name: String) -> Result<Reply<bool>, DriveError> {
    let name = SecretName::parse(&name)
        .ok_or_else(|| DriveError::InvalidInput(format!("unknown secret {name:?}")))?;
    Ok(Reply::new(secrets::delete_secret(name)?))
}
