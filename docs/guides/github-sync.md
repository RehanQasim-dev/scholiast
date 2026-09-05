# GitHub Sync (Option A — GitHub App, least privilege)

App data syncs into a private repo the user picks. The GitHub App requests
only **Contents: read & write** on **selected repositories** — no
Administration, no webhooks, no private key on devices.

## App registration (owner, one time)

1. github.com → Settings → Developer settings → GitHub Apps → New.
2. Permissions → Repository → **Contents: Read & write**. Everything else off.
3. "Where can this GitHub App be installed?" → user accounts (orgs optional).
4. Callback URL → `https://rehanqasim-dev.github.io/scholiast-web/oauth.html`
   (loopback is NOT used; the static bridge page in `github-oauth-bridge/`
   forwards into the app and shows the code for the extension). Wildcard off.
5. Create the App, note **App ID** + **Client ID** (`Iv23…`), generate a
   **client secret** (shown once).

## Bridge page (owner, one time)

Publish `github-oauth-bridge/oauth.html` at the callback URL above
( именно that path — GitHub matches it). No server, no secrets in the page.

## User flow (no typing)

1. Create an empty **private** repo (e.g. `scholiast-sync`).
2. Install the App on the account, selecting **only that repo**. (Repos added
   later must also be added under Install → Configure → Repository access.)
3. Tauri app: Settings → Sync → GitHub → paste Client ID + secret (keyring),
   Connect → browser → authorize → app finishes itself, then pick the repo.
4. Extension: Settings → GitHub sync → same credentials → Connect opens the
   authorize tab → Copy on the bridge page → paste → Finish → pick the repo.

## Token lifecycle (stays connected)

User tokens live 8h; each refresh **rotates** the refresh token (6-month
sliding window). Both clients refresh proactively (~5 min skew) inside their
normal sync ticks and persist the rotated token, so the session survives
indefinitely. Reconnect is only needed after 6+ months of disuse, revocation,
or removing the installation.

## Troubleshooting

- `403` on repo calls → the repo isn't covered by the installation (step 2).
- `bad_verification_code` → codes are single-use, ~10 min; Connect again.
- `state mismatch` → a second Connect invalidated the first; finish the latest.
- `no GitHub sign-in is in progress` → stale/duplicate deep link; ignore it.
