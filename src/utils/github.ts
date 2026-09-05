import browser from './browser-polyfill';
import {
	buildGitHubAuthUrl,
	GITHUB_API_BASE,
	GITHUB_API_VERSION,
	GITHUB_BRIDGE_URL,
	GITHUB_TOKEN_URL,
	parseGitHubTokenBody,
	splitPastedCode,
	tokenLifetimeLeftSec,
	type GitHubTokenSet,
} from './github-app-auth';

// GitHub sync backend — user-chosen private repo (Option A: GitHub App with
// Contents read/write on selected repos). Mirrors the Drive layout inside
// that repo so both backends can be merged:
//
//   pages/page-<hash>.json   one record per normalized URL
//   frames/frame-<id>.jpg
//   diagrams/diagram-<id>.png + diagram-<id>.scene.json
//
// Auth: GitHub App user-token flow. The App's callback URL is the static
// bridge page; it forwards ?code=&state= into scholiast://oauth (Tauri app)
// and shows the code for copy-paste here (browser extension has no deep-link
// inbox). User tokens live 8h; the stored refresh token rotates on every
// refresh, so background refresh keeps the session effectively permanent.
// Client ID + secret are user-supplied in Settings (never baked into the
// build); the repo is discovered from the installation, never hardcoded.

export const GITHUB_CLIENT_ID_INJECTED: string = '';

const TOKEN_KEY = 'github_token';
const REPO_KEY = 'github_repo';
const CLIENT_KEY = 'github_client';
const PENDING_STATE_KEY = 'github_pending_state';
const REPO_BRANCH = 'main';

// Refresh this far ahead of expiry so sync never observes a dead token.
const REFRESH_SKEW_SEC = 300;

export type DriveFolder = 'pages' | 'frames' | 'diagrams';

export interface DriveFileMeta {
	id: string; // for GitHub: path `pages/page-...json` (used as fileId)
	name: string;
	modifiedTime?: string;
	headRevisionId?: string; // sha
	sha?: string;
	path?: string;
}

interface RepoInfo {
	owner: string;
	repo: string;
	branch: string;
}

export interface DiscoveredRepo {
	owner: string;
	repo: string;
	fullName: string;
	private: boolean;
}

export interface GitHubClientConfig {
	clientId: string;
	/** Presence only is ever read back; the value stays in storage. */
	hasSecret: boolean;
}

export function getRegisteredRedirectUri(): string {
	return GITHUB_BRIDGE_URL;
}

async function getClient(): Promise<{ clientId: string; clientSecret: string } | null> {
	const r = await browser.storage.local.get(CLIENT_KEY);
	const c = r[CLIENT_KEY] as { clientId?: string; clientSecret?: string } | undefined;
	if (!c || !c.clientId?.trim() || !c.clientSecret?.trim()) return null;
	return { clientId: c.clientId.trim(), clientSecret: c.clientSecret };
}

export async function saveClientConfig(clientId: string, clientSecret: string): Promise<void> {
	if (!clientId.trim() || !clientSecret.trim()) throw new Error('Client ID and secret are both required');
	await browser.storage.local.set({ [CLIENT_KEY]: { clientId: clientId.trim(), clientSecret: clientSecret.trim() } });
	configuredCache = true;
}

export async function getClientConfig(): Promise<GitHubClientConfig> {
	const c = await getClient();
	return { clientId: c?.clientId ?? '', hasSecret: !!c };
}

// Synchronous for existing callers (sync-engine polls, background guards):
// hydrated from storage at import, refreshed on every mutation and on
// storage events. Background awaits configLoaded() first where exactness
// matters (message responses).
let configuredCache: boolean | null = null;
let configLoad: Promise<void> | null = null;

export function configLoaded(): Promise<void> {
	if (!configLoad) {
		configLoad = browser.storage.local
			.get(CLIENT_KEY)
			.then((r) => {
				const c = r[CLIENT_KEY] as { clientId?: string; clientSecret?: string } | undefined;
				configuredCache = !!(c?.clientId?.trim() && c?.clientSecret?.trim());
			})
			.catch(() => {
				configuredCache = false;
			});
	}
	return configLoad;
}

void configLoaded();

try {
	browser.storage.onChanged.addListener((changes, area) => {
		if (area === 'local' && CLIENT_KEY in changes) {
			const c = changes[CLIENT_KEY].newValue as
				| { clientId?: string; clientSecret?: string }
				| undefined;
			configuredCache = !!(c?.clientId?.trim() && c?.clientSecret?.trim());
		}
	});
} catch {
	/* storage events unavailable in some contexts */
}

export function isConfigured(): boolean {
	return configuredCache ?? false;
}

export async function isConfiguredAsync(): Promise<boolean> {
	await configLoaded();
	return (await getClient()) !== null;
}

// --- token helpers -----------------------------------------------------------

function randomUrlSafe(n: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(n));
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface StoredToken {
	accessToken: string;
	expiresAt: number;
	refreshToken?: string;
}

async function saveToken(t: StoredToken): Promise<StoredToken> {
	await browser.storage.local.set({ [TOKEN_KEY]: t });
	return t;
}
async function getStoredToken(): Promise<StoredToken | null> {
	const r = await browser.storage.local.get(TOKEN_KEY);
	return (r[TOKEN_KEY] as StoredToken) || null;
}
async function getRepoInfo(): Promise<RepoInfo | null> {
	const r = await browser.storage.local.get(REPO_KEY);
	return (r[REPO_KEY] as RepoInfo) || null;
}
async function saveRepoInfo(info: RepoInfo): Promise<void> {
	await browser.storage.local.set({ [REPO_KEY]: info });
}

// --- GitHub App user-token flow ----------------------------------------------

async function tokenRequest(form: Record<string, string>): Promise<GitHubTokenSet> {
	const res = await fetch(GITHUB_TOKEN_URL, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(form).toString(),
	});
	const data = await res.json().catch(() => ({}));
	// GitHub answers some failures with HTTP 200 + an error body; the parser
	// decides on the token's presence, not the status.
	return parseGitHubTokenBody(data, Date.now());
}

async function refreshTokenNow(client: { clientId: string; clientSecret: string }, refreshToken: string): Promise<StoredToken> {
	const set = await tokenRequest({
		client_id: client.clientId,
		client_secret: client.clientSecret,
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
	});
	const stored: StoredToken = {
		accessToken: set.accessToken,
		expiresAt: set.expiresAt,
		...(set.refreshToken ? { refreshToken: set.refreshToken } : { refreshToken }),
	};
	return saveToken(stored);
}

/**
 * Step 1 of connect: stores a CSRF state and returns the authorize URL for
 * the settings page to open in a tab. The bridge page shows the code for
 * pasting (extension has no deep-link inbox).
 */
export async function beginConnect(): Promise<string> {
	const client = await getClient();
	if (!client) throw new Error('Enter the Client ID and secret first');
	const state = randomUrlSafe(16);
	await browser.storage.local.set({ [PENDING_STATE_KEY]: { state, at: Date.now() } });
	return buildGitHubAuthUrl(client.clientId, state);
}

/**
 * Step 2 of connect: exchanges a pasted bridge-page code. Accepts `<code>`
 * or `<code> <state>` (the page's Copy button copies both); a lone code
 * skips the state check.
 */
export async function completeConnect(pasted: string): Promise<{ login: string }> {
	const client = await getClient();
	if (!client) throw new Error('Enter the Client ID and secret first');
	const { code, state } = splitPastedCode(pasted);
	if (!code) throw new Error('Paste the code shown on the browser page');
	if (state) {
		const r = await browser.storage.local.get(PENDING_STATE_KEY);
		const pending = r[PENDING_STATE_KEY] as { state?: string; at?: number } | undefined;
		if (!pending?.state || pending.state !== state) throw new Error('Sign-in state mismatch — start Connect again');
		if (Date.now() - (pending.at ?? 0) > 10 * 60 * 1000) throw new Error('That code expired — start Connect again');
	}
	const set = await tokenRequest({
		client_id: client.clientId,
		client_secret: client.clientSecret,
		code,
		redirect_uri: GITHUB_BRIDGE_URL,
	});
	if (!set.refreshToken) throw new Error('GitHub returned no refresh token — staying connected needs one');
	await saveToken({ accessToken: set.accessToken, expiresAt: set.expiresAt, refreshToken: set.refreshToken });
	await browser.storage.local.remove(PENDING_STATE_KEY);
	const res = await githubFetch('/user', { method: 'GET' }, false);
	const user = (await res.json()) as { login: string };
	return { login: user.login };
}

export async function getAccessToken(interactive: boolean): Promise<string> {
	const client = await getClient();
	if (!client) throw new Error('GitHub not configured');
	const cached = await getStoredToken();
	if (cached?.accessToken) {
		if (tokenLifetimeLeftSec(cached, Date.now()) > REFRESH_SKEW_SEC) return cached.accessToken;
		if (cached.refreshToken) {
			try {
				return (await refreshTokenNow(client, cached.refreshToken)).accessToken;
			} catch {
				/* fall through to interactive */
			}
		}
	}
	if (!interactive) throw new Error('Not connected to GitHub');
	throw new Error('GitHub session expired — open Settings → GitHub sync and Connect again');
}

export async function isConnected(): Promise<boolean> {
	const c = await getStoredToken();
	return !!c?.accessToken;
}

export async function disconnect(): Promise<void> {
	await browser.storage.local.remove([TOKEN_KEY, REPO_KEY, PENDING_STATE_KEY]);
	// Client ID/secret stay so reconnecting is one click; tokens are dropped.
	// (GitHub App user tokens stay valid server-side until expiry — short-lived by design.)
}

// --- GitHub REST -------------------------------------------------------------

async function githubFetch(path: string, init: RequestInit, interactive = false): Promise<Response> {
	let token = await getAccessToken(interactive);
	let res = await fetch(`${GITHUB_API_BASE}${path}`, {
		...init,
		headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': GITHUB_API_VERSION },
	});
	if (res.status === 401) {
		await browser.storage.local.remove(TOKEN_KEY);
		throw new Error('GitHub session expired — open Settings → GitHub sync and Connect again');
	}
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`GitHub API ${res.status}: ${body.slice(0, 400)}`);
	}
	return res;
}

/**
 * Every repository every installation of this App covers — what the repo
 * picker shows. Owner and names come from the API, never typed.
 */
export async function listAvailableRepos(interactive: boolean): Promise<DiscoveredRepo[]> {
	const installsRes = await githubFetch('/user/installations', { method: 'GET' }, interactive);
	const installs = ((await installsRes.json()) as {
		installations?: Array<{ id: number }>;
	}).installations ?? [];
	const seen = new Set<number>();
	const out: DiscoveredRepo[] = [];
	for (const inst of installs) {
		const res = await githubFetch(
			`/user/installations/${inst.id}/repositories?per_page=100`,
			{ method: 'GET' },
			interactive,
		);
		const data = (await res.json()) as {
			repositories?: Array<{ id: number; name: string; full_name: string; private?: boolean; owner?: { login?: string } }>;
		};
		for (const r of data.repositories ?? []) {
			if (seen.has(r.id)) continue;
			seen.add(r.id);
			const owner = r.full_name.split('/')[0] || r.owner?.login || '';
			out.push({ owner, repo: r.name, fullName: r.full_name, private: !!r.private });
		}
	}
	out.sort((a, b) => a.fullName.localeCompare(b.fullName));
	return out;
}

export async function selectRepo(fullName: string): Promise<RepoInfo> {
	const [owner, ...rest] = fullName.split('/');
	const repo = rest.join('/');
	if (!owner || !repo) throw new Error('Pick a repository from the list');
	const info: RepoInfo = { owner, repo, branch: REPO_BRANCH };
	await saveRepoInfo(info);
	return info;
}

export async function ensureRepo(interactive: boolean): Promise<RepoInfo> {
	const info = await getRepoInfo();
	if (info?.owner && info?.repo) {
		// Verify the selection still exists and is still covered.
		try {
			await githubFetch(`/repos/${info.owner}/${info.repo}`, { method: 'GET' }, interactive);
			return { owner: info.owner, repo: info.repo, branch: info.branch || REPO_BRANCH };
		} catch (e: any) {
			if (!String(e?.message ?? e).includes('404')) throw e;
		}
	}
	throw new Error(
		'No sync repo selected — open Settings → GitHub sync, create an empty private repo, add it to the App installation, then pick it from the list.',
	);
}

async function repoPath(p: string): Promise<{ info: RepoInfo; apiPath: string }> {
	const info = await ensureRepo(false);
	return { info, apiPath: `/repos/${info.owner}/${info.repo}/contents/${p}` };
}

// --- Folder / file helpers ---------------------------------------------------

export async function listFolder(folder: DriveFolder, interactive = false): Promise<DriveFileMeta[]> {
	const { info, apiPath } = await repoPath(folder);
	try {
		const res = await githubFetch(`${apiPath}?ref=${info.branch}`, { method: 'GET' }, interactive);
		const data = await res.json();
		if (!Array.isArray(data)) return [];
		return data
			.filter((f: any) => f.type === 'file')
			.map((f: any) => ({ id: f.path, name: f.name, sha: f.sha, headRevisionId: f.sha, path: f.path, modifiedTime: undefined }));
	} catch (e: any) {
		if (String(e.message).includes('404')) return [];
		throw e;
	}
}

export async function findInFolder(folder: DriveFolder, name: string, interactive = false): Promise<DriveFileMeta | null> {
	const p = `${folder}/${name}`;
	const { info } = await repoPath(p);
	try {
		const res = await githubFetch(`/repos/${info.owner}/${info.repo}/contents/${p}?ref=${info.branch}`, { method: 'GET' }, interactive);
		const data = await res.json();
		if (data && data.sha) {
			return { id: data.path, name: data.name, sha: data.sha, headRevisionId: data.sha, path: data.path };
		}
		return null;
	} catch (e: any) {
		if (String(e.message).includes('404')) return null;
		throw e;
	}
}

export async function createTextFile(folder: DriveFolder, name: string, content: string, interactive = false): Promise<DriveFileMeta> {
	const p = `${folder}/${name}`;
	const { info } = await repoPath(p);
	const b64 = btoa(unescape(encodeURIComponent(content)));
	const res = await githubFetch(`/repos/${info.owner}/${info.repo}/contents/${p}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: `scholiast: add ${p}`, content: b64, branch: info.branch }),
	}, interactive);
	const data = await res.json();
	return { id: data.content.path, name: data.content.name, sha: data.content.sha, headRevisionId: data.content.sha, path: data.content.path };
}

export async function updateTextFile(fileId: string, content: string, interactive = false): Promise<DriveFileMeta> {
	// fileId is path for GitHub
	const p = fileId;
	const { info } = await repoPath(p);
	// Need sha
	const meta = await findInFolder(p.split('/')[0] as DriveFolder, p.split('/').slice(1).join('/'), interactive);
	if (!meta?.sha) throw new Error(`GitHub file not found for update: ${p}`);
	const b64 = btoa(unescape(encodeURIComponent(content)));
	const res = await githubFetch(`/repos/${info.owner}/${info.repo}/contents/${p}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: `scholiast: update ${p}`, content: b64, sha: meta.sha, branch: info.branch }),
	}, interactive);
	const data = await res.json();
	return { id: data.content.path, name: data.content.name, sha: data.content.sha, headRevisionId: data.content.sha, path: data.content.path };
}

export async function downloadDriveFile(fileId: string, interactive = false): Promise<string> {
	const p = fileId;
	const { info } = await repoPath(p);
	const res = await githubFetch(`/repos/${info.owner}/${info.repo}/contents/${p}?ref=${info.branch}`, {
		method: 'GET', headers: { Accept: 'application/vnd.github.v3.raw' }
	}, interactive);
	// raw returns text directly
	if (res.headers.get('Content-Type')?.includes('application/json')) {
		const data = await res.json();
		if (data.content) {
			const b64 = data.content.replace(/\n/g, '');
			return decodeURIComponent(escape(atob(b64)));
		}
	}
	return res.text();
}

// Blob helpers — same as text for GitHub (contents API handles base64)
function toB64(bytesBase64: string): string { return bytesBase64; }

export async function uploadBlob(folder: DriveFolder, name: string, base64: string, _mimeType: string, interactive = false): Promise<DriveFileMeta> {
	const p = `${folder}/${name}`;
	const { info } = await repoPath(p);
	const res = await githubFetch(`/repos/${info.owner}/${info.repo}/contents/${p}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: `scholiast: add ${p}`, content: toB64(base64), branch: info.branch }),
	}, interactive);
	const data = await res.json();
	return { id: data.content.path, name: data.content.name, sha: data.content.sha, headRevisionId: data.content.sha, path: data.content.path };
}

export async function updateBlob(fileId: string, base64: string, _mimeType: string, interactive = false): Promise<DriveFileMeta> {
	const p = fileId;
	const { info } = await repoPath(p);
	const meta = await findInFolder(p.split('/')[0] as DriveFolder, p.split('/').slice(1).join('/'), interactive);
	if (!meta?.sha) throw new Error(`GitHub blob not found: ${p}`);
	const res = await githubFetch(`/repos/${info.owner}/${info.repo}/contents/${p}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: `scholiast: update ${p}`, content: toB64(base64), sha: meta.sha, branch: info.branch }),
	}, interactive);
	const data = await res.json();
	return { id: data.content.path, name: data.content.name, sha: data.content.sha, headRevisionId: data.content.sha, path: data.content.path };
}

export async function downloadBlob(fileId: string, interactive = false): Promise<string> {
	const p = fileId;
	const { info } = await repoPath(p);
	const res = await githubFetch(`/repos/${info.owner}/${info.repo}/contents/${p}?ref=${info.branch}`, {
		method: 'GET', headers: { Accept: 'application/vnd.github.v3.raw' }
	}, interactive);
	if (res.headers.get('Content-Type')?.includes('application/json')) {
		const data = await res.json();
		const b64 = (data.content || '').replace(/\n/g, '');
		const mime = p.endsWith('.jpg') ? 'image/jpeg' : p.endsWith('.png') ? 'image/png' : 'application/octet-stream';
		return `data:${mime};base64,${b64}`;
	}
	const buf = await res.arrayBuffer();
	const bytes = new Uint8Array(buf);
	let bin = '';
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
	const mime = p.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
	return `data:${mime};base64,${btoa(bin)}`;
}

export async function deleteDriveFile(fileId: string, interactive = false): Promise<void> {
	const p = fileId;
	const { info } = await repoPath(p);
	const meta = await findInFolder(p.split('/')[0] as DriveFolder, p.split('/').slice(1).join('/'), interactive);
	if (!meta?.sha) return;
	await githubFetch(`/repos/${info.owner}/${info.repo}/contents/${p}`, {
		method: 'DELETE', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message: `scholiast: delete ${p}`, sha: meta.sha, branch: info.branch }),
	}, interactive);
}

export async function wipeAppData(interactive = false): Promise<number> {
	const info = await ensureRepo(interactive);
	// Delete all files under pages/frames/diagrams via listing
	let count = 0;
	for (const folder of ['pages', 'frames', 'diagrams'] as DriveFolder[]) {
		const files = await listFolder(folder, interactive).catch(() => [] as DriveFileMeta[]);
		for (const f of files) {
			try { await deleteDriveFile(f.id, interactive); count++; } catch {}
		}
	}
	return count;
}
