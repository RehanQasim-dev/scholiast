import browser from './browser-polyfill';

// GitHub sync backend — private repo `scholiast-annotations` (or user-chosen).
// Mirrors the Drive layout inside that repo so both backends can be merged:
//
//   pages/page-<hash>.json   one record per normalized URL
//   frames/frame-<id>.jpg
//   diagrams/diagram-<id>.png + diagram-<id>.scene.json
//
// Auth: OAuth App with PKCE (RFC7636) via browser.identity.launchWebAuthFlow.
// Same two redirect URIs as Drive: chromiumapp.org for Chromium, loopback
// http://127.0.0.1/mozoauth2/<sha1> for Firefox (the add-on id is pinned).
// Token is long-lived for OAuth Apps (no refresh dance). Repo is created on
// first connect if missing.
//
// Build injection: GITHUB_CLIENT_ID from oauth.local.json / GITHUB_OAUTH_CLIENT_ID
// env (see webpack.config.js). Missing → github sync disabled.

declare const GITHUB_CLIENT_ID: string;

export const GITHUB_CLIENT_ID_INJECTED: string = typeof GITHUB_CLIENT_ID !== 'undefined' ? GITHUB_CLIENT_ID : '';

const GITHUB_AUTH = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_API = 'https://api.github.com';
const TOKEN_KEY = 'github_token';
const REPO_KEY = 'github_repo';
const REPO_NAME = 'scholiast-annotations';
const REPO_BRANCH = 'main';
const SCOPE = 'repo';

export type DriveFolder = 'pages' | 'frames' | 'diagrams';

export interface DriveFileMeta {
	id: string; // for GitHub: path `pages/page-...json` (used as fileId)
	name: string;
	modifiedTime?: string;
	headRevisionId?: string; // sha
	sha?: string;
	path?: string;
}

interface CachedToken {
	accessToken: string;
	expiresAt?: number;
}

interface RepoInfo {
	owner: string;
	repo: string;
	branch: string;
}

export function isConfigured(): boolean {
	return (GITHUB_CLIENT_ID_INJECTED || '').trim().length > 0;
}

export function getRedirectUrl(): string {
	return browser.identity.getRedirectURL();
}

function isChromiumFlow(): boolean {
	return getRedirectUrl().includes('.chromiumapp.org');
}

function loopbackRedirectUri(): string {
	const host = new URL(getRedirectUrl()).hostname;
	return `http://127.0.0.1/mozoauth2/${host.split('.')[0]}`;
}

export function getRegisteredRedirectUri(): string {
	return isChromiumFlow() ? getRedirectUrl() : loopbackRedirectUri();
}

function activeClientId(): string {
	return GITHUB_CLIENT_ID_INJECTED;
}

// --- token helpers -----------------------------------------------------------

function base64urlBytes(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomUrlSafe(n: number): string {
	return base64urlBytes(crypto.getRandomValues(new Uint8Array(n)));
}
async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
	const verifier = randomUrlSafe(48);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return { verifier, challenge: base64urlBytes(new Uint8Array(digest)) };
}

async function saveToken(t: CachedToken): Promise<CachedToken> {
	await browser.storage.local.set({ [TOKEN_KEY]: t });
	return t;
}
async function getCachedToken(): Promise<CachedToken | null> {
	const r = await browser.storage.local.get(TOKEN_KEY);
	return (r[TOKEN_KEY] as CachedToken) || null;
}
async function getRepoInfo(): Promise<RepoInfo | null> {
	const r = await browser.storage.local.get(REPO_KEY);
	return (r[REPO_KEY] as RepoInfo) || null;
}
async function saveRepoInfo(info: RepoInfo): Promise<void> {
	await browser.storage.local.set({ [REPO_KEY]: info });
}

// --- OAuth -------------------------------------------------------------------

function buildAuthUrl(challenge: string, state: string): string {
	const p = new URLSearchParams({
		client_id: activeClientId(),
		redirect_uri: getRegisteredRedirectUri(),
		scope: SCOPE,
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
	});
	return `${GITHUB_AUTH}?${p.toString()}`;
}

async function tokenRequest(code: string, verifier: string): Promise<CachedToken> {
	const body = new URLSearchParams({
		client_id: activeClientId(),
		code,
		redirect_uri: getRegisteredRedirectUri(),
		code_verifier: verifier,
	});
	const res = await fetch(GITHUB_TOKEN, {
		method: 'POST',
		headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString(),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok || !data.access_token) {
		throw new Error(`GitHub OAuth failed: ${data.error_description || data.error || res.status}`);
	}
	// OAuth App tokens don't expire (no refresh_token)
	return { accessToken: data.access_token };
}

async function launchAuth(): Promise<CachedToken> {
	if (!isConfigured()) throw new Error('GitHub client id not configured');
	const { verifier, challenge } = await pkcePair();
	const state = randomUrlSafe(16);
	const url = buildAuthUrl(challenge, state);
	const redirect = await browser.identity.launchWebAuthFlow({ url, interactive: true });
	if (!redirect) throw new Error('GitHub OAuth returned no redirect');
	const u = new URL(redirect);
	const err = u.searchParams.get('error');
	if (err) throw new Error(`GitHub OAuth error: ${err}`);
	if (u.searchParams.get('state') !== state) throw new Error('GitHub OAuth state mismatch');
	const code = u.searchParams.get('code');
	if (!code) throw new Error('No code in GitHub OAuth response');
	const tok = await tokenRequest(code, verifier);
	return saveToken(tok);
}

export async function getAccessToken(interactive: boolean): Promise<string> {
	if (!isConfigured()) throw new Error('GitHub not configured');
	const cached = await getCachedToken();
	if (cached?.accessToken) return cached.accessToken;
	if (!interactive) throw new Error('Not connected to GitHub');
	return (await launchAuth()).accessToken;
}

export async function isConnected(): Promise<boolean> {
	const c = await getCachedToken();
	return !!c?.accessToken;
}

export async function disconnect(): Promise<void> {
	await browser.storage.local.remove([TOKEN_KEY, REPO_KEY]);
	// GitHub has no revoke endpoint needed for OAuth App; token stays valid until user revokes in settings
}

export async function connect(): Promise<void> {
	await launchAuth();
	// Ensure repo exists right after connect so first sync doesn't have to
	await ensureRepo(true);
}

// --- GitHub REST -------------------------------------------------------------

async function githubFetch(path: string, init: RequestInit, interactive = false): Promise<Response> {
	let token = await getAccessToken(interactive);
	let res = await fetch(`${GITHUB_API}${path}`, {
		...init,
		headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
	});
	if (res.status === 401) {
		await browser.storage.local.remove(TOKEN_KEY);
		if (!interactive) throw new Error('GitHub token expired');
		token = await getAccessToken(true);
		res = await fetch(`${GITHUB_API}${path}`, {
			...init,
			headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
		});
	}
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`GitHub API ${res.status}: ${body.slice(0, 400)}`);
	}
	return res;
}

async function getAuthenticatedUser(interactive: boolean): Promise<{ login: string }> {
	const res = await githubFetch('/user', { method: 'GET' }, interactive);
	return (await res.json()) as { login: string };
}

export async function ensureRepo(interactive: boolean): Promise<RepoInfo> {
	let info = await getRepoInfo();
	if (info) {
		// Verify it still exists
		try {
			await githubFetch(`/repos/${info.owner}/${info.repo}`, { method: 'GET' }, interactive);
			return info;
		} catch {
			// fall through to recreate / rediscover
		}
	}
	const user = await getAuthenticatedUser(interactive);
	const owner = user.login;
	// Try existing repo
	try {
		await githubFetch(`/repos/${owner}/${REPO_NAME}`, { method: 'GET' }, interactive);
		info = { owner, repo: REPO_NAME, branch: REPO_BRANCH };
		await saveRepoInfo(info);
		return info;
	} catch (e: any) {
		if (!String(e.message).includes('404')) throw e;
	}
	// Create private repo
	await githubFetch('/user/repos', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name: REPO_NAME, private: true, description: 'Scholiast annotations backup — synced by extension', auto_init: true }),
	}, interactive);
	info = { owner, repo: REPO_NAME, branch: REPO_BRANCH };
	await saveRepoInfo(info);
	// Give GitHub a moment to init branch
	await new Promise(r => setTimeout(r, 800));
	return info;
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
