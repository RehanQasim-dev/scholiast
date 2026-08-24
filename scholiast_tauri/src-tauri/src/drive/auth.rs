//! Authorization-code + PKCE (S256) flow for Google Drive.
//!
//! Mirrors the Firefox extension flow (`src/utils/google-drive.ts`): a Desktop
//! OAuth client whose redirect URI is an ephemeral `http://127.0.0.1:<port>`
//! served by a one-shot listener — the installed-app class, so no wildcard
//! origins are involved. Client values come from the environment or the
//! gitignored `oauth.local.json` at the repo root (never committed).

use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::DriveError;

pub const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
pub const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
pub const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";

/// The Google OAuth client used for the code+PKCE flow. `client_secret` is
/// present for Desktop clients; it is sent on token requests when available
/// (same as the extension).
#[derive(Debug, Clone)]
pub struct OAuthConfig {
    pub client_id: String,
    pub client_secret: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct ConfigFile {
    #[serde(rename = "nativeClientId", default)]
    native_client_id: String,
    #[serde(rename = "nativeClientSecret", default)]
    native_client_secret: String,
}

/// Resolves the OAuth client: `SCHOLIAST_GOOGLE_CLIENT_ID` env first, then the
/// extension's CI variable, then `oauth.local.json` found by walking up from
/// the working directory (dev runs from `src-tauri/`) or the executable.
pub fn load_oauth_config() -> Option<OAuthConfig> {
    fn env_nonempty(name: &str) -> Option<String> {
        std::env::var(name).ok().filter(|v| !v.trim().is_empty())
    }

    if let Some(client_id) = env_nonempty("SCHOLIAST_GOOGLE_CLIENT_ID")
        .or_else(|| env_nonempty("GOOGLE_OAUTH_NATIVE_CLIENT_ID"))
    {
        let client_secret = env_nonempty("SCHOLIAST_GOOGLE_CLIENT_SECRET")
            .or_else(|| env_nonempty("GOOGLE_OAUTH_NATIVE_CLIENT_SECRET"));
        return Some(OAuthConfig {
            client_id,
            client_secret,
        });
    }

    let contents = find_file_up("oauth.local.json")?;
    let file: ConfigFile = serde_json::from_str(&contents).ok()?;
    let client_id = file.native_client_id.trim().to_string();
    if client_id.is_empty() {
        return None;
    }
    let secret = file.native_client_secret.trim().to_string();
    Some(OAuthConfig {
        client_id,
        client_secret: (!secret.is_empty()).then_some(secret),
    })
}

fn find_file_up(name: &str) -> Option<String> {
    let mut roots = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        roots.push(exe);
    }
    for root in roots {
        let mut dir = Some(root);
        while let Some(path) = dir {
            let candidate = path.join(name);
            if candidate.is_file() {
                return std::fs::read_to_string(candidate).ok();
            }
            dir = path.parent().map(std::path::Path::to_path_buf);
        }
    }
    None
}

/// 64-char urlsafe random verifier: 48 bytes → exactly 64 base64url chars,
/// every char inside RFC 7636's unreserved set.
pub fn generate_verifier() -> String {
    let mut bytes = [0u8; 48];
    random_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// BASE64URL(SHA256(verifier)), no padding — RFC 7636 §4.2.
pub fn challenge_s256(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

/// Random `state` carried through the browser round-trip and checked on the
/// callback (CSRF guard).
pub fn random_state() -> String {
    let mut bytes = [0u8; 16];
    random_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn random_bytes(buf: &mut [u8]) {
    getrandom::fill(buf).expect("OS RNG unavailable");
}

fn percent_encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
                if let Some(byte) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    out.push(byte);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Builds the consent-page URL the frontend opens in the OS browser.
pub fn build_auth_url(
    config: &OAuthConfig,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> String {
    let pairs = [
        ("response_type", "code"),
        ("client_id", &config.client_id),
        ("redirect_uri", redirect_uri),
        ("scope", SCOPE),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("state", state),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
    ];
    let query = pairs
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                percent_encode_component(key),
                percent_encode_component(value)
            )
        })
        .collect::<Vec<_>>()
        .join("&");
    format!("{AUTH_ENDPOINT}?{query}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum CallbackOutcome {
    Code(String),
    Rejected,
    Denied(String),
}

/// Classifies an OAuth redirect query against the expected `state`.
fn evaluate_callback(query: &str, expected_state: &str) -> CallbackOutcome {
    let params = parse_query(query);
    if let Some(error) = params.iter().find(|(k, _)| k == "error").map(|(_, v)| v) {
        let detail = params
            .iter()
            .find(|(k, _)| k == "error_description")
            .map(|(_, v)| format!(" ({v})"))
            .unwrap_or_default();
        return CallbackOutcome::Denied(format!("{error}{detail}"));
    }
    let code = params.iter().find(|(k, _)| k == "code").map(|(_, v)| v);
    let state = params.iter().find(|(k, _)| k == "state").map(|(_, v)| v);
    match (code, state) {
        (Some(code), Some(state)) if constant_time_eq(state, expected_state) => {
            CallbackOutcome::Code(code.clone())
        }
        _ => CallbackOutcome::Rejected,
    }
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn parse_query(query: &str) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| match pair.split_once('=') {
            Some((key, value)) => (percent_decode(key), percent_decode(value)),
            None => (percent_decode(pair), String::new()),
        })
        .collect()
}

const SUCCESS_HTML: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Scholiast</title>\
<style>body{background:#000;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0}p{color:#9aa0a6}</style>\
</head><body><div style=\"text-align:center\"><h1>Scholiast</h1><p>Google Drive connected. You can close this tab.</p></div></body></html>";

const REJECT_HTML: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Scholiast</title></head>\
<body><p>Invalid OAuth callback.</p></body></html>";

const DENIED_HTML: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Scholiast</title></head>\
<body><p>Sign-in was cancelled. You can close this tab.</p></body></html>";

/// One-shot loopback listener for the OAuth redirect. Binds an ephemeral port
/// on 127.0.0.1, serves the success page once, then shuts down.
pub struct LoopbackServer {
    listener: TcpListener,
}

impl LoopbackServer {
    pub async fn bind() -> Result<Self, DriveError> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        Ok(Self { listener })
    }

    pub fn port(&self) -> u16 {
        self.listener.local_addr().expect("bound listener").port()
    }

    pub fn redirect_uri(&self) -> String {
        format!("http://127.0.0.1:{}", self.port())
    }

    /// Waits for the browser to come back. A mismatched state answers 400 and
    /// keeps waiting; only the matching callback resolves. A user denial
    /// (`error=` param) resolves as `oauth_denied`. Consumes the server so the
    /// listener drops (and the port closes) afterwards.
    pub async fn wait_for_code(
        self,
        expected_state: &str,
        timeout: Duration,
    ) -> Result<String, DriveError> {
        let deadline = tokio::time::Instant::now() + timeout;
        let listener = self.listener;
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err(DriveError::internal(
                    "timed out waiting for the OAuth redirect",
                ));
            }
            match tokio::time::timeout(remaining, listener.accept()).await {
                Ok(Ok((stream, _))) => match handle_connection(stream, expected_state).await? {
                    CallbackOutcome::Code(code) => return Ok(code),
                    CallbackOutcome::Denied(message) => {
                        return Err(DriveError::OauthDenied(message))
                    }
                    CallbackOutcome::Rejected => continue,
                },
                Ok(Err(err)) => return Err(DriveError::Io(err.to_string())),
                Err(_) => {
                    return Err(DriveError::internal(
                        "timed out waiting for the OAuth redirect",
                    ))
                }
            }
        }
    }
}

async fn handle_connection(mut stream: TcpStream, expected_state: &str) -> Result<CallbackOutcome, DriveError> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let read = match tokio::time::timeout(Duration::from_secs(5), stream.read(&mut chunk)).await
        {
            Ok(Ok(read)) => read,
            Ok(Err(err)) => return Err(DriveError::Io(err.to_string())),
            Err(_) => return Err(DriveError::internal("timed out reading OAuth callback request")),
        };
        if read > 0 {
            buf.extend_from_slice(&chunk[..read]);
        }
        if read == 0 || buf.windows(4).any(|window| window == b"\r\n\r\n") || buf.len() > 16 * 1024
        {
            break;
        }
    }
    let text = String::from_utf8_lossy(&buf);
    let request_line = text.lines().next().unwrap_or_default();
    let target = request_line.split_whitespace().nth(1).unwrap_or_default();
    let query = target.split_once('?').map(|(_, q)| q).unwrap_or_default();

    let outcome = evaluate_callback(query, expected_state);
    match &outcome {
        CallbackOutcome::Code(_) => write_html(&mut stream, "200 OK", SUCCESS_HTML).await?,
        CallbackOutcome::Rejected => write_html(&mut stream, "400 Bad Request", REJECT_HTML).await?,
        CallbackOutcome::Denied(_) => write_html(&mut stream, "200 OK", DENIED_HTML).await?,
    }
    Ok(outcome)
}

async fn write_html(stream: &mut TcpStream, status: &str, body: &str) -> Result<(), DriveError> {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct TokenSet {
    pub access_token: String,
    pub expires_in: u64,
    /// Absent on refresh responses — callers carry the stored token forward.
    pub refresh_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

/// Exchanges the authorization code for tokens (grant_type=authorization_code).
pub async fn exchange_code(
    token_endpoint: &str,
    config: &OAuthConfig,
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenSet, DriveError> {
    let mut form = vec![
        ("grant_type", "authorization_code".to_string()),
        ("code", code.to_string()),
        ("code_verifier", verifier.to_string()),
        ("redirect_uri", redirect_uri.to_string()),
        ("client_id", config.client_id.clone()),
    ];
    if let Some(secret) = &config.client_secret {
        form.push(("client_secret", secret.clone()));
    }
    token_request(token_endpoint, &form).await
}

/// Renews the access token (grant_type=refresh_token).
// Called by drive::access_token (task-17's sync engine path).
#[allow(dead_code)]
pub async fn refresh_access(
    token_endpoint: &str,
    config: &OAuthConfig,
    refresh_token: &str,
) -> Result<TokenSet, DriveError> {
    let mut form = vec![
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token.to_string()),
        ("client_id", config.client_id.clone()),
    ];
    if let Some(secret) = &config.client_secret {
        form.push(("client_secret", secret.clone()));
    }
    token_request(token_endpoint, &form).await
}

async fn token_request(
    token_endpoint: &str,
    form: &[(&str, String)],
) -> Result<TokenSet, DriveError> {
    let client = reqwest::Client::new();
    let response = client
        .post(token_endpoint)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(form_urlencoded(form))
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    let parsed: TokenResponse = serde_json::from_str(&body).map_err(|err| {
        DriveError::Http(format!("unparseable token response ({status}): {err}"))
    })?;
    if !status.is_success() || parsed.access_token.is_none() {
        let detail = parsed
            .error_description
            .map(|d| format!(" ({d})"))
            .unwrap_or_default();
        return Err(DriveError::Http(format!(
            "token request failed: {}{}",
            parsed.error.unwrap_or_else(|| status.to_string()),
            detail
        )));
    }
    Ok(TokenSet {
        access_token: parsed.access_token.expect("checked above"),
        expires_in: parsed.expires_in.unwrap_or(3600),
        refresh_token: parsed.refresh_token,
    })
}

fn form_urlencoded(form: &[(&str, String)]) -> String {
    form.iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                percent_encode_component(key),
                percent_encode_component(value)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const RFC7636_VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const RFC7636_CHALLENGE: &str = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    #[test]
    fn pkce_challenge_matches_rfc7636_known_answer() {
        assert_eq!(challenge_s256(RFC7636_VERIFIER), RFC7636_CHALLENGE);
    }

    #[test]
    fn verifier_is_64_urlsafe_unreserved_chars() {
        let verifier = generate_verifier();
        assert_eq!(verifier.len(), 64);
        assert!(verifier.bytes().all(|b| {
            b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~')
        }));
        // The challenge must be a valid base64url SHA-256 digest (32 bytes).
        let challenge = challenge_s256(&verifier);
        let decoded = URL_SAFE_NO_PAD.decode(&challenge).unwrap();
        assert_eq!(decoded.len(), 32);
    }

    #[test]
    fn generated_verifiers_are_unique() {
        assert_ne!(generate_verifier(), generate_verifier());
        assert_ne!(random_state(), random_state());
    }

    #[test]
    fn auth_url_carries_pkce_and_offline_params() {
        let config = OAuthConfig {
            client_id: "client.apps.googleusercontent.com".into(),
            client_secret: Some("secret".into()),
        };
        let url = build_auth_url(&config, "http://127.0.0.1:54321", "st-ate", "ch-allenge");
        assert!(url.starts_with(AUTH_ENDPOINT));
        for piece in [
            "response_type=code",
            "client_id=client.apps.googleusercontent.com",
            "redirect_uri=http%3A%2F%2F127.0.0.1%3A54321",
            &format!("scope={}", percent_encode_component(SCOPE)),
            "access_type=offline",
            "prompt=consent",
            "state=st-ate",
            "code_challenge=ch-allenge",
            "code_challenge_method=S256",
        ] {
            assert!(url.contains(piece), "missing {piece} in {url}");
        }
    }

    #[test]
    fn callback_classification() {
        assert_eq!(
            evaluate_callback("code=xyz&state=s1", "s1"),
            CallbackOutcome::Code("xyz".into())
        );
        assert_eq!(
            evaluate_callback("code=xyz&state=evil", "s1"),
            CallbackOutcome::Rejected
        );
        assert_eq!(evaluate_callback("code=xyz", "s1"), CallbackOutcome::Rejected);
        assert_eq!(
            evaluate_callback("error=access_denied&error_description=User%20cancelled", "s1"),
            CallbackOutcome::Denied("access_denied (User cancelled)".into())
        );
    }

    #[test]
    fn query_decoding_handles_percent_escapes() {
        assert_eq!(percent_decode("a%20b+c"), "a b c");
        assert_eq!(percent_decode("%2Fpath"), "/path");
        assert_eq!(percent_decode("trailing%2"), "trailing%2");
    }

    fn test_config() -> OAuthConfig {
        OAuthConfig {
            client_id: "test-client".into(),
            client_secret: Some("test-secret".into()),
        }
    }

    #[tokio::test]
    async fn exchange_posts_pkce_params_and_parses_tokens() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/token"))
            .and(body_string_contains("grant_type=authorization_code"))
            .and(body_string_contains("code=abc123"))
            .and(body_string_contains("code_verifier=my-verifier"))
            .and(body_string_contains(
                format!("redirect_uri=http%3A%2F%2F127.0.0.1%3A{}", u16::MAX).as_str(),
            ))
            .and(body_string_contains("client_id=test-client"))
            .and(body_string_contains("client_secret=test-secret"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "at-1",
                "expires_in": 3600,
                "refresh_token": "rt-1",
                "scope": SCOPE,
                "token_type": "Bearer"
            })))
            .expect(1)
            .mount(&server)
            .await;

        let tokens = exchange_code(
            &format!("{}/token", server.uri()),
            &test_config(),
            "abc123",
            "my-verifier",
            &format!("http://127.0.0.1:{}", u16::MAX),
        )
        .await
        .unwrap();

        assert_eq!(tokens.access_token, "at-1");
        assert_eq!(tokens.expires_in, 3600);
        assert_eq!(tokens.refresh_token.as_deref(), Some("rt-1"));
    }

    #[tokio::test]
    async fn exchange_surfaces_google_errors() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "error": "invalid_grant",
                "error_description": "Code was already redeemed."
            })))
            .mount(&server)
            .await;

        let err = exchange_code(
            &format!("{}/token", server.uri()),
            &test_config(),
            "used-code",
            "verifier",
            "http://127.0.0.1:1",
        )
        .await
        .unwrap_err();
        assert!(matches!(err, DriveError::Http(ref m) if m.contains("invalid_grant")));
    }

    #[tokio::test]
    async fn refresh_flow_posts_refresh_grant_and_carries_no_new_refresh_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(body_string_contains("grant_type=refresh_token"))
            .and(body_string_contains("refresh_token=stored-rt"))
            .and(body_string_contains("client_id=test-client"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "at-2",
                "expires_in": 1800,
                "token_type": "Bearer"
            })))
            .expect(1)
            .mount(&server)
            .await;

        let tokens = refresh_access(
            &format!("{}/token", server.uri()),
            &test_config(),
            "stored-rt",
        )
        .await
        .unwrap();

        assert_eq!(tokens.access_token, "at-2");
        assert_eq!(tokens.expires_in, 1800);
        // Refresh responses omit refresh_token; the caller keeps the stored one.
        assert_eq!(tokens.refresh_token, None);
    }

    #[tokio::test]
    async fn loopback_serves_success_page_and_returns_code() {
        let server = LoopbackServer::bind().await.unwrap();
        let port = server.port();
        let waiter = tokio::spawn(server.wait_for_code("st-ok", Duration::from_secs(10)));

        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream
            .write_all(b"GET /?code=c9&state=st-ok HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        assert!(response.contains("200 OK"));
        assert!(response.contains("Google Drive connected"));

        assert_eq!(waiter.await.unwrap().unwrap(), "c9");
    }

    #[tokio::test]
    async fn loopback_rejects_state_mismatch_then_accepts_real_callback() {
        let server = LoopbackServer::bind().await.unwrap();
        let port = server.port();
        let waiter = tokio::spawn(server.wait_for_code("st-real", Duration::from_secs(10)));

        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream
            .write_all(b"GET /?code=nope&state=st-forged HTTP/1.1\r\nHost: x\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        assert!(response.contains("400 Bad Request"));

        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream
            .write_all(b"GET /?code=yes&state=st-real HTTP/1.1\r\nHost: x\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        assert!(response.contains("200 OK"));

        assert_eq!(waiter.await.unwrap().unwrap(), "yes");
    }

    #[tokio::test]
    async fn loopback_reports_user_denial() {
        let server = LoopbackServer::bind().await.unwrap();
        let port = server.port();
        let waiter = tokio::spawn(server.wait_for_code("st-d", Duration::from_secs(10)));

        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream
            .write_all(b"GET /?error=access_denied&state=st-d HTTP/1.1\r\nHost: x\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();

        let err = waiter.await.unwrap().unwrap_err();
        assert!(matches!(err, DriveError::OauthDenied(ref m) if m.contains("access_denied")));
    }
}
