import browser from '../../utils/browser-polyfill';
import { AnyHighlightData, DomainSettings, StoredData, normalizeUrl } from '../../utils/highlighter';
import { getAll, removePage, setPage } from '../../utils/page-store';
import { loadAllVideoData } from '../../utils/video/video-storage';
import { state } from './store';
import { commentBody, createdOf, quoteText } from './format';
import {
	DomainGroup, DrawingCarrier, DrawingSet, DrawingStroke, HLColor, HighlightEntry,
	PageGroup, RenderUnit, VideoCarrier, VisiblePage,
} from './types';

/**
 * Loading, merging and querying. The dashboard reads all three per-page stores —
 * `hl` (highlights), `va` (video annotations) and `dr` (freehand drawings) — and
 * merges them into one page per normalised url, so a page that was annotated in
 * more than one way appears once, with everything on it.
 */

interface StoredDrawings { url: string; strokes: DrawingStroke[] }

const DRAWINGS_ID = '__drawings__';

export async function loadData(): Promise<void> {
	const [allHighlights, domainResult] = await Promise.all([
		getAll<StoredData>('hl'),
		browser.storage.local.get('domains'),
	]);
	state.domainSettings = (domainResult.domains || {}) as Record<string, DomainSettings>;

	// Collapse legacy duplicate keys (same page stored under un-normalised urls).
	const mergedMap = new Map<string, { stored: StoredData; originalKeys: string[] }>();
	for (const [urlKey, stored] of Object.entries(allHighlights)) {
		if (!stored.highlights || stored.highlights.length === 0) continue;
		const normUrl = normalizeUrl(stored.url || urlKey);
		const existing = mergedMap.get(normUrl);
		if (existing) {
			existing.stored.highlights = [...existing.stored.highlights, ...stored.highlights];
			if (!existing.stored.title && stored.title) existing.stored.title = stored.title;
			existing.originalKeys.push(urlKey);
		} else {
			mergedMap.set(normUrl, {
				stored: { ...stored, url: normUrl, highlights: [...stored.highlights] },
				originalKeys: [urlKey],
			});
		}
	}
	for (const [normUrl, { stored, originalKeys }] of mergedMap) {
		if (originalKeys.length > 1 || originalKeys[0] !== normUrl) {
			for (const key of originalKeys) if (key !== normUrl) await removePage('hl', key);
			await setPage<StoredData>('hl', normUrl, stored);
		}
	}

	// One PageGroup per url, filled from every store.
	const pages = new Map<string, PageGroup>();
	const pageFor = (url: string, title?: string): PageGroup => {
		let page = pages.get(url);
		if (!page) {
			let path = '/';
			try { const u = new URL(url); path = u.pathname + u.search; } catch { /* raw key */ }
			page = { url, path, title, highlights: [] };
			pages.set(url, page);
		}
		if (!page.title && title) page.title = title;
		return page;
	};

	for (const { stored } of mergedMap.values()) {
		const page = pageFor(stored.url, stored.title);
		page.highlights.push(...stored.highlights.map(h => ({ data: h, url: stored.url })));
	}

	// Video annotations: same card model, with the item stashed on the entry.
	const videoData = await loadAllVideoData();
	for (const [url, data] of Object.entries(videoData)) {
		if (!data.items || data.items.length === 0) continue;
		const page = pageFor(url, data.title);
		for (const item of data.items) {
			page.highlights.push({
				url,
				data: {
					type: 'text', id: item.id, xpath: '', startOffset: 0, endOffset: 0,
					content: item.quote || '', notes: item.notes, color: item.color as HLColor | undefined,
					updatedAt: item.updatedAt,
					__video: item,
				} as unknown as AnyHighlightData,
			});
		}
	}

	// Freehand drawings: one card per page, carrying that page's strokes.
	const allDrawings = await getAll<StoredDrawings>('dr');
	for (const [urlKey, stored] of Object.entries(allDrawings)) {
		if (!stored.strokes || stored.strokes.length === 0) continue;
		const url = normalizeUrl(stored.url || urlKey);
		const page = pageFor(url);
		const updatedAt = stored.strokes.reduce((max, s) => Math.max(max, s.updatedAt || 0), 0);
		page.highlights.push({
			url,
			data: {
				type: 'element', id: DRAWINGS_ID, xpath: '', content: '', notes: [],
				updatedAt,
				__drawing: { id: DRAWINGS_ID, strokes: stored.strokes } satisfies DrawingSet,
			} as unknown as AnyHighlightData,
		});
	}

	// Group pages by domain.
	const domainMap = new Map<string, PageGroup[]>();
	for (const page of pages.values()) {
		let domain: string;
		try { domain = new URL(page.url).hostname.replace(/^www\./, ''); }
		catch { domain = page.url; }
		if (!domainMap.has(domain)) domainMap.set(domain, []);
		domainMap.get(domain)!.push(page);
	}
	state.groups = Array.from(domainMap.entries()).map(([domain, list]) => ({
		domain,
		pages: list.sort((a, b) => pageStamp(b) - pageStamp(a)),
		totalHighlights: list.reduce((sum, p) => sum + p.highlights.length, 0),
	}));

	pruneNav();
	state.loaded = true;
	dataVersion++;
	memoSignature = '';
}

/** Drop a nav selection whose target no longer exists. */
function pruneNav(): void {
	const nav = state.nav;
	if (nav.type === 'domain' && !state.groups.some(g => g.domain === nav.domain)) {
		state.nav = { type: 'all' };
	} else if (nav.type === 'page') {
		const group = state.groups.find(g => g.domain === nav.domain);
		if (!group?.pages.some(p => p.url === nav.url)) state.nav = { type: 'all' };
	}
}

// --- Entry kinds ----------------------------------------------------------

export function videoOf(data: AnyHighlightData) { return (data as VideoCarrier).__video ?? null; }
export function drawingOf(data: AnyHighlightData) { return (data as DrawingCarrier).__drawing ?? null; }
export function colorOf(data: AnyHighlightData): HLColor { return (data.color as HLColor) || 'yellow'; }

export function hasComments(entry: HighlightEntry): boolean {
	return (entry.data.notes ?? []).some(n => commentBody(n).length > 0);
}

export function commentCount(unit: RenderUnit): number {
	return unit.entries.reduce(
		(sum, e) => sum + (e.data.notes ?? []).filter(n => commentBody(n).length > 0).length, 0);
}

// --- Stamps ---------------------------------------------------------------

/** When the newest annotation in a unit was made — its position in the stream. */
export function unitStamp(unit: RenderUnit): number {
	return unit.entries.reduce((max, e) => Math.max(max, createdOf(e.data)), 0);
}

export function pageStamp(page: PageGroup): number {
	return page.highlights.reduce((max, h) => Math.max(max, createdOf(h.data)), 0);
}

export function pageOldest(page: PageGroup): number {
	return page.highlights.reduce(
		(min, h) => Math.min(min, createdOf(h.data) || Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
}

function domainStamp(group: DomainGroup): number {
	return group.pages.reduce((max, p) => Math.max(max, pageStamp(p)), 0);
}

// --- Tags -----------------------------------------------------------------

const NOTE_TAG_RE = /(^|\s)#([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)/g;

export function tagsOfNotes(notes?: string[]): string[] {
	if (!notes || notes.length === 0) return [];
	const out: string[] = [];
	for (const note of notes) {
		const clean = note.replace(/<!--[^>]*-->/g, ' ');
		NOTE_TAG_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = NOTE_TAG_RE.exec(clean))) out.push(m[2].toLowerCase());
	}
	return out;
}

export function tagsOfUnit(unit: RenderUnit): string[] {
	return [...new Set(unit.entries.flatMap(e => tagsOfNotes(e.data.notes)))];
}

// --- Filtering ------------------------------------------------------------

function rangeCutoff(): number {
	const day = 86_400_000;
	switch (state.filters.range) {
		case 'today': { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
		case '7d': return Date.now() - 7 * day;
		case '30d': return Date.now() - 30 * day;
		default: return 0;
	}
}

// Parsing a highlight's HTML to text isn't free and search runs it on every
// keystroke, so each record's text is remembered for as long as the record lives.
const textCache = new WeakMap<object, string>();

export function entryText(data: AnyHighlightData): string {
	const cached = textCache.get(data);
	if (cached !== undefined) return cached;
	const text = quoteText(data.content || '');
	textCache.set(data, text);
	return text;
}

/** Text a unit is searched by: its quotes, its comments and its page url. */
function haystack(unit: RenderUnit): string {
	const parts: string[] = [unit.pageUrl, unit.title || ''];
	for (const e of unit.entries) {
		parts.push(entryText(e.data));
		for (const n of e.data.notes ?? []) parts.push(commentBody(n));
	}
	return parts.join('\n').toLowerCase();
}

function unitPasses(unit: RenderUnit, cutoff: number): boolean {
	const f = state.filters;
	if (f.query && !haystack(unit).includes(f.query)) return false;
	if (f.colors.size > 0 && !unit.entries.some(e => f.colors.has(colorOf(e.data)))) return false;
	if (f.withComments && commentCount(unit) === 0) return false;
	if (cutoff && unitStamp(unit) < cutoff) return false;
	if (f.tag) {
		const tags = tagsOfUnit(unit);
		if (!tags.some(t => t === f.tag || t.startsWith(f.tag + '/'))) return false;
	}
	return true;
}

/** Domains shown in the rail, honouring the rail's own search box. */
export function railGroups(): DomainGroup[] {
	const q = state.filters.sources;
	const groups = q
		? state.groups.filter(g => {
			const site = state.domainSettings[g.domain]?.site?.toLowerCase() || '';
			return g.domain.toLowerCase().includes(q) || site.includes(q);
		})
		: [...state.groups];
	const dir = state.prefs.sort === 'old' ? -1 : 1;
	return groups.sort((a, b) => (domainStamp(b) - domainStamp(a)) * dir);
}

/** Collapse grouped highlights (one selection across blocks) into single units. */
function unitsOf(page: PageGroup, domain: string): RenderUnit[] {
	const units: RenderUnit[] = [];
	const byGroup = new Map<string, RenderUnit>();
	for (const entry of page.highlights) {
		const gid = entry.data.groupId;
		if (gid) {
			const existing = byGroup.get(gid);
			if (existing) { existing.entries.push(entry); continue; }
			const unit: RenderUnit = {
				key: `${page.url}::${gid}`, entries: [entry], pageUrl: page.url, domain, title: page.title,
			};
			byGroup.set(gid, unit);
			units.push(unit);
		} else {
			units.push({
				key: `${page.url}::${entry.data.id}`, entries: [entry],
				pageUrl: page.url, domain, title: page.title,
			});
		}
	}
	return units;
}

const COLOR_ORDER: HLColor[] = ['yellow', 'green', 'red'];

function sortUnits(units: RenderUnit[]): RenderUnit[] {
	switch (state.prefs.sort) {
		case 'old': return units.sort((a, b) => unitStamp(a) - unitStamp(b));
		case 'doc': return units;
		case 'color': return units.sort((a, b) =>
			COLOR_ORDER.indexOf(colorOf(a.entries[0].data)) - COLOR_ORDER.indexOf(colorOf(b.entries[0].data))
			|| unitStamp(b) - unitStamp(a));
		default: return units.sort((a, b) => unitStamp(b) - unitStamp(a));
	}
}

/**
 * The pages the stream shows for the current nav, each with its filtered and
 * sorted units. A page with no surviving units is dropped only when a filter is
 * what emptied it — an unfiltered page always shows, so it can be navigated to.
 */
export function visiblePages(): VisiblePage[] {
	// A render pass asks for this several times (stream, tag counts, colour counts,
	// stats) with the same inputs; recompute only when an input actually changed.
	const f = state.filters;
	const signature = [
		dataVersion, state.prefs.sort, JSON.stringify(state.nav), f.sources, f.query,
		[...f.colors].sort().join(','), f.tag, f.withComments, f.range,
	].join('|');
	if (signature === memoSignature) return memoPages;

	const cutoff = rangeCutoff();
	const filtering = !!state.filters.query || state.filters.colors.size > 0
		|| !!state.filters.tag || state.filters.withComments || state.filters.range !== 'all';
	const out: VisiblePage[] = [];
	for (const group of railGroups()) {
		if (state.nav.type !== 'all' && state.nav.domain !== group.domain) continue;
		for (const page of group.pages) {
			if (state.nav.type === 'page' && state.nav.url !== page.url) continue;
			const units = sortUnits(unitsOf(page, group.domain).filter(u => unitPasses(u, cutoff)));
			if (units.length === 0 && filtering) continue;
			out.push({ page, domain: group.domain, units });
		}
	}
	const dir = state.prefs.sort === 'old' ? -1 : 1;
	out.sort((a, b) => (pageStamp(b.page) - pageStamp(a.page)) * dir);
	memoSignature = signature;
	memoPages = out;
	return out;
}

let memoSignature = '';
let memoPages: VisiblePage[] = [];
/** Bumped whenever the underlying records change, invalidating the memo above. */
let dataVersion = 0;

/** All units in the current scope, ignoring the tag filter — for tag counts. */
export function tagCounts(): Map<string, number> {
	const saved = state.filters.tag;
	state.filters.tag = null;
	const units = visiblePages().flatMap(p => p.units);
	state.filters.tag = saved;

	const counts = new Map<string, number>();
	for (const unit of units) {
		const paths = new Set<string>();
		for (const tag of tagsOfUnit(unit)) {
			let path = '';
			for (const part of tag.split('/')) { path = path ? `${path}/${part}` : part; paths.add(path); }
		}
		for (const p of paths) counts.set(p, (counts.get(p) || 0) + 1);
	}
	return counts;
}

/** Colour counts in the current scope, ignoring the colour filter. */
export function colorCounts(): Record<HLColor, number> {
	const saved = state.filters.colors;
	state.filters.colors = new Set();
	const units = visiblePages().flatMap(p => p.units);
	state.filters.colors = saved;
	const out: Record<HLColor, number> = { yellow: 0, red: 0, green: 0 };
	for (const unit of units) for (const e of unit.entries) out[colorOf(e.data)]++;
	return out;
}

export interface Stats {
	annotations: number;
	comments: number;
	drawings: number;
	videos: number;
	sources: number;
	pages: number;
	first: number;
	last: number;
}

export function statsFor(pages: VisiblePage[]): Stats {
	const stats: Stats = {
		annotations: 0, comments: 0, drawings: 0, videos: 0,
		sources: new Set(pages.map(p => p.domain)).size, pages: pages.length,
		first: 0, last: 0,
	};
	for (const { units } of pages) {
		for (const unit of units) {
			const drawing = drawingOf(unit.entries[0].data);
			if (drawing) stats.drawings += drawing.strokes.length;
			else stats.annotations += unit.entries.length;
			if (videoOf(unit.entries[0].data)) stats.videos++;
			stats.comments += commentCount(unit);
			const stamp = unitStamp(unit);
			if (stamp) {
				stats.last = Math.max(stats.last, stamp);
				stats.first = stats.first ? Math.min(stats.first, stamp) : stamp;
			}
		}
	}
	return stats;
}

export function findPage(url: string): PageGroup | undefined {
	for (const group of state.groups) {
		const page = group.pages.find(p => p.url === url);
		if (page) return page;
	}
	return undefined;
}

export function siteName(domain: string): string {
	return state.domainSettings[domain.replace(/^www\./, '')]?.site || domain.replace(/^www\./, '');
}
