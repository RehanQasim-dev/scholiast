//! Google Drive OAuth plumbing (task-16): PKCE authorization-code flow over a
//! one-shot loopback listener, refresh-token storage in the OS keyring, and an
//! in-memory access-token cache. The sync engine (task-17) consumes
//! [`access_token`].

pub mod auth;
pub mod rest;

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::secrets::{self, SecretName};

/// Errors surfaced across the IPC boundary by the drive module.
///
/// Same `{ ok: false, error: { kind, message } }` envelope shape as
/// [`scholiast_core::error::ScholiastError`] so the frontend unwraps both
/// identically. Lives here (not in crates/core) because `crates/*` belongs to
/// other tasks; `oauth_not_configured` is load-bearing — the Settings stub
/// keys its hint off this exact string.
#[derive(Debug, Clone)]
pub enum DriveError {
    OauthNotConfigured(String),
    OauthInProgress,
    OauthDenied(String),
    Io(String),
    Http(String),
    InvalidInput(String),
    Internal(String),
}

impl DriveError {
    pub fn internal(message: impl Into<String>) -> Self {
        DriveError::Internal(message.into())
    }

    fn kind(&self) -> &'static str {
        match self {
            DriveError::OauthNotConfigured(_) => "oauth_not_configured",
            DriveError::OauthInProgress => "oauth_in_progress",
            DriveError::OauthDenied(_) => "oauth_denied",
            DriveError::Io(_) => "io",
            DriveError::Http(_) => "http",
            DriveError::InvalidInput(_) => "invalidInput",
            DriveError::Internal(_) => "internal",
        }
    }

    fn message(&self) -> &str {
        match self {
            DriveError::OauthNotConfigured(m)
            | DriveError::OauthDenied(m)
            | DriveError::Io(m)
            | DriveError::Http(m)
            | DriveError::InvalidInput(m)
            | DriveError::Internal(m) => m,
            DriveError::OauthInProgress => "a Drive sign-in is already in progress",
        }
    }
}

impl fmt::Display for DriveError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind(), self.message())
    }
}

impl std::error::Error for DriveError {}

impl From<std::io::Error> for DriveError {
    fn from(err: std::io::Error) -> Self {
        DriveError::Io(err.to_string())
    }
}

impl From<reqwest::Error> for DriveError {
    fn from(err: reqwest::Error) -> Self {
        DriveError::Http(err.to_string())
    }
}

impl Serialize for DriveError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut outer = serializer.serialize_struct("DriveError", 2)?;
        outer.serialize_field("ok", &false)?;
        outer.serialize_field(
            "error",
            &ErrorBody {
                kind: self.kind(),
                message: self.message(),
            },
        )?;
        outer.end()
    }
}

/// How long the loopback listener waits for the browser round-trip before
/// giving up (Google authorization codes themselves live ~10 min).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(300);

/// Access tokens are considered stale this long before their real expiry.
const EXPIRY_SKEW: Duration = Duration::from_secs(60);

static CONNECTING: AtomicBool = AtomicBool::new(false);
static ACCESS_CACHE: Mutex<Option<CachedAccess>> = Mutex::new(None);

// Read only by access_token(), which the sync engine (task-17) calls.
#[allow(dead_code)]
struct CachedAccess {
    token: String,
    expires_at: Instant,
}

fn lock_cache() -> MutexGuard<'static, Option<CachedAccess>> {
    ACCESS_CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn cache_access(token: String, expires_in: u64) {
    *lock_cache() = Some(CachedAccess {
        token,
        expires_at: Instant::now() + Duration::from_secs(expires_in),
    });
}

fn clear_access_cache() {
    *lock_cache() = None;
}

/// Returned by [`connect`]; the frontend opens `url` in the OS browser via the
/// opener plugin. The listener is already bound to `port`.
#[derive(Debug, Clone, Serialize)]
pub struct ConnectStart {
    pub url: String,
    pub port: u16,
}

/// Begins the OAuth flow: binds the loopback listener, builds the consent URL
/// and spawns the code-exchange in the background. Returns immediately — the
/// frontend polls [`connected`] until the flow lands (or times out).
pub async fn connect() -> Result<ConnectStart, DriveError> {
    if CONNECTING.swap(true, Ordering::SeqCst) {
        return Err(DriveError::OauthInProgress);
    }
    match start_flow().await {
        Ok(start) => Ok(start),
        Err(err) => {
            CONNECTING.store(false, Ordering::SeqCst);
            Err(err)
        }
    }
}

async fn start_flow() -> Result<ConnectStart, DriveError> {
    let Some(config) = auth::load_oauth_config() else {
        return Err(DriveError::OauthNotConfigured(
            "No Google OAuth client configured. Set SCHOLIAST_GOOGLE_CLIENT_ID \
             (or add oauth.local.json at the repo root) — see DISTRIBUTION.md."
                .into(),
        ));
    };
    let server = auth::LoopbackServer::bind().await?;
    let port = server.port();
    let redirect_uri = server.redirect_uri();
    let state = auth::random_state();
    let verifier = auth::generate_verifier();
    let challenge = auth::challenge_s256(&verifier);
    let url = auth::build_auth_url(&config, &redirect_uri, &state, &challenge);

    tauri::async_runtime::spawn(async move {
        let outcome = finish_flow(server, config, state, verifier, redirect_uri).await;
        if let Err(err) = &outcome {
            eprintln!("[drive] oauth flow failed: {err}");
        }
        clear_connecting_flag();
    });
    Ok(ConnectStart { url, port })
}

async fn finish_flow(
    server: auth::LoopbackServer,
    config: auth::OAuthConfig,
    state: String,
    verifier: String,
    redirect_uri: String,
) -> Result<(), DriveError> {
    let code = server.wait_for_code(&state, CONNECT_TIMEOUT).await?;
    let tokens =
        auth::exchange_code(auth::TOKEN_ENDPOINT, &config, &code, &verifier, &redirect_uri)
            .await?;
    let Some(refresh_token) = tokens.refresh_token.clone() else {
        return Err(DriveError::internal(
            "Google returned no refresh token (offline access requires prompt=consent)",
        ));
    };
    secrets::set_secret(SecretName::GoogleRefreshToken, &refresh_token)?;
    cache_access(tokens.access_token, tokens.expires_in);
    Ok(())
}

fn clear_connecting_flag() {
    CONNECTING.store(false, Ordering::SeqCst);
}

/// Whether a refresh token is stored (i.e. Drive is connected).
pub fn connected() -> Result<bool, DriveError> {
    Ok(secrets::get_secret(SecretName::GoogleRefreshToken)?.is_some())
}

/// Drops the stored refresh token and any cached access token. Returns whether
/// a token actually existed.
pub fn disconnect() -> Result<bool, DriveError> {
    let existed = secrets::delete_secret(SecretName::GoogleRefreshToken)?;
    clear_access_cache();
    Ok(existed)
}

/// A valid access token, minting one from the stored refresh token when the
/// cache is empty or near expiry. Internal callers only — never serialized.
// Consumed by the sync engine (task-17).
#[allow(dead_code)]
pub async fn access_token() -> Result<String, DriveError> {
    if let Some(cached) = lock_cache().as_ref() {
        if cached.expires_at.duration_since(Instant::now()) > EXPIRY_SKEW {
            return Ok(cached.token.clone());
        }
    }
    let Some(refresh_token) = secrets::get_secret(SecretName::GoogleRefreshToken)? else {
        return Err(DriveError::internal("Drive is not connected"));
    };
    let Some(config) = auth::load_oauth_config() else {
        return Err(DriveError::OauthNotConfigured(
            "No Google OAuth client configured — see DISTRIBUTION.md.".into(),
        ));
    };
    let tokens = auth::refresh_access(auth::TOKEN_ENDPOINT, &config, &refresh_token).await?;
    cache_access(tokens.access_token.clone(), tokens.expires_in);
    Ok(tokens.access_token)
}

struct ErrorBody<'a> {
    kind: &'a str,
    message: &'a str,
}

impl Serialize for ErrorBody<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut body = serializer.serialize_struct("ErrorBody", 2)?;
        body.serialize_field("kind", self.kind)?;
        body.serialize_field("message", self.message)?;
        body.end()
    }
}
