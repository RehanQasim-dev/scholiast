//! GitHub App user-token flow (Option A: Contents read/write, selected repos).
//!
//! Browser -> github.com authorize -> static bridge page ->
//! `scholiast://oauth?code=..&state=..` deep link. There is no loopback
//! listener: the bridge page (a static file on GitHub Pages) forwards the
//! query into the app, and the frontend hands the code to
//! `github_complete`, which validates `state` and exchanges it here.
//! Credentials live in the secret store (Settings), never baked in.

use serde::Deserialize;

use super::GithubError;

pub const AUTHORIZE_ENDPOINT: &str = "https://github.com/login/oauth/authorize";
pub const TOKEN_ENDPOINT: &str = "https://github.com/login/oauth/access_token";
pub const API_BASE: &str = "https://api.github.com";
pub const API_VERSION: &str = "2022-11-28";
/// Must match the Callback URL registered on the GitHub App. Loopback is not
/// used: any ephemeral port would mismatch a registered loopback callback, so
/// the static bridge page forwards into the app's deep-link scheme instead.
pub const BRIDGE_URL: &str = "https://rehanqasim-dev.github.io/scholiast-web/oauth.html";

/// The GitHub App OAuth client, user-supplied via Settings (never baked in).
#[derive(Debug, Clone)]
pub struct AppCredentials {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Debug, Clone)]
pub struct TokenSet {
    pub access_token: String,
    pub expires_in: u64,
    /// GitHub rotates refresh tokens: every refresh response carries a new
    /// one, which the caller must persist (unlike Drive, which carries over).
    pub refresh_token: Option<String>,
}

/// GitHub renders `expires_in` as a JSON string ("28800"), not a number.
fn u64_from_str_or_num<'de, D>(deserializer: D) -> Result<Option<u64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error as _;
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Number(n) => n
            .as_u64()
            .map(Some)
            .ok_or_else(|| D::Error::custom("expected a u64")),
        serde_json::Value::String(s) => s
            .parse::<u64>()
            .map(Some)
            .map_err(|_| D::Error::custom("expected a u64 or a string holding one")),
        _ => Err(D::Error::custom("expected a u64 or a string holding one")),
    }
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    #[serde(default, deserialize_with = "u64_from_str_or_num")]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
}

/// Builds the consent-page URL the frontend opens in the OS browser.
pub fn build_auth_url(client_id: &str, state: &str) -> String {
    format!(
        "{AUTHORIZE_ENDPOINT}?client_id={}&redirect_uri={}&state={}&allow_signup=false",
        percent_encode_component(client_id),
        percent_encode_component(BRIDGE_URL),
        percent_encode_component(state),
    )
}

/// Exchanges the authorization code for tokens (no PKCE on this flow).
pub async fn exchange_code(
    token_endpoint: &str,
    creds: &AppCredentials,
    code: &str,
) -> Result<TokenSet, GithubError> {
    let form = vec![
        ("client_id", creds.client_id.clone()),
        ("client_secret", creds.client_secret.clone()),
        ("code", code.to_string()),
        ("redirect_uri", BRIDGE_URL.to_string()),
    ];
    token_request(token_endpoint, &form).await
}

/// Renews the access token; persists the rotated refresh token when present.
pub async fn refresh_access(
    token_endpoint: &str,
    creds: &AppCredentials,
    refresh_token: &str,
) -> Result<TokenSet, GithubError> {
    let form = vec![
        ("client_id", creds.client_id.clone()),
        ("client_secret", creds.client_secret.clone()),
        ("grant_type", "refresh_token".to_string()),
        ("refresh_token", refresh_token.to_string()),
    ];
    token_request(token_endpoint, &form).await
}

async fn token_request(
    token_endpoint: &str,
    form: &[(&str, String)],
) -> Result<TokenSet, GithubError> {
    let client = reqwest::Client::new();
    let response = client
        .post(token_endpoint)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .body(form_urlencoded(form))
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    // GitHub answers some failures with 200 + an error body, so the token's
    // presence (not the status) decides success.
    let parsed: TokenResponse = serde_json::from_str(&body).map_err(|err| {
        GithubError::Http(format!("unparseable token response ({status}): {err}"))
    })?;
    let Some(access_token) = parsed.access_token else {
        let detail = parsed
            .error_description
            .map(|d| format!(" ({d})"))
            .unwrap_or_default();
        return Err(GithubError::Http(format!(
            "token request failed: {}{}",
            parsed.error.unwrap_or_else(|| status.to_string()),
            detail
        )));
    };
    Ok(TokenSet {
        access_token,
        expires_in: parsed.expires_in.unwrap_or(8 * 3600),
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct GithubAccount {
    pub login: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct Installation {
    pub id: i64,
    pub account_login: String,
    pub account_type: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct Repo {
    pub id: i64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
}

fn api_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("scholiast")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn api_error(status: reqwest::StatusCode, body: &str) -> GithubError {
    GithubError::Http(format!("github api {status}: {}", body.chars().take(200).collect::<String>()))
}

/// The authenticated user behind a user access token.
pub async fn get_account(
    api_base: &str,
    access_token: &str,
) -> Result<GithubAccount, GithubError> {
    let response = api_client()
        .get(format!("{api_base}/user"))
        .bearer_auth(access_token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    #[derive(Deserialize)]
    struct AccountResponse {
        login: String,
        #[serde(default)]
        avatar_url: Option<String>,
    }
    let parsed: AccountResponse = serde_json::from_str(&body)
        .map_err(|err| GithubError::Http(format!("unparseable /user response: {err}")))?;
    Ok(GithubAccount {
        login: parsed.login,
        avatar_url: parsed.avatar_url,
    })
}

/// Installations of this App visible to the user token.
pub async fn list_installations(
    api_base: &str,
    access_token: &str,
) -> Result<Vec<Installation>, GithubError> {
    let response = api_client()
        .get(format!("{api_base}/user/installations"))
        .bearer_auth(access_token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    #[derive(Deserialize)]
    struct InstallationsResponse {
        #[serde(default)]
        installations: Vec<InstallationResponse>,
    }
    #[derive(Deserialize)]
    struct InstallationResponse {
        id: i64,
        account: AccountRef,
    }
    #[derive(Deserialize)]
    struct AccountRef {
        login: String,
        #[serde(rename = "type")]
        kind: String,
    }
    let parsed: InstallationsResponse = serde_json::from_str(&body)
        .map_err(|err| GithubError::Http(format!("unparseable installations response: {err}")))?;
    Ok(parsed
        .installations
        .into_iter()
        .map(|i| Installation {
            id: i.id,
            account_login: i.account.login,
            account_type: i.account.kind,
        })
        .collect())
}

/// Repositories an installation covers (what a repo picker shows).
pub async fn list_installation_repos(
    api_base: &str,
    access_token: &str,
    installation_id: i64,
) -> Result<Vec<Repo>, GithubError> {
    let response = api_client()
        .get(format!(
            "{api_base}/user/installations/{installation_id}/repositories?per_page=100"
        ))
        .bearer_auth(access_token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", API_VERSION)
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(api_error(status, &body));
    }
    #[derive(Deserialize)]
    struct ReposResponse {
        #[serde(default)]
        repositories: Vec<RepoResponse>,
    }
    #[derive(Deserialize)]
    struct RepoResponse {
        id: i64,
        name: String,
        full_name: String,
        #[serde(default)]
        private: bool,
    }
    let parsed: ReposResponse = serde_json::from_str(&body)
        .map_err(|err| GithubError::Http(format!("unparseable repositories response: {err}")))?;
    Ok(parsed
        .repositories
        .into_iter()
        .map(|r| Repo {
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            private: r.private,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn creds() -> AppCredentials {
        AppCredentials {
            client_id: "Iv23test".to_string(),
            client_secret: "shh".to_string(),
        }
    }

    #[test]
    fn auth_url_points_at_bridge_with_state() {
        let url = build_auth_url("Iv23test", "s t+a/te");
        assert!(url.starts_with("https://github.com/login/oauth/authorize?"));
        assert!(url.contains("client_id=Iv23test"));
        assert!(url.contains("allow_signup=false"));
        assert!(url.contains("state=s%20t%2Ba%2Fte"));
        assert!(url.contains("redirect_uri=https%3A%2F%2Frehanqasim-dev.github.io"));
    }

    #[tokio::test]
    async fn exchange_parses_string_expiry_and_rotates_refresh() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/login/oauth/access_token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "ghu_new",
                "expires_in": "28800",
                "refresh_token": "ghr_rotated",
                "token_type": "bearer",
            })))
            .mount(&server)
            .await;
        let endpoint = format!("{}/login/oauth/access_token", server.uri());
        let set = refresh_access(&endpoint, &creds(), "ghr_old").await.unwrap();
        assert_eq!(set.access_token, "ghu_new");
        assert_eq!(set.expires_in, 28800);
        assert_eq!(set.refresh_token.as_deref(), Some("ghr_rotated"));
    }

    #[tokio::test]
    async fn exchange_rejects_error_body_on_200() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/login/oauth/access_token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "error": "bad_verification_code",
                "error_description": "The code passed is incorrect or expired.",
            })))
            .mount(&server)
            .await;
        let endpoint = format!("{}/login/oauth/access_token", server.uri());
        let err = exchange_code(&endpoint, &creds(), "stale").await.unwrap_err();
        assert!(err.to_string().contains("bad_verification_code"), "{err}");
    }

    #[tokio::test]
    async fn account_and_repos_parse() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/user"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "login": "RehanQasim-dev",
                "avatar_url": "https://avatars.example/u/1?v=4",
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/user/installations"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "total_count": 1,
                "installations": [{ "id": 99, "account": { "login": "RehanQasim-dev", "type": "User" } }],
            })))
            .mount(&server)
            .await;
        let account = get_account(&server.uri(), "tok").await.unwrap();
        assert_eq!(account.login, "RehanQasim-dev");
        let installs = list_installations(&server.uri(), "tok").await.unwrap();
        assert_eq!(
            installs,
            vec![Installation {
                id: 99,
                account_login: "RehanQasim-dev".to_string(),
                account_type: "User".to_string(),
            }]
        );
    }

    #[tokio::test]
    async fn repos_parse_with_private_flag() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "total_count": 1,
                "repositories": [{
                    "id": 7,
                    "name": "scholiast-sync",
                    "full_name": "RehanQasim-dev/scholiast-sync",
                    "private": true,
                }],
            })))
            .mount(&server)
            .await;
        let repos = list_installation_repos(&server.uri(), "tok", 99).await.unwrap();
        assert_eq!(
            repos,
            vec![Repo {
                id: 7,
                name: "scholiast-sync".to_string(),
                full_name: "RehanQasim-dev/scholiast-sync".to_string(),
                private: true,
            }]
        );
    }
}
