# Task 16: Drive OAuth + Keyring

Status: DONE
Wave: 3
Depends on: task-02

## Scope & Owned Files
- `src-tauri/src/drive/auth.rs` — authorization-code + PKCE (S256) flow:
  - one-shot loopback listener `127.0.0.1:<ephemeral>`; auth URL with `drive.appdata` scope, `access_type=offline`, `prompt=consent`
  - open OS browser (`tauri-plugin-opener`); capture redirect code; exchange → refresh token
  - refresh flow `POST /token grant_type=refresh_token` with in-memory access-token cache + expiry guard
- Client id/secret injected at build via env/`oauth.local.json` (gitignored) — same Desktop OAuth client as the Firefox extension flow (see `../DISTRIBUTION.md` for registration notes)
- Keyring storage (`keyring` crate): service `scholiast`, entries `google.refresh_token`, `groq.api_key`, `gemini.api_key`; commands `set_secret/get_secret/delete_secret` (never return secret values to the frontend after set — booleans only)
- Commands: `drive_connect() -> url` (frontend opens), `drive_disconnect()`, `drive_status() -> {connected, email?}`
- Minimal connect UI hooks stubbed in Settings route (full settings screen is task-19)

## Acceptance Criteria
- Unit tests: PKCE verifier/challenge generation, state validation, token-refresh parsing against wiremock
- Manual gate logged: real connect round-trip stores refresh token in gnome-keyring

## Notes
Loopback redirect = installed-app classification; no wildcard origins involved.
