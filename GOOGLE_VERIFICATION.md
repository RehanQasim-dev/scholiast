# Google OAuth verification — everything filled in

Goal: anyone can connect Drive sync without being added as a test user and without
seeing the "Google hasn't verified this app" screen. Free. Do it from the Google
account that owns the Cloud project (`rehanbhatti0317@gmail.com`).

The app is called **Marginalia**. Deliberately not "Obsidian Web Clipper": Google's
branding review flags apps whose name or logo suggests they belong to someone else,
and you don't own the Obsidian trademark. The homepage says it's a fork and links
upstream, which is the honest framing they want to see.

Assets are live and ready:

| Field in Google's form | Value |
|---|---|
| App name | `Marginalia` |
| User support email | `rehanbhatti0317@gmail.com` |
| Developer contact email | `rehanbhatti0317@gmail.com` |
| App logo (120×120 PNG) | `logo-120.png` in the site repo → [direct link](https://rehanqasim-dev.github.io/clipper-oauth-redirect/logo-120.png) |
| Application home page | `https://rehanqasim-dev.github.io/clipper-oauth-redirect/` |
| Application privacy policy | `https://rehanqasim-dev.github.io/clipper-oauth-redirect/privacy.html` |
| Terms of service | leave blank (optional) |
| Authorized domain | `rehanqasim-dev.github.io` |
| Authorized redirect URI | `https://rehanqasim-dev.github.io/clipper-oauth-redirect/oauth.html` |
| Scope requested | `https://www.googleapis.com/auth/drive.appdata` |

## Step 1 — register the redirect URI (do this first; sync needs it)

Cloud Console → **APIs & Services → Credentials** → your OAuth 2.0 Client ID (type
"Web application") → **Authorized redirect URIs** → **+ ADD URI** → paste the URI
above → **Save**. Allow a few minutes to propagate. Keep the old
`https://cgldpjhhpjhpcfbnnbgdkfmimkchihie.chromiumapp.org/` entry until you've
confirmed the bridge works, then delete it.

## Step 2 — branding

**APIs & Services → OAuth consent screen → Branding** (newer consoles: *Google Auth
Platform → Branding*). Fill in every row from the table above and save.

## Step 3 — verify the domain

The authorized domain must be one you've verified in
[Search Console](https://search.google.com/search-console) with the **same Google
account**, and verification happens at the **domain root**, not at a project path.

Your root site already exists and is live: `https://rehanqasim-dev.github.io/`
(repo `RehanQasim-dev/RehanQasim-dev.github.io`). So:

1. Search Console → **Add property → URL prefix** → `https://rehanqasim-dev.github.io/`
2. Pick the **HTML file** method, download `googleXXXXXXXXXXXX.html`.
3. Commit that file to the **root** of the `RehanQasim-dev.github.io` repo and push.
4. Confirm `https://rehanqasim-dev.github.io/googleXXXXXXXXXXXX.html` loads, then
   press **Verify**.
   (The HTML-tag method works too — the `<head>` of that repo's `index.html` has a
   placeholder comment marking the spot.)

⚠️ The one step that might not work: `github.io` is a shared public-suffix domain, and
Google sometimes refuses such subdomains as an *authorized domain* even once verified.
If it's rejected, the fallback is a cheap custom domain (~$10/yr) pointed at the same
Pages site, with the homepage/privacy URLs updated to match. Nothing else changes.

## Step 4 — scopes and justification

**Data access** (older consoles: *Scopes*) → add
`https://www.googleapis.com/auth/drive.appdata`. Justification — paste this:

> Marginalia is a browser extension that lets users annotate web pages (highlights,
> comments, freehand drawings). It stores those annotations as small JSON files and
> PNG images in Drive's hidden application-data folder, so a user's own annotations
> follow them between their browsers and machines. `drive.appdata` is the narrowest
> scope that permits this: the extension cannot list, read or modify any other file
> in the user's Drive, and the folder is invisible in the normal Drive UI. There is no
> backend — the user's browser talks directly to the Drive API, and the developer has
> no access to any user data. Sync is opt-in and can be disconnected, with in-app
> buttons to delete all local data and all Drive data.

## Step 5 — demo video

Unlisted YouTube link, 2–4 minutes, screen recording with the browser visible. Google
wants to see the consent screen and that the granted scope is used for what you say.
Shot list:

1. The extension in `chrome://extensions` (shows the name and id).
2. Settings → Sync → **Connect Google Drive**. Let the **OAuth consent screen** be
   clearly visible, including the URL bar with the client id. Grant access.
3. Annotate a page: highlight some text, add a comment.
4. **Sync now** — show the progress panel finishing.
5. Open a second browser/profile with the extension, connect the same account, and
   show the annotation arriving. (This is the "why we need the scope" moment.)
6. Show **Settings → Data → Delete all data on Google Drive** and **Sync →
   Disconnect**, so deletion/revocation is on record.

Narration or captions are fine; no voice-over is required.

## Step 6 — publish and submit

**Audience → Publish app** (moves Testing → In production), then
**Prepare for verification** and submit. Expect a few business days; a clarifying
email from the review team is normal.

Until it's approved, keep using **Testing** with test users — publishing early only
swaps the test-user list for an "unverified app" warning screen and a 100-user cap, so
there's nothing to gain by rushing it.

## What this does not require

- No Chrome Web Store listing and no $5 fee.
- No third-party security assessment — that's only for *restricted* scopes (full
  Drive access). `drive.appdata` is *sensitive*, one tier below.
- No changes to the extension code.
