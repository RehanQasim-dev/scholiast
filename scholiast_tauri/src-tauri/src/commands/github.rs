//! GitHub connect commands. Secrets never travel back over this boundary:
//! the client ID/secret go in, status and listings come out.

use scholiast_core::error::Reply;

use crate::github::{self, GithubError};

#[derive(serde::Serialize)]
pub struct GithubStatus {
    pub connected: bool,
}

#[derive(serde::Serialize)]
pub struct GithubConnectStart {
    pub url: String,
}

#[tauri::command]
pub async fn github_connect() -> Result<Reply<GithubConnectStart>, GithubError> {
    let start = github::connect().await?;
    Ok(Reply::new(GithubConnectStart { url: start.url }))
}

#[tauri::command]
pub async fn github_complete(
    code: String,
    state: String,
) -> Result<Reply<github::auth::GithubAccount>, GithubError> {
    Ok(Reply::new(github::complete(&code, &state).await?))
}

#[tauri::command]
pub async fn github_disconnect() -> Result<Reply<bool>, GithubError> {
    Ok(Reply::new(github::disconnect()?))
}

#[tauri::command]
pub async fn github_status() -> Result<Reply<GithubStatus>, GithubError> {
    Ok(Reply::new(GithubStatus {
        connected: github::connected()?,
    }))
}

#[tauri::command]
pub async fn github_repos() -> Result<Reply<Vec<github::auth::Repo>>, GithubError> {
    Ok(Reply::new(github::repositories().await?))
}
