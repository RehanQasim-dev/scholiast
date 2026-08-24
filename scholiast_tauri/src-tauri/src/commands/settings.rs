//! Settings-screen helpers (task-19): prompt defaults + speech-provider pings.
//!
//! Pings are deliberately tiny inline clients: the real transcribers in `stt/`
//! need recorded audio, while these only prove a key exists and is accepted by
//! the provider's cheapest authenticated endpoint. Keys come from the OS
//! keyring through [`KeyringProvider`] and are never logged or returned.

use scholiast_core::error::{Reply, ScholiastError};
use serde::Serialize;

use crate::stt::cloud::{
    ADD_PROMPT_DEFAULT, EDIT_PROMPT_DEFAULT, KeyProvider, KeyringProvider, KEY_GEMINI, KEY_GROQ,
};

const GROQ_MODELS_URL: &str = "https://api.groq.com/openai/v1/models";
const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const PING_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

/// The plan §6.5.6 defaults, seeded into the prompts editor by the frontend.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptDefaults {
    pub add_comment: &'static str,
    pub edit_comment: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub detail: String,
}

#[tauri::command]
pub async fn get_prompt_defaults() -> Result<Reply<PromptDefaults>, ScholiastError> {
    Ok(Reply::new(PromptDefaults {
        add_comment: ADD_PROMPT_DEFAULT,
        edit_comment: EDIT_PROMPT_DEFAULT,
    }))
}

#[tauri::command]
pub async fn stt_test_groq() -> Result<Reply<TestResult>, ScholiastError> {
    let key = KeyringProvider.key(KEY_GROQ);
    Ok(Reply::new(ping(GROQ_MODELS_URL, key, HeaderKind::Bearer).await))
}

#[tauri::command]
pub async fn stt_test_gemini() -> Result<Reply<TestResult>, ScholiastError> {
    let key = KeyringProvider.key(KEY_GEMINI);
    Ok(Reply::new(
        ping(GEMINI_MODELS_URL, key, HeaderKind::GoogApiKey).await,
    ))
}

enum HeaderKind {
    Bearer,
    GoogApiKey,
}

async fn ping(url: &str, key: Option<String>, header: HeaderKind) -> TestResult {
    let Some(key) = key.filter(|k| !k.trim().is_empty()) else {
        return TestResult {
            ok: false,
            detail: "No key configured yet.".into(),
        };
    };
    let mut request = reqwest::Client::new()
        .get(url)
        .timeout(PING_TIMEOUT)
        .header("Accept", "application/json");
    request = match header {
        HeaderKind::Bearer => request.bearer_auth(key),
        HeaderKind::GoogApiKey => request.header("x-goog-api-key", key),
    };
    match request.send().await {
        Ok(response) => {
            let status = response.status();
            if status.is_success() {
                TestResult {
                    ok: true,
                    detail: "Key accepted.".into(),
                }
            } else {
                // Provider-agnostic: never name the vendor or echo the key.
                TestResult {
                    ok: false,
                    detail: format!("Rejected (HTTP {}).", status.as_u16()),
                }
            }
        }
        Err(err) => TestResult {
            ok: false,
            detail: format!("Network error: {err}"),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn ping_without_key_reports_missing_without_network() {
        let result = ping(GROQ_MODELS_URL, None, HeaderKind::Bearer).await;
        assert!(!result.ok);
        assert!(result.detail.contains("No key"));
    }

    #[tokio::test]
    async fn ping_blank_key_counts_as_missing() {
        let result = ping(GROQ_MODELS_URL, Some("   ".into()), HeaderKind::Bearer).await;
        assert!(!result.ok);
    }

    #[tokio::test]
    async fn ping_bad_host_is_network_failure_not_panic() {
        let result = ping(
            "http://127.0.0.1:9/nope",
            Some("k".into()),
            HeaderKind::Bearer,
        )
        .await;
        assert!(!result.ok);
        assert!(result.detail.contains("Network error"));
    }
}
