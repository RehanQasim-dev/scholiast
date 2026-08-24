use std::fmt;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// Errors surfaced across the IPC boundary and inside the Rust core.
///
/// Serialized as `{ ok: false, error: { kind, message } }` so a rejected
/// command keeps the same envelope shape as a resolved one (plan §3.3).
#[derive(Debug, Clone)]
pub enum ScholiastError {
    Db(String),
    NotFound(String),
    InvalidInput(String),
    Io(String),
    /// Reader capture (task 25): the request never completed — DNS failure,
    /// connection refused/reset, TLS or timeout.
    Network(String),
    /// Reader capture (task 25): the server answered but refused the fetch
    /// (paywall, anti-bot, missing page…) — carries the HTTP status code.
    FetchBlocked(u16),
    /// Reader capture (task 25): page fetched but no readable article could
    /// be extracted from it.
    NotReadable(String),
    Internal(String),
}

impl ScholiastError {
    pub fn kind(&self) -> &'static str {
        match self {
            ScholiastError::Db(_) => "db",
            ScholiastError::NotFound(_) => "notFound",
            ScholiastError::InvalidInput(_) => "invalidInput",
            ScholiastError::Io(_) => "io",
            ScholiastError::Network(_) => "network",
            ScholiastError::FetchBlocked(_) => "fetchBlocked",
            ScholiastError::NotReadable(_) => "notReadable",
            ScholiastError::Internal(_) => "internal",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            ScholiastError::Db(m)
            | ScholiastError::NotFound(m)
            | ScholiastError::InvalidInput(m)
            | ScholiastError::Io(m)
            | ScholiastError::Network(m)
            | ScholiastError::NotReadable(m)
            | ScholiastError::Internal(m) => m,
            // Static strings keep the wire shape `{ kind, message }` uniform
            // across variants; the frontend distinguishes blocked captures by
            // `kind`.
            ScholiastError::FetchBlocked(status) => match *status {
                401 => "HTTP 401 Unauthorized",
                403 => "HTTP 403 Forbidden",
                404 => "HTTP 404 Not Found",
                410 => "HTTP 410 Gone",
                429 => "HTTP 429 Too Many Requests",
                451 => "HTTP 451 Unavailable For Legal Reasons",
                500..=599 => "the server failed while fetching the page",
                _ => "the server refused the fetch",
            },
        }
    }
}

impl fmt::Display for ScholiastError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind(), self.message())
    }
}

impl std::error::Error for ScholiastError {}

impl Serialize for ScholiastError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut outer = serializer.serialize_struct("ScholiastError", 2)?;
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

/// Success half of the IPC envelope: `{ ok: true, data: T }`.
#[derive(Debug, Clone, Serialize)]
pub struct Reply<T> {
    pub ok: bool,
    pub data: T,
}

impl<T> Reply<T> {
    pub fn new(data: T) -> Self {
        Reply { ok: true, data }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn error_serializes_to_ipc_envelope() {
        let err = ScholiastError::NotFound("video x".into());
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            json!({"ok": false, "error": {"kind": "notFound", "message": "video x"}})
        );
    }

    #[test]
    fn reply_wraps_data() {
        assert_eq!(
            serde_json::to_value(Reply::new(3)).unwrap(),
            json!({"ok": true, "data": 3})
        );
    }

    #[test]
    fn reader_capture_variants_serialize_with_distinct_kinds() {
        let blocked = serde_json::to_value(ScholiastError::FetchBlocked(403)).unwrap();
        assert_eq!(blocked["error"]["kind"], json!("fetchBlocked"));
        assert_eq!(blocked["error"]["message"], json!("HTTP 403 Forbidden"));

        assert_eq!(
            serde_json::to_value(ScholiastError::Network("dns".into())).unwrap()["error"]["kind"],
            json!("network")
        );
        let unreadable =
            serde_json::to_value(ScholiastError::NotReadable("nav only".into())).unwrap();
        assert_eq!(unreadable["error"]["kind"], json!("notReadable"));
        assert_eq!(unreadable["ok"], json!(false));
    }
}
