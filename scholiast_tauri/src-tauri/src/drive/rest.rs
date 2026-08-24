//! Minimal Google Drive appdata REST client (task-17).
//!
//! Access tokens come from an injected [`TokenProvider`] — production wires
//! `drive::access_token`, tests wire a mock. A 401 triggers one forced
//! re-mint and exactly one retry (the extension's renew-once semantics).

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::Deserialize;

use super::DriveError;

/// Production Google API root; tests point this at a wiremock server.
pub const DRIVE_BASE_URL: &str = "https://www.googleapis.com";

/// Produces a bearer token. `force` asks the provider to skip any cache and
/// mint a fresh token (used after a 401). The boxed-future form keeps the
/// client object-nameable.
pub type TokenFuture = Pin<Box<dyn Future<Output = Result<String, DriveError>> + Send>>;
pub type TokenProvider = Arc<dyn Fn(bool) -> TokenFuture + Send + Sync>;

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct DriveFileMeta {
    pub id: String,
    pub name: String,
    #[serde(rename = "headRevisionId", default)]
    pub head_revision_id: Option<String>,
}

/// Result of a create/update: the file id plus its new head revision.
#[derive(Debug, Clone, PartialEq)]
pub struct UploadedFile {
    pub id: String,
    pub head_revision_id: Option<String>,
}

pub struct DriveRest {
    base_url: String,
    http: reqwest::Client,
    token_provider: TokenProvider,
}

impl DriveRest {
    pub fn new(base_url: &str, token_provider: TokenProvider) -> Self {
        DriveRest {
            base_url: base_url.to_string(),
            http: reqwest::Client::new(),
            token_provider,
        }
    }

    /// Sends a request built per-token; a 401 re-mints (forced) and retries
    /// exactly once before surfacing the failure.
    async fn send_authed<F>(&self, build_for: F) -> Result<reqwest::Response, DriveError>
    where
        F: Fn(&str) -> reqwest::RequestBuilder,
    {
        let token = (self.token_provider)(false).await?;
        let response = build_for(&token).send().await?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            let fresh = (self.token_provider)(true).await?;
            return Ok(build_for(&fresh).send().await?);
        }
        Ok(response)
    }

    async fn check(response: reqwest::Response) -> Result<reqwest::Response, DriveError> {
        let status = response.status();
        if status.is_success() {
            Ok(response)
        } else {
            let body = response.text().await.unwrap_or_default();
            Err(DriveError::Http(format!("drive HTTP {status}: {body}")))
        }
    }

    /// Lists appdata files whose name contains `prefix` (e.g. `pages/`),
    /// following pagination until exhausted.
    pub async fn list_files(&self, prefix: &str) -> Result<Vec<DriveFileMeta>, DriveError> {
        let mut out = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut url = format!(
                "{}/drive/v3/files?spaces=appDataFolder&pageSize=1000\
                 &fields=nextPageToken%2Cfiles(id%2Cname%2CheadRevisionId)\
                 &q={}",
                self.base_url,
                urlencode(&format!("name contains '{prefix}' and trashed=false")),
            );
            if let Some(token) = &page_token {
                url.push_str(&format!("&pageToken={token}"));
            }
            let response = self
                .send_authed(|tok| self.http.get(&url).bearer_auth(tok))
                .await?;
            let body: serde_json::Value =
                serde_json::from_str(&Self::check(response).await?.text().await?)
                    .map_err(|e| DriveError::Http(format!("unparseable files.list body: {e}")))?;
            if let Some(files) = body["files"].as_array() {
                for file in files {
                    out.push(serde_json::from_value(file.clone()).map_err(|e| {
                        DriveError::Http(format!("unparseable files.list entry: {e}"))
                    })?);
                }
            }
            page_token = body["nextPageToken"].as_str().map(str::to_string);
            if page_token.is_none() {
                return Ok(out);
            }
        }
    }

    pub async fn get_meta(&self, file_id: &str) -> Result<DriveFileMeta, DriveError> {
        let url = format!(
            "{}/drive/v3/files/{file_id}?fields=id,name,headRevisionId",
            self.base_url
        );
        let response = self
            .send_authed(|tok| self.http.get(&url).bearer_auth(tok))
            .await?;
        let body = Self::check(response).await?.text().await?;
        parse_json(&body)
    }

    /// Creates `pages/page-<hash>.json`-style files in appDataFolder via
    /// multipart/related upload; returns the new id + head revision.
    pub async fn upload_multipart(
        &self,
        name: &str,
        bytes: Vec<u8>,
        media_type: &str,
    ) -> Result<UploadedFile, DriveError> {
        let metadata = serde_json::json!({
            "name": name,
            "parents": ["appDataFolder"],
        });
        let url = format!(
            "{}/upload/drive/v3/files?uploadType=multipart&fields=id,headRevisionId",
            self.base_url
        );
        let boundary = "scholiast-sync-boundary";
        let body =
            multipart_related(boundary, &metadata.to_string(), media_type, &bytes);
        let response = self
            .send_authed(|tok| {
                self.http
                    .post(&url)
                    .bearer_auth(tok)
                    .header(
                        "Content-Type",
                        format!("multipart/related; boundary={boundary}"),
                    )
                    .body(body.clone())
            })
            .await?;
        let body = Self::check(response).await?.text().await?;
        let created: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| DriveError::Http(format!("unparseable upload response: {e}")))?;
        Ok(UploadedFile {
            id: created["id"]
                .as_str()
                .ok_or_else(|| DriveError::Http("upload response missing id".into()))?
                .to_string(),
            head_revision_id: created["headRevisionId"]
                .as_str()
                .map(str::to_string),
        })
    }

    /// Replaces a file's content (multipart PATCH). When `expected_head_revision`
    /// is given, the file's current revision is checked first and a mismatch
    /// aborts with a conflict error (optimistic CAS — Drive v3 has no If-Match).
    pub async fn update_multipart(
        &self,
        file_id: &str,
        bytes: Vec<u8>,
        media_type: &str,
        expected_head_revision: Option<&str>,
    ) -> Result<UploadedFile, DriveError> {
        if let Some(expected) = expected_head_revision {
            let current = self.get_meta(file_id).await?;
            if current.head_revision_id.as_deref() != Some(expected) {
                return Err(DriveError::Http(format!(
                    "head revision conflict for {file_id}: expected {expected}, found {}",
                    current.head_revision_id.unwrap_or_default()
                )));
            }
        }
        let metadata = serde_json::json!({});
        let url = format!(
            "{}/upload/drive/v3/files/{file_id}?uploadType=multipart&fields=id,headRevisionId",
            self.base_url
        );
        let boundary = "scholiast-sync-boundary";
        let body = multipart_related(boundary, &metadata.to_string(), media_type, &bytes);
        let response = self
            .send_authed(|tok| {
                self.http
                    .patch(&url)
                    .bearer_auth(tok)
                    .header(
                        "Content-Type",
                        format!("multipart/related; boundary={boundary}"),
                    )
                    .body(body.clone())
            })
            .await?;
        let body = Self::check(response).await?.text().await?;
        let updated: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| DriveError::Http(format!("unparseable update response: {e}")))?;
        Ok(UploadedFile {
            id: updated["id"]
                .as_str()
                .unwrap_or(file_id)
                .to_string(),
            head_revision_id: updated["headRevisionId"]
                .as_str()
                .map(str::to_string),
        })
    }

    /// Downloads a blob's raw bytes (`alt=media`).
    pub async fn download(&self, file_id: &str) -> Result<Vec<u8>, DriveError> {
        let url = format!("{}/drive/v3/files/{file_id}?alt=media", self.base_url);
        let response = self
            .send_authed(|tok| self.http.get(&url).bearer_auth(tok))
            .await?;
        Ok(Self::check(response).await?.bytes().await?.to_vec())
    }

    /// Wired into page-deletion flows by the task-18 scheduler/settings.
    #[allow(dead_code)]
    pub async fn delete_file(&self, file_id: &str) -> Result<(), DriveError> {
        let url = format!("{}/drive/v3/files/{file_id}", self.base_url);
        let response = self
            .send_authed(|tok| self.http.delete(&url).bearer_auth(tok))
            .await?;
        Self::check(response).await?;
        Ok(())
    }
}

fn urlencode(value: &str) -> String {
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

fn parse_json<T: serde::de::DeserializeOwned>(body: &str) -> Result<T, DriveError> {
    serde_json::from_str(body).map_err(|e| DriveError::Http(format!("unparseable JSON: {e}")))
}

fn multipart_related(
    boundary: &str,
    metadata_json: &str,
    media_type: &str,
    bytes: &[u8],
) -> Vec<u8> {    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{metadata_json}\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Type: {media_type}\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

// Provider used by the engine in production: mints from the stored refresh
// token (the force flag cannot bust drive's private cache — a revoked-but-
// unexpired token only recovers at natural expiry; logged in task-17 LOG.md).
pub fn production_provider() -> TokenProvider {
    Arc::new(|_force| Box::pin(super::access_token()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn counting_provider(tokens: Vec<String>) -> (TokenProvider, Arc<Mutex<Vec<bool>>>) {
        let calls: Arc<Mutex<Vec<bool>>> = Arc::new(Mutex::new(Vec::new()));
        let seen = calls.clone();
        let provider: TokenProvider = Arc::new(move |force| {
            seen.lock().unwrap().push(force);
            let token = tokens[seen.lock().unwrap().len() - 1].clone();
            Box::pin(async move { Ok(token) })
        });
        (provider, calls)
    }

    #[tokio::test]
    async fn list_files_queries_appdata_and_parses_revisions() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files"))
            .and(query_param("spaces", "appDataFolder"))
            .and(query_param(
                "q",
                "name contains 'pages/' and trashed=false",
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "files": [
                    {"id": "f1", "name": "pages/page-aaa.json", "headRevisionId": "11"},
                    {"id": "f2", "name": "frames/frame-x.jpg"}
                ]
            })))
            .mount(&server)
            .await;
        let (provider, _) = counting_provider(vec!["tok".into()]);
        let rest = DriveRest::new(&server.uri(), provider);

        let files = rest.list_files("pages/").await.unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].head_revision_id.as_deref(), Some("11"));
        assert_eq!(files[1].head_revision_id, None);
    }

    #[tokio::test]
    async fn upload_sends_related_parts_and_returns_ids() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/upload/drive/v3/files"))
            .and(header(
                "Content-Type",
                "multipart/related; boundary=scholiast-sync-boundary",
            ))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({"id": "new1", "headRevisionId": "7"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let (provider, _) = counting_provider(vec!["tok".into()]);
        let rest = DriveRest::new(&server.uri(), provider);

        let uploaded = rest
            .upload_multipart("pages/page-a.json", br#"{"version":2}"#.to_vec(), "application/json")
            .await
            .unwrap();
        assert_eq!(uploaded.id, "new1");
        assert_eq!(uploaded.head_revision_id.as_deref(), Some("7"));
    }

    #[tokio::test]
    async fn update_cas_aborts_on_stale_revision() {
        let server = MockServer::start().await;
        // GET meta reports a newer revision than the caller recorded.
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/f1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "f1", "name": "pages/page-a.json", "headRevisionId": "99"
            })))
            .expect(1)
            .mount(&server)
            .await;
        // The PATCH must never fire.
        Mock::given(method("PATCH"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;
        let (provider, _) = counting_provider(vec!["tok".into()]);
        let rest = DriveRest::new(&server.uri(), provider);

        let err = rest
            .update_multipart("f1", b"x".to_vec(), "application/json", Some("42"))
            .await
            .unwrap_err();
        assert!(matches!(err, DriveError::Http(ref m) if m.contains("conflict")));
    }

    #[tokio::test]
    async fn update_returns_new_head_revision() {
        let server = MockServer::start().await;
        Mock::given(method("PATCH"))
            .and(path("/upload/drive/v3/files/f1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "f1", "headRevisionId": "43"
            })))
            .mount(&server)
            .await;
        let (provider, _) = counting_provider(vec!["tok".into()]);
        let rest = DriveRest::new(&server.uri(), provider);

        let updated = rest
            .update_multipart("f1", b"bytes".to_vec(), "application/json", None)
            .await
            .unwrap();
        assert_eq!(updated.head_revision_id.as_deref(), Some("43"));
    }

    #[tokio::test]
    async fn download_streams_blob_bytes() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/blob1"))
            .and(query_param("alt", "media"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"\x89PNG-bytes".to_vec()))
            .mount(&server)
            .await;
        let (provider, _) = counting_provider(vec!["tok".into()]);
        let rest = DriveRest::new(&server.uri(), provider);

        assert_eq!(rest.download("blob1").await.unwrap(), b"\x89PNG-bytes");
    }

    #[tokio::test]
    async fn delete_removes_file() {
        let server = MockServer::start().await;
        Mock::given(method("DELETE"))
            .and(path("/drive/v3/files/gone"))
            .respond_with(ResponseTemplate::new(204))
            .expect(1)
            .mount(&server)
            .await;
        let (provider, _) = counting_provider(vec!["tok".into()]);
        let rest = DriveRest::new(&server.uri(), provider);
        rest.delete_file("gone").await.unwrap();
    }

    #[tokio::test]
    async fn unauthorized_forces_one_refresh_then_retries_once() {
        let server = MockServer::start().await;
        // Mounted first = lower priority: this expires after one hit, and the
        // success mock below takes over for the forced retry.
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/blob1"))
            .respond_with(ResponseTemplate::new(401))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/drive/v3/files/blob1"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"ok".to_vec()))
            .mount(&server)
            .await;
        let (provider, calls) = counting_provider(vec!["stale".into(), "fresh".into()]);
        let rest = DriveRest::new(&server.uri(), provider);

        let bytes = rest.download("blob1").await.unwrap();
        assert_eq!(bytes, b"ok");
        assert_eq!(*calls.lock().unwrap(), vec![false, true]);
    }

    #[tokio::test]
    async fn http_errors_surface_status_and_body() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(404).set_body_string("File not found: nope."),
            )
            .mount(&server)
            .await;
        let (provider, _) = counting_provider(vec!["tok".into()]);
        let rest = DriveRest::new(&server.uri(), provider);

        let err = rest.download("nope").await.unwrap_err();
        assert!(matches!(err, DriveError::Http(ref m) if m.contains("404") && m.contains("not found")));
    }
}
