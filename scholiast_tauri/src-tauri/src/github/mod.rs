//! GitHub sync auth (Option A): user-token flow through the static bridge
//! page, refresh-token storage in the secret store, and an in-memory
//! access-token cache. A future sync engine consumes [`access_token`] and
//! [`repositories`], exactly like the Drive engine consumes its pair.

pub mod auth;

use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

use crate::secrets::{self, SecretName};

/// Errors across the IPC boundary, same envelope shape as DriveError so the
/// frontend unwraps both identically.
#[derive(Debug, Clone)]
pub enum GithubError {
    OauthNotConfigured(String),
    OauthInProgress,
    OauthDenied(String),
    Io(String),
    Http(String),
    InvalidInput(String),
    Internal(String),
}

impl GithubError {
    pub fn internal(message: impl Into<String>) -> Self {
        GithubError::Internal(message.into())
    }

    fn kind(&self) -> &'static str {
        match self {
            GithubError::OauthNotConfigured(_) => "oauth_not_configured",
            GithubError::OauthInProgress => "oauth_in_progress",
            GithubError::OauthDenied(_) => "oauth_denied",
            GithubError::Io(_) => "io",
            GithubError::Http(_) => "http",
            GithubError::InvalidInput(_) => "invalidInput",
            GithubError::Internal(_) => "internal",
        }
    }

    fn message(&self) -> &str {
        match self {
            GithubError::OauthNotConfigured(m)
            | GithubError::OauthDenied(m)
            | GithubError::Io(m)
            | GithubError::Http(m)
            | GithubError::InvalidInput(m)
            | GithubError::Internal(m) => m,
            GithubError::OauthInProgress => "a GitHub sign-in is already in progress",
        }
    }
}

impl fmt::Display for GithubError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind(), self.message())
    }
}

impl std::error::Error for GithubError {}

impl From<std::io::Error> for GithubError {
    fn from(err: std::io::Error) -> Self {
        GithubError::Io(err.to_string())
    }
}

impl From<crate::drive::DriveError> for GithubError {
    fn from(err: crate::drive::DriveError) -> Self {
        GithubError::Internal(err.to_string())
    }
}

impl From<reqwest::Error> for GithubError {
    fn from(err: reqwest::Error) -> Self {
        GithubError::Http(err.to_string())
    }
}

impl Serialize for GithubError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut outer = serializer.serialize_struct("GithubError", 2)?;
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

/// Authorization codes live ~10 minutes; a pending connect older than that is
/// dead and must not be completable.
const PENDING_TTL: Duration = Duration::from_secs(600);

/// Access tokens live 8 hours; refresh this far ahead so sync never observes
/// an expired one (the "stays connected" behavior).
const EXPIRY_SKEW: Duration = Duration::from_secs(300);

static CONNECTING: AtomicBool = AtomicBool::new(false);
static PENDING: Mutex<Option<PendingFlow>> = Mutex::new(None);
static ACCESS_CACHE: Mutex<Option<CachedAccess>> = Mutex::new(None);

struct PendingFlow {
    state: String,
    created_at: Instant,
}

struct CachedAccess {
    token: String,
    expires_at: Instant,
}

fn lock_pending() -> MutexGuard<'static, Option<PendingFlow>> {
    PENDING.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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

fn load_credentials() -> Result<auth::AppCredentials, GithubError> {
    let client_id = secrets::get_secret(SecretName::GithubClientId)?.unwrap_or_default();
    let client_secret = secrets::get_secret(SecretName::GithubClientSecret)?.unwrap_or_default();
    if client_id.trim().is_empty() || client_secret.trim().is_empty() {
        return Err(GithubError::OauthNotConfigured(
            "No GitHub App client configured. Enter the Client ID and Client secret in Settings → GitHub."
                .into(),
        ));
    }
    Ok(auth::AppCredentials {
        client_id: client_id.trim().to_string(),
        client_secret: client_secret.trim().to_string(),
    })
}

/// Returned by [`connect`]; the frontend opens `url` in the OS browser. The
/// bridge page forwards the code into `scholiast://oauth`, which the frontend
/// hands to [`complete`].
#[derive(Debug, Clone, Serialize)]
pub struct ConnectStart {
    pub url: String,
}

/// Begins the flow: stores the CSRF state and returns the authorize URL.
/// Returns immediately — the frontend calls [`complete`] when the deep link
/// lands (or reports denial).
pub async fn connect() -> Result<ConnectStart, GithubError> {
    if CONNECTING.swap(true, Ordering::SeqCst) {
        return Err(GithubError::OauthInProgress);
    }
    let outcome = start_flow();
    if outcome.is_err() {
        CONNECTING.store(false, Ordering::SeqCst);
    }
    outcome
}

fn start_flow() -> Result<ConnectStart, GithubError> {
    let creds = load_credentials()?;
    let state = crate::drive::auth::random_state();
    *lock_pending() = Some(PendingFlow {
        state: state.clone(),
        created_at: Instant::now(),
    });
    Ok(ConnectStart {
        url: auth::build_auth_url(&creds.client_id, &state),
    })
}

/// Completes the flow from the deep-link payload: validates `state`, exchanges
/// the code, persists the refresh token and returns the account login.
pub async fn complete(code: &str, state: &str) -> Result<auth::GithubAccount, GithubError> {
    let pending = lock_pending().take();
    CONNECTING.store(false, Ordering::SeqCst);
    let Some(pending) = pending else {
        return Err(GithubError::OauthDenied(
            "no GitHub sign-in is in progress (stale or duplicate callback)".into(),
        ));
    };
    if pending.created_at.elapsed() > PENDING_TTL {
        return Err(GithubError::OauthDenied(
            "GitHub sign-in expired — codes live ~10 minutes, try Connect again".into(),
        ));
    }
    if pending.state != state {
        return Err(GithubError::OauthDenied(
            "GitHub sign-in state mismatch — possible CSRF, try Connect again".into(),
        ));
    }
    if code.trim().is_empty() {
        return Err(GithubError::InvalidInput(
            "GitHub sign-in returned no code — copy it again from the browser page".into(),
        ));
    }
    let creds = load_credentials()?;
    let tokens = auth::exchange_code(auth::TOKEN_ENDPOINT, &creds, code.trim()).await?;
    let Some(refresh_token) = tokens.refresh_token.clone() else {
        return Err(GithubError::internal(
            "GitHub returned no refresh token — staying connected needs one",
        ));
    };
    secrets::set_secret(SecretName::GithubRefreshToken, &refresh_token)?;
    cache_access(tokens.access_token.clone(), tokens.expires_in);
    auth::get_account(auth::API_BASE, &tokens.access_token).await
}

/// Whether a refresh token is stored (i.e. GitHub is connected).
pub fn connected() -> Result<bool, GithubError> {
    Ok(secrets::get_secret(SecretName::GithubRefreshToken)?.is_some())
}

/// Drops the stored refresh token and any cached access token. Client ID and
/// secret stay so reconnecting is one click. Returns whether a token existed.
pub fn disconnect() -> Result<bool, GithubError> {
    let existed = secrets::delete_secret(SecretName::GithubRefreshToken)?;
    clear_access_cache();
    Ok(existed)
}

/// A valid access token, minting one from the stored refresh token when the
/// cache is empty or near expiry — and persisting GitHub's rotated refresh
/// token so the session survives indefinitely. Internal callers only.
pub async fn access_token() -> Result<String, GithubError> {
    if let Some(cached) = lock_cache().as_ref() {
        if cached.expires_at.duration_since(Instant::now()) > EXPIRY_SKEW {
            return Ok(cached.token.clone());
        }
    }
    let Some(refresh_token) = secrets::get_secret(SecretName::GithubRefreshToken)? else {
        return Err(GithubError::internal("GitHub is not connected"));
    };
    let creds = load_credentials()?;
    let tokens = auth::refresh_access(auth::TOKEN_ENDPOINT, &creds, &refresh_token).await?;
    if let Some(rotated) = tokens.refresh_token.clone() {
        secrets::set_secret(SecretName::GithubRefreshToken, &rotated)?;
    }
    cache_access(tokens.access_token.clone(), tokens.expires_in);
    Ok(tokens.access_token)
}

/// Every repository every installation of this App covers, deduplicated —
/// what the repo picker shows. Needs no arguments: owner and names come from
/// the API, never typed.
pub async fn repositories() -> Result<Vec<auth::Repo>, GithubError> {
    let token = access_token().await?;
    let installations = auth::list_installations(auth::API_BASE, &token).await?;
    let mut repos = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for installation in installations {
        for repo in
            auth::list_installation_repos(auth::API_BASE, &token, installation.id).await?
        {
            if seen.insert(repo.id) {
                repos.push(repo);
            }
        }
    }
    repos.sort_by(|a, b| a.full_name.cmp(&b.full_name));
    Ok(repos)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The tests below mutate the process-global pending flow; run them one
    /// at a time or they flake against each other.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[tokio::test]
    async fn stale_state_is_rejected_without_network() {
        let _guard = TEST_LOCK.lock().unwrap();
        *lock_pending() = Some(PendingFlow {
            state: "s".to_string(),
            created_at: Instant::now() - PENDING_TTL - Duration::from_secs(1),
        });
        CONNECTING.store(true, Ordering::SeqCst);
        let err = complete("code", "s").await.unwrap_err();
        assert!(
            err.to_string().contains("expired"),
            "unexpected error: {err}"
        );
        assert!(!CONNECTING.load(Ordering::SeqCst));
        assert!(lock_pending().is_none());
    }

    #[tokio::test]
    async fn state_mismatch_is_rejected_without_network() {
        let _guard = TEST_LOCK.lock().unwrap();
        *lock_pending() = Some(PendingFlow {
            state: "expected".to_string(),
            created_at: Instant::now(),
        });
        CONNECTING.store(true, Ordering::SeqCst);
        let err = complete("code", "forged").await.unwrap_err();
        assert!(
            err.to_string().contains("mismatch"),
            "unexpected error: {err}"
        );
        assert!(lock_pending().is_none());
    }

    #[tokio::test]
    async fn duplicate_callback_is_rejected_without_network() {
        let _guard = TEST_LOCK.lock().unwrap();
        *lock_pending() = None;
        CONNECTING.store(false, Ordering::SeqCst);
        let err = complete("code", "s").await.unwrap_err();
        assert!(
            err.to_string().contains("no GitHub sign-in"),
            "unexpected error: {err}"
        );
    }
}
