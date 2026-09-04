### 3.5 Google Drive sync (per-page)
- Google OAuth via `browser.identity.launchWebAuthFlow`; connect/disconnect from settings.
- **Two flows, one per browser**, because Google and Firefox impose incompatible constraints: Google
  allows no wildcard redirect URIs and, for a sensitive scope, ties a URI's domain to an Authorized
  domain you own (excluding both `chromiumapp.org` and `extensions.allizom.org`), while Firefox rejects
  any `redirect_uri` outside its own redirect URL (`redirect_uri not allowed`). So:
  - **Chromium** — implicit grant against a "Web application" client, redirecting to a **hosted bridge**
    (`google-drive.REDIRECT_BRIDGE`): a static page in our own repo is the one registered URI, the
    extension passes its own redirect URL in the OAuth `state`, and the page forwards the response
    fragment there after checking it is a browser-owned extension URL. Renews silently via `prompt=none`.
  - **Firefox** — authorization code + **PKCE** against a "Desktop app" client, redirecting to
    `http://127.0.0.1/mozoauth2/<sha1(add-on id)>`, the form Mozilla whitelists precisely because Google
    won't take its default (bug 1635344); loopback needs no domain ownership. This yields a **refresh
    token**, so renewal is a plain `fetch` with no window — necessary because Firefox's silent
    `launchWebAuthFlow` path only follows server-side redirects and so can never renew via a window.
  - Both redirect URIs are stable for every user and install: extension ids are pinned (Chrome via the
    manifest `key`, Firefox via `browser_specific_settings.gecko.id`, which the Firefox hash derives
    from — it is *not* a per-install UUID). Treat the Firefox add-on id as frozen; changing it changes
    the redirect URI. `getRegisteredRedirectUri()` reports the right one per browser.
- Distribution steps, ids and the Google Cloud setup (two clients, same project) live in
  `DISTRIBUTION.md`; the verification submission (so any user can connect, not just listed testers) is
  pre-filled in `GOOGLE_VERIFICATION.md`.
- Syncs highlights + drawings + video (transcript items, notes, frame markup) **and Excalidraw comment
  diagrams** — **one Drive file per page** (`pages/page-<urlhash>.json`), with frame/diagram images and
  diagram scenes as separate blobs (see §2 "Sync state").
- **Per-page 3-way merge** (`shared/merge.mergePageRecord`): newest edit wins per item; comments from both
  devices are kept; deletions tracked as **per-page tombstones** so they don't resurrect. The merge is
  **never** over the whole dataset — always a single page at a time.
- **Push is targeted**: a change enqueues only the affected page URL(s) and reconciles just those files
  (a diagram edit is mapped to its page via `findPagesForDiagrams`, which reads the entry's `pageUrl`
  stamp and only falls back to scanning annotations for un-stamped ids). **Pull/full reconcile**:
  periodic + on startup + **"Sync now"** walks every local page and every remote `pages/` file (the file
  listing is the change-manifest), reconciling each independently. See `GOOGLE_DRIVE_SYNC.md`.
- **Unchanged pages are skipped without network** (`isPageInSync`): a page is only reconciled when the
  Drive file's `headRevisionId` differs from the one recorded in `pagemeta:<url>`, or the local record no
  longer matches its `snap:` (compared on an entity fingerprint that excludes tombstones, which the local
  side never rebuilds). Without this every poll downloaded and re-merged **every** page — O(library)
  network every 5 minutes, which at a few hundred pages never finishes inside the interval and leaves
  sync running permanently. The check is an optimisation only: anything missing or ambiguous reconciles.
- **Live progress in settings**: the engine writes its phase into the `sync_status` record as it goes
  (`progress: { phase, done, total, title, url }` — `discovering` while it works out which pages are in
  play, then one update per page). The Sync section renders it as a card under the status line: state +
  percentage on top, a bar, and the page being synced with a `done / total` count below (writes are
  rate-limited, so a large reconcile doesn't cost a storage write per page). The bar sweeps
  indeterminately during discovery, the card turns red with the message on failure, and it hides when
  idle. The settings page follows the run via a `storage.onChanged` listener, so no polling.
- The Obsidian companion plugin (§5) is the second client of this per-page Drive layout and uses the
  **same** `pages/page-<urlhash>.json` files (`shared/merge.pageFileName` gives both the identical name).

