// Pure GitHub App auth helpers — no browser APIs, fully unit-tested.
// The stateful side (storage, tabs, fetch) lives in ./github.

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_API_VERSION = '2022-11-28';

/// Must match the Callback URL registered on the GitHub App. The static
/// bridge page at this URL forwards ?code=&state= into the app (deep link)
/// and shows the code for the extension paste flow.
export const GITHUB_BRIDGE_URL =
	'https://rehanqasim-dev.github.io/scholiast-web/oauth.html';

export interface GitHubTokenSet {
	accessToken: string;
	/// Epoch ms when the access token expires (0 = non-expiring).
	expiresAt: number;
	/// Rotated on every refresh — must be persisted when present.
	refreshToken?: string;
}

export function buildGitHubAuthUrl(clientId: string, state: string): string {
	const p = new URLSearchParams({
		client_id: clientId,
		redirect_uri: GITHUB_BRIDGE_URL,
		state,
		allow_signup: 'false',
	});
	return `${GITHUB_AUTHORIZE_URL}?${p.toString()}`;
}

/// Splits the bridge-page paste payload. The page's Copy button copies
/// `<code> <state>`; a lone code is accepted (state check skipped) for
/// hand-copied codes.
export function splitPastedCode(pasted: string): { code: string; state: string | null } {
	const parts = pasted.trim().split(/\s+/).filter(Boolean);
	return { code: parts[0] ?? '', state: parts[1] ?? null };
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim() !== '') {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
	return undefined;
}

/// Parses a token endpoint body. GitHub renders expires_in as a JSON STRING
/// ("28800") and answers some failures with HTTP 200 + an error body, so the
/// token's presence (not the status) decides success.
export function parseGitHubTokenBody(body: unknown, nowMs: number): GitHubTokenSet {
	const data = (body ?? {}) as Record<string, unknown>;
	const accessToken = typeof data.access_token === 'string' ? data.access_token : '';
	if (!accessToken) {
		const err = typeof data.error === 'string' && data.error ? data.error : 'token request failed';
		const desc = typeof data.error_description === 'string' && data.error_description ? ` (${data.error_description})` : '';
		throw new Error(`GitHub OAuth failed: ${err}${desc}`);
	}
	const expiresInSec = toNumber((data as Record<string, unknown>).expires_in);
	const refreshToken =
		typeof (data as Record<string, unknown>).refresh_token === 'string'
			? ((data as Record<string, unknown>).refresh_token as string)
			: undefined;
	return {
		accessToken,
		expiresAt: expiresInSec ? nowMs + expiresInSec * 1000 : 0,
		...(refreshToken ? { refreshToken } : {}),
	};
}

/// Seconds of lifetime left; +Infinity for non-expiring tokens.
export function tokenLifetimeLeftSec(token: { expiresAt: number }, nowMs: number): number {
	if (!token.expiresAt) return Number.POSITIVE_INFINITY;
	return Math.floor((token.expiresAt - nowMs) / 1000);
}
