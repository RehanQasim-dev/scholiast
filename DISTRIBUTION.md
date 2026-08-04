# Distributing Scholiast (and getting Drive sync to work for other people)

The fork ships as **Scholiast** — its own name, icon and homepage, so it isn't
mistaken for the official Obsidian extension (which also matters for Google's
branding review). Site + logo: <https://rehanqasim-dev.github.io/clipper-oauth-redirect/>.

Everything here is free. No store fees are required for either browser.

## 1. What makes sync work for someone other than you

Google Drive sync uses the OAuth implicit flow through
`browser.identity.launchWebAuthFlow`. Google demands that the **redirect URI** be
registered in the OAuth client up front, and it allows no wildcards. That's the only
reason sync used to work on your machine alone:

| | redirect URL | stable across users? |
|---|---|---|
| Chrome / Edge / Brave | `https://<extension-id>.chromiumapp.org/` | **yes**, because `src/manifest.chrome.json` pins the id with a `key` field |
| Firefox | `https://<random-per-install-uuid>.extensions.allizom.org/` | **no** — different for every install |

So Firefox can never have its real redirect URI pre-registered. The fix is a static
**redirect bridge**: one page we host is registered as the redirect URI for
everybody, and it forwards Google's response to whichever extension URL started the
flow (the extension passes its own URL in the OAuth `state` parameter).

- Bridge page: <https://rehanqasim-dev.github.io/clipper-oauth-redirect/oauth.html>
- Source: <https://github.com/RehanQasim-dev/clipper-oauth-redirect>
- Configured in `src/utils/google-drive.ts` as `REDIRECT_BRIDGE`.

The bridge is static, stores nothing, and Google returns the token in the URL
*fragment*, which browsers never send to a server — only the page's own script (in
the user's browser) sees it. It refuses to forward anywhere except Chrome's
`*.chromiumapp.org` or Firefox's `*.extensions.allizom.org` / `moz-extension://`
formats, so it can't be used as an open redirect.

**Fixed ids for this fork:**

- Chrome extension id: `cgldpjhhpjhpcfbnnbgdkfmimkchihie`
- Firefox add-on id: `clipper-annotate@rehanqasim-dev.github.io`

## 2. One-time Google Cloud setup

In the project that owns the client id in `src/utils/google-drive.ts`:

1. **APIs & Services → Credentials →** your "Web application" OAuth client →
   **Authorized redirect URIs** → add exactly:
   `https://rehanqasim-dev.github.io/clipper-oauth-redirect/oauth.html`
   (You can drop the per-extension `chromiumapp.org` URI; the bridge replaces it.)
2. **APIs & Services → OAuth consent screen / Audience:** keep the app in
   **Testing**, and add each tester's Google account under **Test users**. To drop the
   test-user list entirely and let anyone connect, follow `GOOGLE_VERIFICATION.md` —
   every field is pre-filled there.
   - Up to 100 testers, instant, free, no review.
   - `drive.appdata` is a *sensitive* scope, so anyone **not** on that list gets the
     "Access blocked / app not verified" screen. This is the only reason your friends
     see it — nothing in the extension needs changing.
3. To remove the "unverified app" screen and the test-user list: submit for **OAuth
   verification** — see `GOOGLE_VERIFICATION.md` (homepage, privacy policy and logo are
   already published; what's left is the console form, domain verification and a demo
   video). Free; usually days, occasionally weeks.

Each tester only needs to be added once; they then sign in normally.

## 3. Chrome: hand out an unpacked build

```bash
npm install
npm run build:chrome     # → dist/
cd dist && zip -r ../clipper-chrome.zip .
```

Attach the zip to a GitHub release. Your friends:

1. Unzip it somewhere permanent (deleting the folder uninstalls the extension).
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick the
   folder.
3. Settings → Sync → **Connect Google Drive**.

Notes:

- Because the manifest pins `key`, everyone gets id `cgldpjhhpjhpcfbnnbgdkfmimkchihie`,
  so the one registered redirect URI covers them all. **Don't change or remove that
  `key`** — the id (and every local annotation stored under it) is derived from it.
- Chrome shows a "Disable developer mode extensions" warning bubble on each start
  and blocks side-loaded `.crx` files. Dismissing the bubble is harmless. The only
  way to remove it is a Chrome Web Store listing (one-time ~$5 developer fee) —
  deliberately skipped here.

## 4. Firefox: a signed .xpi from AMO (free)

Firefox refuses unsigned add-ons in release builds, but **unlisted** signing on
addons.mozilla.org is free and has no review queue.

```bash
npm run build:firefox    # → dist_firefox/
cd dist_firefox && zip -r ../clipper-firefox.zip .
```

1. <https://addons.mozilla.org/developers/> → **Submit a New Add-on** → **On your own**
   (unlisted) → upload the zip → download the signed `.xpi`.
2. Publish that `.xpi` on your GitHub release. Friends open it in Firefox and accept
   the install prompt.

Notes:

- The add-on id is now `clipper-annotate@rehanqasim-dev.github.io` (was the upstream
  `clipper@obsidian.md`, which AMO would reject since you don't own it). Firefox
  keys storage by id, so an install using the old id starts empty under the new one.
- For quick testing without signing, `about:debugging#/runtime/this-firefox` →
  **Load Temporary Add-on** works, but is wiped on restart.
- Firefox Developer Edition / Nightly can install unsigned builds with
  `xpinstall.signatures.required=false`; release Firefox cannot.

## 5. Data-migration warning when ids change

Extension storage is keyed by extension id, so a **Firefox** user who had data under
the old id sees an empty library after installing the new one. Before switching:
connect Drive on the old install and let it sync, or use **Settings → Data → Export**.
Chrome is unaffected (its id hasn't changed).
