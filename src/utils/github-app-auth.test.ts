import { describe, expect, it } from 'vitest';
import {
	buildGitHubAuthUrl,
	GITHUB_BRIDGE_URL,
	parseGitHubTokenBody,
	splitPastedCode,
	tokenLifetimeLeftSec,
} from './github-app-auth';

describe('buildGitHubAuthUrl', () => {
	it('points at the bridge page with state and no scope', () => {
		const url = buildGitHubAuthUrl('Iv23test', 's tate');
		const u = new URL(url);
		expect(u.origin + u.pathname).toBe('https://github.com/login/oauth/authorize');
		expect(u.searchParams.get('client_id')).toBe('Iv23test');
		expect(u.searchParams.get('redirect_uri')).toBe(GITHUB_BRIDGE_URL);
		expect(u.searchParams.get('state')).toBe('s tate');
		expect(u.searchParams.get('allow_signup')).toBe('false');
		expect(u.searchParams.has('scope')).toBe(false);
	});
});

describe('splitPastedCode', () => {
	it('splits a code+state bundle from the bridge copy button', () => {
		expect(splitPastedCode('abc123 xyz789')).toEqual({ code: 'abc123', state: 'xyz789' });
	});
	it('accepts a lone hand-copied code', () => {
		expect(splitPastedCode('  abc123  ')).toEqual({ code: 'abc123', state: null });
	});
	it('handles empty paste', () => {
		expect(splitPastedCode('')).toEqual({ code: '', state: null });
	});
});

describe('parseGitHubTokenBody', () => {
	it('parses string expires_in and rotation refresh token', () => {
		const set = parseGitHubTokenBody(
			{ access_token: 'ghu_x', expires_in: '28800', refresh_token: 'ghr_y', token_type: 'bearer' },
			1_000_000,
		);
		expect(set).toEqual({
			accessToken: 'ghu_x',
			expiresAt: 1_000_000 + 28_800_000,
			refreshToken: 'ghr_y',
		});
	});
	it('parses numeric expires_in and missing refresh token', () => {
		const set = parseGitHubTokenBody({ access_token: 'ghu_x', expires_in: 28800 }, 0);
		expect(set.accessToken).toBe('ghu_x');
		expect(set.expiresAt).toBe(28_800_000);
		expect(set.refreshToken).toBeUndefined();
	});
	it('rejects error bodies even on HTTP 200', () => {
		expect(() =>
			parseGitHubTokenBody({ error: 'bad_verification_code', error_description: 'expired' }, 0),
		).toThrow(/bad_verification_code.*expired/);
	});
	it('rejects empty bodies', () => {
		expect(() => parseGitHubTokenBody({}, 0)).toThrow(/token request failed/);
	});
});

describe('tokenLifetimeLeftSec', () => {
	it('reports remaining seconds and infinity for non-expiring', () => {
		expect(tokenLifetimeLeftSec({ expiresAt: 5_000 }, 1_500)).toBe(3);
		expect(tokenLifetimeLeftSec({ expiresAt: 0 }, 1_500)).toBe(Number.POSITIVE_INFINITY);
	});
});
