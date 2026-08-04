import browser from './browser-polyfill';

// Google Drive client for the annotation sync feature.
//
// Auth: two flows, because the browsers impose incompatible constraints. Both run
// through browser.identity.launchWebAuthFlow; neither uses chrome.identity
// .getAuthToken (Chrome-only and tied to a published extension id).
//
//   Chromium (Chrome/Edge/Brave) — OAuth 2.0 *implicit* grant against a "Web
//     application" client, redirecting to the hosted bridge page (REDIRECT_BRIDGE).
//     No refresh token exists, but Chromium re-mints silently with prompt=none in a
//     hidden tab, so that costs nothing here.
//
//   Firefox — authorization code + PKCE against a "Desktop app" client, redirecting
//     to http://127.0.0.1/mozoauth2/<sha1(extension id)>. This yields a refresh
//     token, so renewals are a plain fetch to the token endpoint with no window at
//     all. See the two constraints below for why nothing simpler works.
//
// Storage: a single JSON file `clipper-sync.json` lives in Drive's appDataFolder —
// a hidden, per-application folder. It never appears in the user's normal Drive UI
// and the extension can only ever see its own files (scope drive.appdata).
//
// Redirect URI, constraint 1 — Google requires every redirect URI to be registered
// in advance, permits no wildcards, and (for a sensitive scope like ours) ties the
// URI's domain to an Authorized domain you have proven you own in Search Console.
// That rules out both browsers' built-in redirect hosts: `chromiumapp.org` is
// Google's and `extensions.allizom.org` is Mozilla's. Hence the bridge page on our
// own domain for Chromium, and a loopback URI — exempt, since nobody owns
// 127.0.0.1 — for Firefox.
//
// Redirect URI, constraint 2 — Firefox's launchWebAuthFlow *rejects* any
// `redirect_uri` in the auth URL that isn't under its own redirect URL, failing with
// "redirect_uri not allowed" before any window opens. So Firefox cannot use the
// bridge, and Mozilla whitelists the loopback form above precisely because Google
// will not accept the `<sha1>.extensions.allizom.org` URL it hands out by default
// (Mozilla bug 1635344). Note the redirect URL is a hash of the *pinned* add-on id
// from manifest.firefox.json, so it is identical for every user and install —
// contrary to a persistent myth, it is not a per-install UUID.
//
// SETUP (one-time, by the maintainer): create a Google Cloud project, enable the
// Drive API, configure an OAuth consent screen (External; add testers under
// Audience → Test users), then create *two* OAuth clients in that same project so
// one consent screen and one verification covers both:
//   1. type "Web application", with the bridge URL below as an Authorized redirect
//      URI  → GOOGLE_CLIENT_ID
//   2. type "Desktop app", with the loopback URI as an Authorized redirect URI
//      → GOOGLE_NATIVE_CLIENT_ID
// The exact loopback URI to register is logged at startup and shown in sync
// settings; see DISTRIBUTION.md.

// The three values below are injected at build time from `oauth.local.json` (or the
// GOOGLE_OAUTH_* env vars) — see webpack.config.js and oauth.local.example.json. They
// are deliberately NOT in the repository: a client secret in a public repo gets
// scraped and revoked, and GitHub's push protection blocks it outright. A build
// without them compiles fine and simply reports sync as unconfigured.

// "Web application" OAuth client id — used by Chromium.
export const GOOGLE_CLIENT_ID = OAUTH_WEB_CLIENT_ID;

// "Desktop app" OAuth client id — used by Firefox.
export const GOOGLE_NATIVE_CLIENT_ID = OAUTH_NATIVE_CLIENT_ID;

// Google documents client_secret as *optional* for installed apps, but its token
// endpoint rejects the exchange without it (`invalid_request: client_secret is
// missing`), so it has to ship. This is expected for installed-app clients — Google's
// own docs say the flow "assumes that you cannot keep the client secret
// confidential". PKCE is what actually secures the exchange: the code_verifier is
// generated per flow and never leaves the extension, so a copied client id + secret
// cannot redeem an intercepted authorization code.
export const GOOGLE_NATIVE_CLIENT_SECRET = OAUTH_NATIVE_CLIENT_SECRET;

// The registered redirect URI for the Chromium flow: a static page that forwards the
// OAuth response fragment back to this extension's own redirect URL (passed in
// `state`). Set to '' to go direct to `<id>.chromiumapp.org` instead — only viable if
// you have registered that URI yourself.
export const REDIRECT_BRIDGE = 'https://rehanqasim-dev.github.io/scholiast-web/oauth.html';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const TOKEN_KEY = 'gdrive_token';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Per-page Drive layout (all inside the hidden appDataFolder):
//   pages/page-<urlhash>.json   one record per normalized URL
//   frames/frame-<itemId>.jpg   video frame image blobs
//   diagrams/diagram-<id>.png   Excalidraw comment-diagram image blobs
export type DriveFolder = 'pages' | 'frames' | 'diagrams';

interface CachedToken {
	accessToken: string;
	expiresAt: number; // epoch ms
	/** Firefox (code + PKCE) only — absent on the Chromium implicit flow. */
	refreshToken?: string;
}

export interface DriveFileMeta {
	id: string;
	name: string;
	modifiedTime?: string;
	headRevisionId?: string;
}

/** This browser's own extension redirect URL — where the flow ultimately lands. */
export function getRedirectUrl(): string {
	return browser.identity.getRedirectURL();
}

/**
 * Which flow this browser uses. Chromium's redirect URL is always
 * `https://<extension-id>.chromiumapp.org/`; everything else here means Firefox.
 */
function isChromiumFlow(): boolean {
	return getRedirectUrl().includes('.chromiumapp.org');
}

/**
 * Firefox's loopback redirect URI: `http://127.0.0.1/mozoauth2/<sha1(extension id)>`.
 * The hash is exactly the leading label of `getRedirectURL()`'s host, so we read it
 * from there rather than recomputing it. No port — Firefox compares its whitelisted
 * prefix literally, so adding one would break the match.
 */
function loopbackRedirectUri(): string {
	const host = new URL(getRedirectUrl()).hostname; // <sha1>.extensions.allizom.org
	return `http://127.0.0.1/mozoauth2/${host.split('.')[0]}`;
}

/**
 * The URI that must be registered in the Google OAuth client for *this* browser:
 * the bridge page for Chromium, the loopback URI for Firefox. Both are the same
 * string for every user, which is the whole point.
 */
export function getRegisteredRedirectUri(): string {
	if (!isChromiumFlow()) return loopbackRedirectUri();
	return REDIRECT_BRIDGE || getRedirectUrl();
}

function activeClientId(): string {
	return isChromiumFlow() ? GOOGLE_CLIENT_ID : GOOGLE_NATIVE_CLIENT_ID;
}

export function isConfigured(): boolean {
	return activeClientId().trim().length > 0;
}

// --- Auth --------------------------------------------------------------------

// base64url, so the extension redirect URL survives a round trip through `state`.
function encodeState(value: string): string {
	return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlBytes(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomUrlSafe(byteLength: number): string {
	return base64urlBytes(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** PKCE (RFC 7636) S256 pair: a high-entropy verifier and its SHA-256 challenge. */
async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
	const verifier = randomUrlSafe(48); // 64 chars — inside the 43–128 range
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return { verifier, challenge: base64urlBytes(new Uint8Array(digest)) };
}

async function saveToken(token: CachedToken): Promise<CachedToken> {
	await browser.storage.local.set({ [TOKEN_KEY]: token });
	return token;
}

function buildAuthUrl(interactive: boolean): string {
	const params = new URLSearchParams({
		client_id: GOOGLE_CLIENT_ID,
		response_type: 'token',
		redirect_uri: getRegisteredRedirectUri(),
		scope: SCOPE,
		// Silent renewals must not pop UI; the first/interactive grant asks for consent.
		prompt: interactive ? 'consent' : 'none',
		// The bridge reads this to know where to forward the response. Harmless (and
		// unused) when going direct.
		state: encodeState(getRedirectUrl()),
	});
	return `${AUTH_ENDPOINT}?${params.toString()}`;
}

function parseTokenFromRedirect(redirectUrl: string): CachedToken {
	// Implicit grant returns the token in the URL fragment:
	// https://<id>.chromiumapp.org/#access_token=...&expires_in=3600&token_type=Bearer
	const frag = redirectUrl.split('#')[1] || '';
	const params = new URLSearchParams(frag);
	const accessToken = params.get('access_token');
	const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
	const error = params.get('error');
	if (error) throw new Error(`OAuth error: ${error}`);
	if (!accessToken) throw new Error('No access token in OAuth response');
	// Refresh a minute early to avoid using a token that expires mid-request.
	return { accessToken, expiresAt: Date.now() + (expiresIn - 60) * 1000 };
}

async function launch(interactive: boolean): Promise<CachedToken> {
	const redirect = await browser.identity.launchWebAuthFlow({
		url: buildAuthUrl(interactive),
		interactive,
	});
	if (!redirect) throw new Error('OAuth flow returned no redirect');
	return saveToken(parseTokenFromRedirect(redirect));
}

// --- Firefox: authorization code + PKCE --------------------------------------

function buildNativeAuthUrl(challenge: string, state: string): string {
	const params = new URLSearchParams({
		client_id: GOOGLE_NATIVE_CLIENT_ID,
		response_type: 'code',
		redirect_uri: loopbackRedirectUri(),
		scope: SCOPE,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		// A refresh token is the whole point; `consent` guarantees one is issued even
		// on a re-grant (Google otherwise returns it only on the very first grant).
		access_type: 'offline',
		prompt: 'consent',
		state,
	});
	return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<CachedToken> {
	const form: Record<string, string> = { ...body, client_id: GOOGLE_NATIVE_CLIENT_ID };
	if (GOOGLE_NATIVE_CLIENT_SECRET) form.client_secret = GOOGLE_NATIVE_CLIENT_SECRET;
	const res = await fetch(TOKEN_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(form).toString(),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data.access_token) {
		const detail = data.error_description ? ` (${data.error_description})` : '';
		throw new Error(`OAuth token request failed: ${data.error || res.status}${detail}`);
	}
	return {
		accessToken: data.access_token,
		expiresAt: Date.now() + ((data.expires_in || 3600) - 60) * 1000,
		refreshToken: data.refresh_token,
	};
}

/** Full interactive grant: consent window, then exchange the code for tokens. */
async function launchNative(): Promise<CachedToken> {
	const { verifier, challenge } = await pkcePair();
	const state = randomUrlSafe(16);
	const redirect = await browser.identity.launchWebAuthFlow({
		url: buildNativeAuthUrl(challenge, state),
		interactive: true,
	});
	if (!redirect) throw new Error('OAuth flow returned no redirect');
	// The code flow answers in the query string, not the fragment.
	const params = new URL(redirect).searchParams;
	const error = params.get('error');
	if (error) throw new Error(`OAuth error: ${error}`);
	if (params.get('state') !== state) throw new Error('OAuth state mismatch');
	const code = params.get('code');
	if (!code) throw new Error('No authorization code in OAuth response');
	const token = await tokenRequest({
		grant_type: 'authorization_code',
		code,
		code_verifier: verifier,
		redirect_uri: loopbackRedirectUri(),
	});
	return saveToken(token);
}

/** Renew without any window — the reason Firefox uses this flow at all. */
async function refreshNative(refreshToken: string): Promise<CachedToken> {
	const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
	// A refresh response omits refresh_token, so carry the existing one forward.
	return saveToken({ ...token, refreshToken: token.refreshToken || refreshToken });
}

async function getCachedToken(): Promise<CachedToken | null> {
	const result = await browser.storage.local.get(TOKEN_KEY);
	return (result[TOKEN_KEY] as CachedToken) || null;
}

/**
 * Return a valid access token, minting/refreshing as needed.
 * @param interactive when true, may open a consent window; when false, fails if
 *   silent renewal isn't possible (used by background/auto syncs).
 */
export async function getAccessToken(interactive: boolean): Promise<string> {
	if (!isConfigured()) throw new Error('Google client id not configured');

	const cached = await getCachedToken();
	if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

	if (!isChromiumFlow()) {
		// Firefox: refresh over plain HTTP, no window. Firefox's silent
		// launchWebAuthFlow path only follows server-side redirects, so a
		// window-based renewal could never work here.
		if (cached?.refreshToken) {
			try {
				return (await refreshNative(cached.refreshToken)).accessToken;
			} catch (err) {
				// invalid_grant — revoked, or expired past recovery. Needs a new grant.
				await browser.storage.local.remove(TOKEN_KEY);
				if (!interactive) throw err;
			}
		}
		if (!interactive) throw new Error('Not connected to Google Drive');
		return (await launchNative()).accessToken;
	}

	// Chromium: no refresh token exists, but prompt=none renews in a hidden tab.
	try {
		const token = await launch(false);
		return token.accessToken;
	} catch (err) {
		if (!interactive) throw err;
	}
	// Interactive consent fallback.
	const token = await launch(true);
	return token.accessToken;
}

export async function isConnected(): Promise<boolean> {
	const cached = await getCachedToken();
	return !!(cached?.accessToken || cached?.refreshToken);
}

export async function disconnect(): Promise<void> {
	const cached = await getCachedToken();
	await browser.storage.local.remove(TOKEN_KEY);
	// Best-effort revoke so re-connecting prompts cleanly and Drive access is dropped.
	// Revoking a refresh token also invalidates the access tokens minted from it.
	const revokable = cached?.refreshToken || cached?.accessToken;
	if (revokable) {
		try {
			await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revokable)}`, { method: 'POST' });
		} catch {
			/* offline / already revoked — token is cleared locally regardless */
		}
	}
}

/** Force an interactive consent flow (used by the Connect button). */
export async function connect(): Promise<void> {
	if (!isChromiumFlow()) {
		await launchNative();
		return;
	}
	await launch(true);
}

// --- Drive REST --------------------------------------------------------------

async function driveFetch(url: string, init: RequestInit, interactive = false): Promise<Response> {
	let token = await getAccessToken(interactive);
	let res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
	if (res.status === 401) {
		// Token rejected (revoked / clock skew) — invalidate it and re-mint once.
		// Expire the access token rather than dropping the record, so Firefox's
		// refresh token survives and can renew without a consent window.
		const cached = await getCachedToken();
		if (cached?.refreshToken) await browser.storage.local.set({ [TOKEN_KEY]: { ...cached, expiresAt: 0 } });
		else await browser.storage.local.remove(TOKEN_KEY);
		token = await getAccessToken(interactive);
		res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
	}
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`Drive API ${res.status}: ${body.slice(0, 300)}`);
	}
	return res;
}

// --- Folders ------------------------------------------------------------------
// The three subfolders (pages/frames/diagrams) live directly under appDataFolder.
// Their ids are resolved once per session and cached; created on first use.

const folderIdCache = new Map<DriveFolder, string>();

async function ensureFolder(folder: DriveFolder, interactive: boolean): Promise<string> {
	const cached = folderIdCache.get(folder);
	if (cached) return cached;
	const params = new URLSearchParams({
		spaces: 'appDataFolder',
		q: `name='${folder}' and mimeType='${FOLDER_MIME}' and trashed=false`,
		fields: 'files(id,name)',
		pageSize: '1',
	});
	const res = await driveFetch(`${DRIVE_FILES}?${params.toString()}`, { method: 'GET' }, interactive);
	const data = await res.json();
	let id: string | undefined = data.files?.[0]?.id;
	if (!id) {
		const meta = { name: folder, mimeType: FOLDER_MIME, parents: ['appDataFolder'] };
		const cres = await driveFetch(
			`${DRIVE_FILES}?fields=id`,
			{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta) },
			interactive,
		);
		id = (await cres.json()).id as string;
	}
	folderIdCache.set(folder, id);
	return id;
}

// --- Per-page JSON files ------------------------------------------------------

/** List every file in a folder with the fields needed as a change manifest. */
export async function listFolder(folder: DriveFolder, interactive = false): Promise<DriveFileMeta[]> {
	const parent = await ensureFolder(folder, interactive);
	const out: DriveFileMeta[] = [];
	let pageToken: string | undefined;
	do {
		const params = new URLSearchParams({
			spaces: 'appDataFolder',
			q: `'${parent}' in parents and trashed=false`,
			fields: 'nextPageToken,files(id,name,modifiedTime,headRevisionId)',
			pageSize: '1000',
		});
		if (pageToken) params.set('pageToken', pageToken);
		const res = await driveFetch(`${DRIVE_FILES}?${params.toString()}`, { method: 'GET' }, interactive);
		const data = await res.json();
		for (const f of data.files || []) out.push(f as DriveFileMeta);
		pageToken = data.nextPageToken;
	} while (pageToken);
	return out;
}

/** Find a single file by exact name within a folder. */
export async function findInFolder(folder: DriveFolder, name: string, interactive = false): Promise<DriveFileMeta | null> {
	const parent = await ensureFolder(folder, interactive);
	const params = new URLSearchParams({
		spaces: 'appDataFolder',
		q: `'${parent}' in parents and name='${name}' and trashed=false`,
		fields: 'files(id,name,modifiedTime,headRevisionId)',
		pageSize: '1',
	});
	const res = await driveFetch(`${DRIVE_FILES}?${params.toString()}`, { method: 'GET' }, interactive);
	const data = await res.json();
	return data.files?.length ? (data.files[0] as DriveFileMeta) : null;
}

/** Create a JSON text file in a folder. */
export async function createTextFile(folder: DriveFolder, name: string, content: string, interactive = false): Promise<DriveFileMeta> {
	const parent = await ensureFolder(folder, interactive);
	const boundary = '-------obsidianclippertext';
	const metadata = { name, parents: [parent] };
	const body =
		`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
		`--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
		`--${boundary}--`;
	const res = await driveFetch(
		`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,modifiedTime,headRevisionId`,
		{ method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
		interactive,
	);
	return (await res.json()) as DriveFileMeta;
}

/** Overwrite a file's text content. Returns updated metadata. */
export async function updateTextFile(fileId: string, content: string, interactive = false): Promise<DriveFileMeta> {
	const res = await driveFetch(
		`${DRIVE_UPLOAD}/${fileId}?uploadType=media&fields=id,name,modifiedTime,headRevisionId`,
		{ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content },
		interactive,
	);
	return (await res.json()) as DriveFileMeta;
}

/** Download a text (JSON) file's content. */
export async function downloadDriveFile(fileId: string, interactive = false): Promise<string> {
	const res = await driveFetch(`${DRIVE_FILES}/${fileId}?alt=media`, { method: 'GET' }, interactive);
	return res.text();
}

// --- Binary image blobs (frames + diagrams) -----------------------------------
// Image bytes are kept as their own folder files rather than inlined into any
// JSON, so the (large) payloads never bloat the per-page records the 3-way merge
// parses/uploads. The sync engine stores each blob's Drive id in the metadata and
// lazily fetches images it lacks.

function base64ToBytes(base64: string): Uint8Array {
	const bin = atob(base64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

/** Upload a base64 (no data: prefix) blob into a folder. Returns its metadata. */
export async function uploadBlob(folder: DriveFolder, name: string, base64: string, mimeType: string, interactive = false): Promise<DriveFileMeta> {
	const parent = await ensureFolder(folder, interactive);
	const boundary = '-------obsidianclipperblob';
	const metadata = { name, parents: [parent] };
	const body =
		`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
		`--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64}\r\n` +
		`--${boundary}--`;
	const res = await driveFetch(
		`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name`,
		{ method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
		interactive,
	);
	return (await res.json()) as DriveFileMeta;
}

/** Replace an existing blob's bytes (e.g. an edited diagram). */
export async function updateBlob(fileId: string, base64: string, mimeType: string, interactive = false): Promise<DriveFileMeta> {
	const res = await driveFetch(
		`${DRIVE_UPLOAD}/${fileId}?uploadType=media&fields=id,name`,
		{ method: 'PATCH', headers: { 'Content-Type': mimeType }, body: base64ToBytes(base64) },
		interactive,
	);
	return (await res.json()) as DriveFileMeta;
}

/** Download a blob and return it as a `data:<mime>;base64,...` URL. */
export async function downloadBlob(fileId: string, interactive = false): Promise<string> {
	const res = await driveFetch(`${DRIVE_FILES}/${fileId}?alt=media`, { method: 'GET' }, interactive);
	const buf = await res.arrayBuffer();
	const bytes = new Uint8Array(buf);
	let binary = '';
	const chunk = 0x8000; // chunk to avoid call-stack limits on String.fromCharCode
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
	}
	const mime = res.headers.get('Content-Type') || 'image/jpeg';
	return `data:${mime};base64,${btoa(binary)}`;
}

/** Best-effort delete of an appDataFolder file (page record or orphaned blob). */
export async function deleteDriveFile(fileId: string, interactive = false): Promise<void> {
	await driveFetch(`${DRIVE_FILES}/${fileId}`, { method: 'DELETE' }, interactive);
}

/**
 * Delete EVERY file the extension owns in appDataFolder (the pages/frames/diagrams
 * folders — deleting a folder cascades to its children — plus any legacy root files
 * like `clipper-sync.json`). Returns how many top-level items were deleted. Runs
 * non-interactively (renews the token silently; never opens a consent window — a
 * delete must not block on UI), and clears the folder-id cache so a later sync
 * recreates the layout.
 */
export async function wipeAppData(interactive = false): Promise<number> {
	let count = 0;
	let pageToken: string | undefined;
	do {
		const params = new URLSearchParams({
			spaces: 'appDataFolder',
			// Only the direct children of appDataFolder — deleting a folder takes its
			// descendants with it, so this is a handful of calls, not one per file.
			q: `'appDataFolder' in parents and trashed=false`,
			fields: 'nextPageToken,files(id)',
			pageSize: '1000',
		});
		if (pageToken) params.set('pageToken', pageToken);
		const res = await driveFetch(`${DRIVE_FILES}?${params.toString()}`, { method: 'GET' }, interactive);
		const data = await res.json();
		for (const f of data.files || []) {
			try { await deleteDriveFile(f.id, interactive); count++; } catch { /* already gone */ }
		}
		pageToken = data.nextPageToken;
	} while (pageToken);
	folderIdCache.clear();
	return count;
}
