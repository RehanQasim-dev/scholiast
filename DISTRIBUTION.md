# Distributing Scholiast (and getting Drive sync to work for other people)

The fork ships as **Scholiast** — its own name, icon and homepage, so it isn't
mistaken for the official Obsidian extension (which also matters for Google's
branding review). Site + logo: <https://rehanqasim-dev.github.io/scholiast-web/>.

Everything here is free. No store fees are required for either browser.

## 1. What makes sync work for someone other than you

Google Drive sync runs `browser.identity.launchWebAuthFlow`, and Google demands that
every **redirect URI** be registered in the OAuth client up front, with no wildcards.
Worse, for a sensitive scope Google ties a redirect URI's domain to an **Authorized
domain** you have proven you own in Search Console — which rules out *both* browsers'
built-in redirect hosts, since `chromiumapp.org` is Google's and
`extensions.allizom.org` is Mozilla's. And Firefox independently **refuses** any
`redirect_uri` that isn't under its own redirect URL, failing with
`redirect_uri not allowed` before a window even opens.

Those constraints are incompatible, so the two browsers use different flows:

| | flow / client type | redirect URI | renewal |
|---|---|---|---|
| Chrome / Edge / Brave | implicit, "Web application" client | the hosted bridge page (below) | `prompt=none` in a hidden tab |
| Firefox | authorization code + PKCE, "Desktop app" client | `http://127.0.0.1/mozoauth2/<sha1(add-on id)>` | refresh token, plain `fetch`, no window |

**Chromium — the redirect bridge.** One static page we host is registered for
everybody, and it forwards Google's response to whichever extension URL started the
flow (passed in the OAuth `state` parameter).

- Bridge page: <https://rehanqasim-dev.github.io/scholiast-web/oauth.html>
- Source: <https://github.com/RehanQasim-dev/scholiast-web>
- Configured in `src/utils/google-drive.ts` as `REDIRECT_BRIDGE` (not a secret, so it stays in the source).

The bridge is static, stores nothing, and Google returns the token in the URL
*fragment*, which browsers never send to a server — only the page's own script (in
the user's browser) sees it. It refuses to forward anywhere except a browser-owned
extension redirect URL, so it can't be used as an open redirect.

**Firefox — a loopback URI.** Mozilla whitelists `http://127.0.0.1/mozoauth2/<hash>`
in `launchWebAuthFlow` specifically because Google won't accept the
`extensions.allizom.org` URL it hands out (Mozilla bug 1635344). Loopback is exempt
from domain verification, since nobody owns `127.0.0.1`. Nothing listens on that
address — Firefox intercepts the navigation and hands the URL back. The hash is
`sha1(add-on id)`, so it is identical for every user and install; note this is *not* a
per-install UUID, contrary to a widespread myth. For this fork the exact URI is:

```
http://127.0.0.1/mozoauth2/b1cdafa9ace86cc892098074bbe7c2ed10db49d1
```

It is also logged at extension startup and shown in sync settings, so a future add-on
id change just means reading it off and registering the new one.

**Fixed ids for this fork:**

- Chrome extension id: `cgldpjhhpjhpcfbnnbgdkfmimkchihie`
- Firefox add-on id: `scholiast@rehanqasim-dev.github.io` — **treat as frozen.** It is
  an opaque string and never has to match the product name; changing it changes the
  Firefox redirect URI and breaks sync until the new one is registered.

## 2. One-time Google Cloud setup

In the project that owns the client ids in your `oauth.local.json` (gitignored; see
`oauth.local.example.json` — the values are injected at build time). Both clients
must live in the **same project**, so one consent screen and one verification covers
both browsers:

1. **APIs & Services → Credentials →** your "Web application" OAuth client →
   **Authorized redirect URIs** → add exactly:
   `https://rehanqasim-dev.github.io/scholiast-web/oauth.html`
   (You can drop the per-extension `chromiumapp.org` URI; the bridge replaces it.)
   Paste the client id into `GOOGLE_CLIENT_ID`.
1b. **+ CREATE CREDENTIALS → OAuth client ID → type "Desktop app"**, then paste the
   client id into `GOOGLE_NATIVE_CLIENT_ID`. **There is no redirect URI to
   configure** — desktop clients accept loopback redirects implicitly (Google: they
   "do not require the local redirect to be explicitly configured in the Cloud
   console"), so the console shows no *Authorized redirect URIs* field on this client
   and the port/path are accepted as sent. Also copy that client's **client secret**
   into `GOOGLE_NATIVE_CLIENT_SECRET`: Google's docs call it optional for installed
   apps, but the token endpoint rejects the exchange without it. Shipping it is
   expected for installed-app clients — Google states the flow "assumes that you
   cannot keep the client secret confidential", and PKCE is what actually secures the
   exchange.
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

- The add-on id is now `scholiast@rehanqasim-dev.github.io` (was `clipper-annotate@
  rehanqasim-dev.github.io`, and before that the upstream `clipper@obsidian.md`,
  which AMO would reject since you don't own it). Firefox keys storage by id, so an
  install using an older id starts empty under the new one.
- For quick testing without signing, `about:debugging#/runtime/this-firefox` →
  **Load Temporary Add-on** works, but is wiped on restart.
- Firefox Developer Edition / Nightly can install unsigned builds with
  `xpinstall.signatures.required=false`; release Firefox cannot.

## 5. Data-migration warning when ids change

Extension storage is keyed by extension id, so a **Firefox** user who had data under
the old id sees an empty library after installing the new one. Before switching:
connect Drive on the old install and let it sync, or use **Settings → Data → Export**.
Chrome is unaffected (its id hasn't changed).
