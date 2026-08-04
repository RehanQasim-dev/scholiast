import dayjs from 'dayjs';
import { AnyHighlightData } from '../../utils/highlighter';

/**
 * Formatting rules for everything the dashboard displays. Kept in one place so a
 * date, a count or a url reads identically wherever it appears.
 */

// Anything before this is not a plausible wall-clock ms for an annotation id.
const EPOCH_FLOOR = 1_000_000_000_000;

/**
 * When an annotation was *made*.
 *
 * This is what the dashboard sorts and dates by — deliberately not `updatedAt`,
 * which moves every time you add a comment and would make the annotation you are
 * writing on jump out from under the cursor.
 *
 * Highlight ids are `Date.now()`; video item ids are `Date.now().toString(36)`
 * plus random suffix, so the leading 8 base-36 characters carry their timestamp.
 */
export function createdOf(data: AnyHighlightData): number {
	const decimal = parseInt(data.id, 10);
	if (Number.isFinite(decimal) && decimal >= EPOCH_FLOOR) return decimal;
	const base36 = parseInt(data.id.slice(0, 8), 36);
	if (Number.isFinite(base36) && base36 >= EPOCH_FLOOR) return base36;
	const updated = (data as { updatedAt?: number }).updatedAt;
	return typeof updated === 'number' && updated > 0 ? updated : 0;
}

/**
 * Hybrid stamp: precise while it still matters, absolute once it doesn't.
 * Relative time is only honest for a few days — past that a date is more useful.
 */
export function formatStamp(ms: number): string {
	if (!ms) return '';
	const d = dayjs(ms);
	const now = dayjs();
	const minutes = now.diff(d, 'minute');
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;
	if (d.isSame(now, 'day')) return d.format('HH:mm');
	if (now.diff(d, 'day') < 7) return `${now.diff(d, 'day') || 1}d ago`;
	if (d.isSame(now, 'year')) return d.format('MMM D');
	return d.format('MMM D, YYYY');
}

/** Full stamp for tooltips. */
export function fullStamp(ms: number): string {
	return ms ? dayjs(ms).format('ddd, MMM D YYYY [at] HH:mm') : '';
}

/** A date range, collapsed when both ends land on the same day. */
export function formatSpan(from: number, to: number): string {
	if (!from || !to) return '';
	const a = dayjs(from);
	const b = dayjs(to);
	if (a.isSame(b, 'day')) return a.format('MMM D, YYYY');
	const sameYear = a.isSame(b, 'year');
	return `${a.format(sameYear ? 'MMM D' : 'MMM D, YYYY')} → ${b.format('MMM D, YYYY')}`;
}

export function plural(n: number, word: string): string {
	return `${n.toLocaleString()} ${pluralWord(n, word)}`;
}

export function pluralWord(n: number, word: string): string {
	return `${word}${n === 1 ? '' : 's'}`;
}

const TITLE_SEPARATORS = [' | ', ' — ', ' – ', ' · ', ' :: ', ' - '];

/**
 * Page titles arrive with the site name appended by the CMS ("Real title | Some
 * Blog"). The site is already shown by the favicon and the url, so the tail is
 * noise — dropped when it plausibly *is* the site name and enough title remains.
 */
export function cleanTitle(title: string | undefined, host: string, siteName?: string): string {
	const raw = (title || '').trim();
	if (!raw) return '';
	for (const sep of TITLE_SEPARATORS) {
		const at = raw.lastIndexOf(sep);
		if (at <= 0) continue;
		const head = raw.slice(0, at).trim();
		const tail = raw.slice(at + sep.length).trim();
		if (!head || !tail || head.length < 12 || tail.length > 32) continue;
		const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
		const tailKey = squash(tail);
		const hostKey = squash(host);
		const siteKey = siteName ? squash(siteName) : '';
		if (!tailKey) continue;
		if (hostKey.includes(tailKey) || tailKey.includes(hostKey.replace(/com$|org$|net$|io$|ai$/, '')) ||
			(siteKey && (siteKey === tailKey || tailKey.includes(siteKey)))) {
			return head;
		}
	}
	return raw;
}

/** Keep both ends of a string — the informative part of a path is usually the end. */
export function truncateMiddle(text: string, max: number): string {
	if (text.length <= max) return text;
	const keep = max - 1;
	const head = Math.ceil(keep * 0.55);
	const tail = keep - head;
	return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

/** `host/path` without the scheme, `www.`, trailing slash or query noise. */
export function prettyUrl(url: string, max = 68): string {
	let out = url;
	try {
		const u = new URL(url);
		const path = decodeURIComponent(u.pathname).replace(/\/$/, '');
		out = u.hostname.replace(/^www\./, '') + path + (u.search ? u.search : '');
	} catch { /* not a url — show it raw */ }
	return truncateMiddle(out, max);
}

/** A page's path, for pages whose title we never captured. */
export function displayPath(path: string): string {
	try { return decodeURIComponent(path).replace(/^\//, '') || '/'; }
	catch { return path.replace(/^\//, '') || '/'; }
}

/** The text of a page group's heading: cleaned title, else its path. */
export function pageLabel(title: string | undefined, path: string, host: string, siteName?: string): string {
	return cleanTitle(title, host, siteName) || displayPath(path);
}

/** Strip the metadata comments the comment format hides inside note text. */
export function commentBody(note: string): string {
	return note
		.replace(/<!--timestamp:\d+-->/g, '')
		.replace(/<!--edited:\d+-->/g, '')
		.trim();
}

export function commentTimes(note: string): { created: number; edited: number } {
	const created = parseInt(note.match(/<!--timestamp:(\d+)-->/)?.[1] || '0', 10) || 0;
	const edited = parseInt(note.match(/<!--edited:(\d+)-->/)?.[1] || '0', 10) || 0;
	return { created, edited };
}

/**
 * Plain text of a highlight's stored HTML, for search, copy and titles. Parsed
 * into an inert document so nothing in the markup can load or run.
 */
export function quoteText(html: string): string {
	if (!html) return '';
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}
