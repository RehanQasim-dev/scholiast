# Task 16 — Drive OAuth (PKCE) + Keystore token storage

Status: DONE

## Objective
Google Drive authentication for the app: manual OAuth with PKCE via a Custom Tab, token refresh, and secure token storage in the Android Keystore. No Play Services.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `domain/sync/drive/OAuthConfig.kt` — client id/secret, scopes (`https://www.googleapis.com/auth/drive.appdata`), redirect URI (custom scheme), PKCE helpers (S256 verifier/challenge)
- `domain/sync/drive/DriveOAuth.kt` — the auth flow: build URL → open Custom Tab → intercept redirect via an activity result/App Links intent filter → exchange code for tokens (POST /token) → refresh token renewal
- `domain/sync/drive/TokenStore.kt` — Android Keystore-backed storage (encrypted SharedPreferences or Keystore-encrypted bytes) for access + refresh tokens; `clear()` for disconnect
- `domain/sync/drive/DriveApi.kt` — minimal REST client: `GET/PUT/PATCH /drive/v3/files` (appdata folder, `spaces=appData`), `list`, `get`, `create`, `update` with `If-Match` revision CAS — enough for Task 17
- `domain/sync/drive/DriveOAuthTest.kt` — MockWebServer tests for token exchange/refresh, PKCE string generation

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.8.1 (OAuth flow steps), §2 (manual OAuth, Custom Tab, PKCE, no Play Services), §4.3 (Keystore for tokens), §9 M5
- Desktop source to adapt: `../src/utils/google-drive.ts` (REST calls, appdata layout, revision CAS) — the browser OAuth is replaced by Custom Tab PKCE, the REST client ports directly
- `../GOOGLE_DRIVE_SYNC.md` — the sync protocol this must interoperate with

## Requirements
- PKCE: verifier 128 bytes (URL-safe base64), S256 challenge; `code_challenge_method=S256`, `access_type=offline`, `prompt=consent`, redirect to the app's custom scheme (e.g. `scholiast://oauth2redirect`).
- Custom Tab: `CustomTabsIntent` with the auth URL; the redirect is caught by an intent-filter activity that forwards the `code` to the flow. Handle the app-process restart during the tab round-trip (persist the PKCE verifier + state in a temp pref keyed by `state`, cleared after).
- Token exchange + refresh via OkHttp POST to `https://oauth2.googleapis.com/token`; store access + refresh tokens in the Keystore-backed store; refresh silently before API calls when access token is near expiry.
- DriveApi: minimal set Task 17 needs — `listFiles(pageToken)`, `getFile(id)`, `createFile(meta, body)`, `updateFile(id, meta, body, ifMatchRevision)`, `deleteFile(id)`. Files API v3 with `supportsAllDrives=false`, `spaces=appData`.
- Errors: typed (401 → refresh+retry once, 403 scope/consent, 404, network) with a clear disconnect/retry surface.

## Acceptance criteria
- MockWebServer: token exchange parses tokens + expiry; refresh works; refresh-then-retry on 401.
- PKCE verifier/challenge are correct S256 (test against a known vector).
- Keystore store round-trips tokens on-device (instrumented test) and `clear()` wipes them.
- The Custom Tab → redirect → exchange flow documented in LOG.md with the exact redirect scheme and manifest entries needed (Task 01 owns the manifest — list the exact additions for them to apply).

## Agent notes
- You cannot test the full Custom Tab round-trip in CI — document the manual test steps; unit-test everything up to the tab launch.
- The OAuth client ids must come from settings/`oauth.local.json` convention — read `../oauth.local.example.json` and mirror the field names into `OAuthConfig` (never hardcode real secrets; the build must work with placeholder values).
- Write your log to `LOG.md` as you work.