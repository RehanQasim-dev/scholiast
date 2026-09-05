//! Typed extraction failures (NewPipe `checkPlayabilityStatus` table).
//!
//! Every failure maps to a `ScholiastError` whose message names the cause,
//! so the player can show honest states (PRODUCT 6) and the fallback router
//! (task 03) can tell "retry with iframe" (cipher/network) apart from
//! "unplayable anywhere" (private/paid/drm).

use scholiast_core::error::ScholiastError;

/// What went wrong resolving a video. Variants mirror the playability
/// signals YouTube returns; see `resolve::check_playability`.
#[derive(Debug, Clone, PartialEq)]
pub enum YtError {
    Private,
    Paid,
    GeoBlocked,
    LoginRequired,
    BotGuard,
    Drm,
    /// Scheduled but not yet live: show the scheduled state, not an error.
    Upcoming,
    Unavailable(String),
    /// Cipher rotation or unknown player JS: retry via iframe fallback.
    Decipher(String),
    /// Formats resolved but none usable (unknown itags, empty lists).
    NoStreams,
    Network(String),
    Http(u16),
    Parse(String),
}

impl std::fmt::Display for YtError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            YtError::Private => write!(f, "this video is private"),
            YtError::Paid => write!(f, "this video needs a purchase or membership"),
            YtError::GeoBlocked => write!(f, "this video is blocked in your country"),
            YtError::LoginRequired => write!(f, "this video needs a YouTube login"),
            YtError::BotGuard => write!(f, "YouTube temporarily blocked anonymous access from this network"),
            YtError::Drm => write!(f, "this video is DRM-protected and cannot play here"),
            YtError::Upcoming => write!(f, "this stream hasn't started yet"),
            YtError::Unavailable(m) => write!(f, "video unavailable: {m}"),
            YtError::Decipher(m) => write!(f, "stream decipher failed: {m}"),
            YtError::NoStreams => write!(f, "no playable streams found"),
            YtError::Network(m) => write!(f, "youtube network error: {m}"),
            YtError::Http(s) => write!(f, "youtube HTTP {s}"),
            YtError::Parse(m) => write!(f, "youtube parse error: {m}"),
        }
    }
}

impl std::error::Error for YtError {}

impl From<YtError> for ScholiastError {
    fn from(err: YtError) -> Self {
        match err {
            YtError::Private => ScholiastError::NotFound("this video is private".into()),
            YtError::Upcoming => ScholiastError::NotFound("this stream hasn't started yet".into()),
            YtError::Unavailable(m) => ScholiastError::NotFound(m),
            YtError::Paid | YtError::GeoBlocked | YtError::LoginRequired | YtError::Drm => {
                ScholiastError::InvalidInput(err.to_string())
            }
            YtError::BotGuard => ScholiastError::FetchBlocked(429),
            YtError::Network(m) => ScholiastError::Network(m),
            YtError::Http(s) => ScholiastError::Internal(format!("youtube HTTP {s}")),
            YtError::Parse(m) => ScholiastError::InvalidInput(m),
            YtError::Decipher(_) | YtError::NoStreams => ScholiastError::Internal(err.to_string()),
        }
    }
}

/// True when the failure class can still play via the legacy iframe
/// (our bug or YouTube's rotation — not a content restriction).
/// Consumed by the task-03 fallback router; test-only until then.
#[cfg(test)]
pub fn is_fallback_worthy(err: &YtError) -> bool {
    matches!(
        err,
        YtError::Decipher(_) | YtError::NoStreams | YtError::Network(_) | YtError::Http(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_routing_splits_content_from_infra() {
        assert!(!is_fallback_worthy(&YtError::Private));
        assert!(!is_fallback_worthy(&YtError::Paid));
        assert!(!is_fallback_worthy(&YtError::GeoBlocked));
        assert!(!is_fallback_worthy(&YtError::Drm));
        assert!(!is_fallback_worthy(&YtError::Upcoming));
        assert!(is_fallback_worthy(&YtError::Decipher("rotated".into())));
        assert!(is_fallback_worthy(&YtError::NoStreams));
        assert!(is_fallback_worthy(&YtError::Network("dns".into())));
    }
}
