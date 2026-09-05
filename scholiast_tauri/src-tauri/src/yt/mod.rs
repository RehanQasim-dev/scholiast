//! Native `YouTube` stream extraction (specs/tauri-native-playback, task 01).
//!
//! First-party InnerTube client (`VISIONOS` — the only client whose adaptive
//! formats still carry URLs) + base.js sig/n deciphering + itag
//! classification. Ports the `NewPipe` / `youtubei.js` recipe; the exact request
//! shape was recorded live from youtubei.js v18 (see `client.rs`).
//!
//! Nothing here persists stream URLs (PRODUCT 9): manifests are resolved per
//! session and re-resolved on expiry.

pub mod client;
pub mod commands;
pub mod decipher;
pub mod error;
pub mod formats;
pub mod resolve;
