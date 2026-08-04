import browser from '../utils/browser-polyfill';
import { AnyHighlightData, StoredData, DomainSettings, collapseGroupsForExport, normalizeUrl } from '../utils/highlighter';
import DOMPurify from 'dompurify';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { loadAllVideoData, removeVideoItem, updateVideoItemNotes, VideoItem } from '../utils/video/video-storage';
import { getPage, setPage, removePage, getAll, clearAll, anyPageChanged } from '../utils/page-store';
import { detectBrowser } from '../utils/browser-detection';
import { renderMarkupSvg } from '../utils/video/video-markup';
import { formatVideoTime, makeVideoNote } from '../utils/video/video-notes';
import { loadFrameImage, loadDiagramImage } from '../utils/video/frame-store';
import {
	commentTextToDisplayHtml, commentTextToEditableHtml, serializeCommentEditor,
	applyCommentFormat, activeCommentFormats, toggleTaskFromClick, toggleTaskInMarkdown,
	type CommentFormatCommand,
} from '../utils/comment-markdown';

dayjs.extend(relativeTime);

// A video annotation item is carried through the dashboard's HighlightEntry model
// by stashing it on the entry data under this key.
interface VideoCarrier { __video?: VideoItem }

interface DomainGroup {
	domain: string;
	pages: PageGroup[];
	totalHighlights: number;
}

interface PageGroup {
	url: string;
	path: string;
	title?: string;
	highlights: HighlightEntry[];
}

interface HighlightEntry {
	data: AnyHighlightData;
	url: string;
}

type NavSelection =
	| { type: 'all' }
	| { type: 'domain'; domain: string }
	| { type: 'page'; domain: string; url: string };

type SortOrder = 'az' | 'za' | 'new' | 'old';
type HLColor = 'yellow' | 'red' | 'green';

// One render unit — a single highlight, or a group sharing a groupId shown as one card.
interface RenderUnit { entries: HighlightEntry[]; pageUrl: string; domain: string; title?: string }

let allDomainGroups: DomainGroup[] = [];
let domainSettingsMap: Record<string, DomainSettings> = {};
let searchQueryWebsites = '';
let searchQueryHighlights = '';
let currentNav: NavSelection = { type: 'all' };
let sortOrder: SortOrder = 'new';
let activeTagFilter: string | null = null;
const expandedSidebarDomains = new Set<string>();
const expandedPages = new Set<string>();
// Comment currently being edited inline: `${pageUrl}::${highlightId}::${noteIndex}`.
let editingComment: string | null = null;

// Design accent (purple) + per-color card classes (full literals so Tailwind's
// scanner picks them up — never build these class strings dynamically).
const ACCENT = '#8c73fa';
const COLOR: Record<HLColor, { dot: string; quote: string }> = {
	yellow: { dot: 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]', quote: 'border-yellow-500/50 bg-yellow-500/5' },
	red: { dot: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]', quote: 'border-red-500/50 bg-red-500/5' },
	green: { dot: 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]', quote: 'border-green-500/50 bg-green-500/5' },
};

// --- Small DOM helpers ---

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K, className = '', text?: string
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function icon(name: string, className = ''): HTMLSpanElement {
	const s = el('span', `material-symbols-outlined${className ? ' ' + className : ''}`);
	s.textContent = name;
	return s;
}

function $(id: string): HTMLElement { return document.getElementById(id)!; }

// --- Bootstrap ---

document.addEventListener('DOMContentLoaded', async () => {
	currentNav = readNavFromUrl();
	await loadData();
	if (currentNav.type === 'domain' || currentNav.type === 'page') {
		expandedSidebarDomains.add(currentNav.domain);
	}
	if (currentNav.type === 'page') expandedPages.add(currentNav.url);
	render();

	const sourceSearch = $('hl-source-search') as HTMLInputElement;
	sourceSearch.addEventListener('input', () => {
		searchQueryWebsites = sourceSearch.value.toLowerCase().trim();
		render();
	});

	$('hl-home').addEventListener('click', () => navigate({ type: 'all' }));
	$('hl-export-btn').addEventListener('click', exportCurrentContext);
	$('hl-delete-btn').addEventListener('click', deleteCurrentContext);
	setupReplyFocusHandling();

	browser.storage.onChanged.addListener((changes, area) => {
		if (area === 'local' && anyPageChanged(changes, ['hl', 'va'])) {
			loadData().then(render);
		}
		// A diagram was (re)saved from the Excalidraw popup: its rendered PNG changed
		// in the blob store. Re-render so each diagram <img> refetches the new image.
		if (area === 'local' && changes.diagrams) {
			renderContent();
		}
	});
});

// --- Data loading (unchanged pipeline) ---

async function loadData() {
	const allHighlights = await getAll<StoredData>('hl');
	const result = await browser.storage.local.get('domains');
	domainSettingsMap = (result.domains || {}) as Record<string, DomainSettings>;

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
			for (const key of originalKeys) {
				if (key !== normUrl) await removePage('hl', key);
			}
			await setPage<StoredData>('hl', normUrl, stored);
		}
	}

	const domainMap = new Map<string, PageGroup[]>();
	for (const [, { stored }] of mergedMap) {
		let domain: string;
		let path: string;
		try {
			const parsed = new URL(stored.url);
			domain = parsed.hostname.replace(/^www\./, '');
			path = parsed.pathname + parsed.search;
		} catch {
			domain = stored.url;
			path = '/';
		}
		if (!domainMap.has(domain)) domainMap.set(domain, []);
		domainMap.get(domain)!.push({
			url: stored.url,
			path,
			title: stored.title,
			highlights: stored.highlights.map(h => ({ data: h, url: stored.url })),
		});
	}

	allDomainGroups = Array.from(domainMap.entries()).map(([domain, pages]) => ({
		domain,
		pages: pages.sort((a, b) => a.path.localeCompare(b.path)),
		totalHighlights: pages.reduce((sum, p) => sum + p.highlights.length, 0),
	}));

	await mergeVideoIntoGroups();

	// Reset nav if it points at something no longer present.
	const nav = currentNav;
	if (nav.type === 'domain' && !allDomainGroups.find(g => g.domain === nav.domain)) {
		currentNav = { type: 'all' };
	} else if (nav.type === 'page') {
		const group = allDomainGroups.find(g => g.domain === nav.domain);
		if (!group || !group.pages.find(p => p.url === nav.url)) currentNav = { type: 'all' };
	}
}

async function mergeVideoIntoGroups(): Promise<void> {
	const all = await loadAllVideoData();
	const byDomain = new Map<string, PageGroup[]>();
	for (const [url, data] of Object.entries(all)) {
		if (!data.items || data.items.length === 0) continue;
		let domain = 'youtube.com';
		try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep default */ }
		const highlights: HighlightEntry[] = data.items.map(item => ({
			url,
			data: {
				type: 'text', id: item.id, xpath: '', startOffset: 0, endOffset: 0,
				content: item.quote || '', notes: item.notes, color: item.color as HLColor | undefined,
				__video: item,
			} as unknown as AnyHighlightData,
		}));
		const pg: PageGroup = { url, path: '/watch', title: data.title, highlights };
		if (!byDomain.has(domain)) byDomain.set(domain, []);
		byDomain.get(domain)!.push(pg);
	}
	for (const [domain, pages] of byDomain) {
		let g = allDomainGroups.find(x => x.domain === domain);
		if (!g) { g = { domain, pages: [], totalHighlights: 0 }; allDomainGroups.push(g); }
		g.pages.push(...pages);
		g.totalHighlights += pages.reduce((s, p) => s + p.highlights.length, 0);
	}
}

// --- Filtering / search / sort ---

function matchesSearch(entry: HighlightEntry): boolean {
	if (!searchQueryHighlights) return true;
	const content = entry.data.content?.toLowerCase() || '';
	const notes = entry.data.notes?.join(' ').toLowerCase() || '';
	return content.includes(searchQueryHighlights) || notes.includes(searchQueryHighlights) || entry.url.toLowerCase().includes(searchQueryHighlights);
}

function getFilteredGroups(): DomainGroup[] {
	let groups: DomainGroup[];
	if (!searchQueryWebsites) {
		groups = [...allDomainGroups];
	} else {
		groups = allDomainGroups.filter(group => {
			const normalized = group.domain.replace(/^www\./, '');
			const siteName = domainSettingsMap[normalized]?.site?.toLowerCase() || '';
			return group.domain.toLowerCase().includes(searchQueryWebsites) || siteName.includes(searchQueryWebsites);
		});
	}
	return sortGroups(groups);
}

function newestTimestamp(group: DomainGroup): number {
	let max = 0;
	for (const page of group.pages) for (const h of page.highlights) { const t = parseInt(h.data.id) || 0; if (t > max) max = t; }
	return max;
}
function oldestTimestamp(group: DomainGroup): number {
	let min = Infinity;
	for (const page of group.pages) for (const h of page.highlights) { const t = parseInt(h.data.id) || Infinity; if (t < min) min = t; }
	return min;
}
function sortGroups(groups: DomainGroup[]): DomainGroup[] {
	switch (sortOrder) {
		case 'az': return groups.sort((a, b) => displayDomain(a.domain).localeCompare(displayDomain(b.domain)));
		case 'za': return groups.sort((a, b) => displayDomain(b.domain).localeCompare(displayDomain(a.domain)));
		case 'new': return groups.sort((a, b) => newestTimestamp(b) - newestTimestamp(a));
		case 'old': return groups.sort((a, b) => oldestTimestamp(a) - oldestTimestamp(b));
	}
}

// --- Tags (#tag/subtag tokens in comment notes; nested via slashes) ---

const NOTE_TAG_RE = /(^|\s)#([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)/g;

function tagsOfNotes(notes?: string[]): string[] {
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

function unitMatchesTagFilter(unit: RenderUnit): boolean {
	if (!activeTagFilter) return true;
	const tags = unit.entries.flatMap(e => tagsOfNotes(e.data.notes));
	return tags.some(t => t === activeTagFilter || t.startsWith(activeTagFilter + '/'));
}

// --- Render units ---

function collapseGroupsForRender(entries: { entry: HighlightEntry; pageUrl: string; domain: string; title?: string }[]): RenderUnit[] {
	const units: RenderUnit[] = [];
	const byKey = new Map<string, RenderUnit>();
	for (const e of entries) {
		const gid = e.entry.data.groupId;
		if (gid) {
			const key = `${e.pageUrl}::${gid}`;
			const existing = byKey.get(key);
			if (existing) { existing.entries.push(e.entry); continue; }
			const unit: RenderUnit = { entries: [e.entry], pageUrl: e.pageUrl, domain: e.domain, title: e.title };
			byKey.set(key, unit);
			units.push(unit);
		} else {
			units.push({ entries: [e.entry], pageUrl: e.pageUrl, domain: e.domain, title: e.title });
		}
	}
	return units;
}

// Units for one page, in stored order, after search + tag filters.
function unitsForPage(page: PageGroup, domain: string): RenderUnit[] {
	const entries = page.highlights
		.filter(matchesSearch)
		.map(h => ({ entry: h, pageUrl: page.url, domain, title: page.title }));
	return collapseGroupsForRender(entries).filter(unitMatchesTagFilter);
}

// Pages visible in the main pane for the current nav (+ their filtered unit counts).
function visiblePages(): { page: PageGroup; domain: string; units: RenderUnit[] }[] {
	const out: { page: PageGroup; domain: string; units: RenderUnit[] }[] = [];
	for (const group of getFilteredGroups()) {
		if (currentNav.type === 'domain' && currentNav.domain !== group.domain) continue;
		if (currentNav.type === 'page' && currentNav.domain !== group.domain) continue;
		for (const page of group.pages) {
			if (currentNav.type === 'page' && currentNav.url !== page.url) continue;
			const units = unitsForPage(page, group.domain);
			if (units.length === 0 && (searchQueryHighlights || activeTagFilter)) continue;
			out.push({ page, domain: group.domain, units });
		}
	}
	// Newest page first
	out.sort((a, b) => pageNewest(b.page) - pageNewest(a.page));
	return out;
}

function pageNewest(page: PageGroup): number {
	let max = 0;
	for (const h of page.highlights) { const t = parseInt(h.data.id) || 0; if (t > max) max = t; }
	return max;
}

// --- Navigation ---

function navigate(nav: NavSelection) {
	currentNav = nav;
	if (nav.type === 'domain' || nav.type === 'page') expandedSidebarDomains.add(nav.domain);
	if (nav.type === 'page') expandedPages.add(nav.url);
	updateUrlFromNav();
	render();
}

function updateUrlFromNav() {
	const params = new URLSearchParams();
	if (currentNav.type === 'domain') params.set('domain', currentNav.domain);
	else if (currentNav.type === 'page') { params.set('domain', currentNav.domain); params.set('url', currentNav.url); }
	const search = params.toString();
	window.history.replaceState({}, '', window.location.pathname + (search ? '?' + search : ''));
}

function readNavFromUrl(): NavSelection {
	const params = new URLSearchParams(window.location.search);
	const domain = params.get('domain')?.replace(/^www\./, '');
	const url = params.get('url');
	if (url && domain) return { type: 'page', domain, url };
	if (domain) return { type: 'domain', domain };
	return { type: 'all' };
}

// --- Top-level render ---

function render() {
	renderSidebar();
	renderTags();
	renderHeader();
	renderContent();
}

// --- Sidebar: sources (domain -> pages) ---

function renderSidebar() {
	const total = allDomainGroups.reduce((s, g) => s + g.totalHighlights, 0);
	$('hl-annotation-count').textContent = `${total.toLocaleString()} Annotation${total === 1 ? '' : 's'}`;

	const listEl = $('hl-source-list');
	listEl.replaceChildren();

	for (const group of getFilteredGroups()) {
		const isActive = (currentNav.type === 'domain' || currentNav.type === 'page') && currentNav.domain === group.domain;
		const expanded = expandedSidebarDomains.has(group.domain);

		const wrap = el('div', 'group');
		const row = el('a', 'flex items-center gap-md px-sm py-[6px] rounded-lg font-label-caps text-label-caps transition-colors cursor-pointer');
		if (isActive) {
			row.classList.add('font-bold');
			row.style.backgroundColor = ACCENT;
			row.style.color = '#fff';
		} else {
			row.classList.add('text-on-surface-variant', 'hover:bg-surface-container-high', 'hover:text-primary');
		}

		row.appendChild(faviconEl(group.domain, 'w-4 h-4' + (isActive ? ' brightness-0 invert' : '')));
		const name = el('span', 'flex-1', siteNameOrDomain(group.domain));
		row.appendChild(name);
		row.appendChild(el('span', 'text-[10px]' + (isActive ? '' : ' opacity-70'), String(group.totalHighlights)));
		row.appendChild(icon(expanded ? 'expand_more' : 'chevron_right', 'text-sm ml-xs' + (isActive || expanded ? '' : ' opacity-0 group-hover:opacity-100')));

		row.addEventListener('click', (e) => {
			if (e.ctrlKey || e.metaKey) { e.preventDefault(); window.open(`https://${group.domain}`, '_blank'); return; }
			if (expandedSidebarDomains.has(group.domain) && currentNav.type !== 'domain') {
				// already open, second click collapses
				expandedSidebarDomains.delete(group.domain);
			} else {
				expandedSidebarDomains.add(group.domain);
			}
			navigate({ type: 'domain', domain: group.domain });
		});
		wrap.appendChild(row);

		if (expanded) {
			const nested = el('div', 'ml-md mt-xs space-y-xs border-l border-outline-variant/10 pl-sm');
			for (const page of group.pages) {
				const pageActive = currentNav.type === 'page' && currentNav.url === page.url;
				const pl = el('a', 'flex items-center gap-sm px-sm py-[4px] rounded-lg transition-colors font-label-caps text-[11px] cursor-pointer');
				if (pageActive) { pl.classList.add('font-bold'); pl.style.color = ACCENT; }
				else pl.classList.add('text-on-surface-variant', 'hover:bg-surface-container-high', 'hover:text-primary');
				pl.appendChild(icon('description', 'text-[14px]'));
				pl.appendChild(el('span', 'flex-1 truncate', page.title || displayPath(page.path)));
				pl.title = page.url;
				pl.addEventListener('click', (e) => {
					e.stopPropagation();
					if (e.ctrlKey || e.metaKey) { e.preventDefault(); window.open(page.url, '_blank'); return; }
					navigate({ type: 'page', domain: group.domain, url: page.url });
				});
				nested.appendChild(pl);
			}
			wrap.appendChild(nested);
		}

		listEl.appendChild(wrap);
	}
}

// --- Sidebar: tags (nested parent/child) ---

function renderTags() {
	const panel = $('hl-tags-panel');
	const listEl = $('hl-tag-list');
	listEl.replaceChildren();

	// Count tags across everything currently in scope (nav + search), scoped
	// like the main pane but ignoring the active tag filter.
	const savedFilter = activeTagFilter;
	activeTagFilter = null;
	const units = visiblePages().flatMap(p => p.units);
	activeTagFilter = savedFilter;

	const counts = new Map<string, number>();
	for (const u of units) {
		const paths = new Set<string>();
		for (const t of new Set(u.entries.flatMap(e => tagsOfNotes(e.data.notes)))) {
			let path = '';
			for (const part of t.split('/')) { path = path ? `${path}/${part}` : part; paths.add(path); }
		}
		for (const p of paths) counts.set(p, (counts.get(p) || 0) + 1);
	}

	panel.style.display = counts.size ? '' : 'none';

	for (const path of [...counts.keys()].sort()) {
		const depth = path.split('/').length - 1;
		const active = activeTagFilter === path;
		const row = el('a', 'flex items-center gap-md px-sm py-[6px] rounded-lg transition-colors font-label-caps text-label-caps cursor-pointer');
		if (active) { row.classList.add('font-bold'); row.style.color = ACCENT; }
		else row.classList.add('text-on-surface-variant', 'hover:bg-surface-container-high', 'hover:text-primary');
		if (depth) row.style.paddingInlineStart = `${8 + depth * 16}px`;
		row.appendChild(icon('tag', 'text-[14px]'));
		row.appendChild(el('span', 'flex-1', depth ? path.slice(path.lastIndexOf('/') + 1) : path));
		row.appendChild(el('span', 'text-[10px] opacity-70', String(counts.get(path))));
		row.addEventListener('click', () => {
			activeTagFilter = activeTagFilter === path ? null : path;
			render();
		});
		listEl.appendChild(row);
	}
}

// --- Header: breadcrumb + title ---

function renderHeader() {
	const crumb = $('hl-breadcrumb');
	crumb.replaceChildren();
	const nav = currentNav;

	const allLink = el('span', 'hover:text-on-surface cursor-pointer transition-colors', 'All sources');
	allLink.addEventListener('click', () => navigate({ type: 'all' }));
	crumb.appendChild(allLink);

	if (nav.type === 'all') return;

	crumb.appendChild(icon('chevron_right', 'text-[14px]'));
	const domainCrumb = el('span', 'flex items-center gap-xs cursor-pointer');
	domainCrumb.style.color = ACCENT;
	domainCrumb.appendChild(icon('description', 'text-[14px]'));
	domainCrumb.appendChild(el('span', '', siteNameOrDomain(nav.domain)));
	domainCrumb.addEventListener('click', () => navigate({ type: 'domain', domain: nav.domain }));
	crumb.appendChild(domainCrumb);

	if (nav.type === 'page') {
		const page = pageForNav();
		crumb.appendChild(icon('chevron_right', 'text-[14px]'));
		crumb.appendChild(el('span', 'text-on-surface', page?.title || displayPath(page?.path || '')));
	}
}

function pageForNav(): PageGroup | undefined {
	const nav = currentNav;
	if (nav.type !== 'page') return undefined;
	return allDomainGroups.find(g => g.domain === nav.domain)?.pages.find(p => p.url === nav.url);
}

// --- Content: collapsible page items with annotation cards ---

function renderContent() {
	const contentEl = $('hl-content');
	const emptyEl = $('hl-empty');
	contentEl.replaceChildren();

	const pages = visiblePages();
	if (pages.length === 0) {
		emptyEl.style.display = '';
		contentEl.style.display = 'none';
		return;
	}
	emptyEl.style.display = 'none';
	contentEl.style.display = '';

	for (const { page, domain, units } of pages) {
		contentEl.appendChild(createPageItem(page, domain, units));
	}
}

function createPageItem(page: PageGroup, domain: string, units: RenderUnit[]): HTMLElement {
	const expanded = expandedPages.has(page.url) || currentNav.type === 'page';
	const count = units.reduce((s, u) => s + u.entries.length, 0);
	const latest = pageNewest(page);

	if (!expanded) {
		const card = el('div', 'border border-outline-variant/20 rounded-xl bg-surface-container-lowest p-md hover:border-outline-variant/50 transition-colors cursor-pointer flex justify-between items-center');
		const left = el('div', 'flex items-center gap-md');
		const iconBox = el('div', 'w-10 h-10 bg-surface-container-highest rounded-lg flex items-center justify-center border border-outline-variant/10');
		iconBox.appendChild(faviconEl(domain, 'w-5 h-5'));
		left.appendChild(iconBox);
		const meta = el('div');
		meta.appendChild(el('h3', 'font-body-main text-body-main text-on-surface font-semibold', page.title || displayPath(page.path)));
		const sub = latest ? `${count} Annotation${count === 1 ? '' : 's'} • ${dayjs(latest).fromNow()}` : `${count} Annotation${count === 1 ? '' : 's'}`;
		meta.appendChild(el('p', 'font-label-caps text-label-caps text-on-surface-variant mt-xs', sub));
		left.appendChild(meta);
		card.appendChild(left);
		card.appendChild(icon('chevron_right', 'text-on-surface-variant'));
		card.addEventListener('click', () => { expandedPages.add(page.url); renderContent(); });
		return card;
	}

	// Expanded
	const card = el('div', 'border border-outline-variant/20 rounded-xl bg-surface-container-lowest p-md');
	const header = el('div', 'flex justify-between items-start mb-lg border-b border-outline-variant/10 pb-md');
	const left = el('div', 'flex items-center gap-md');
	const iconBox = el('div', 'w-10 h-10 rounded-lg flex items-center justify-center border');
	iconBox.style.backgroundColor = 'rgba(140,115,250,0.1)';
	iconBox.style.borderColor = 'rgba(140,115,250,0.2)';
	iconBox.appendChild(faviconEl(domain, 'w-5 h-5'));
	left.appendChild(iconBox);
	const titleBox = el('div');
	titleBox.appendChild(el('h3', 'font-body-main text-body-main text-on-surface font-bold text-lg', page.title || displayPath(page.path)));
	const urlLink = el('a', 'font-label-caps text-label-caps hover:opacity-80 mt-xs flex items-center gap-xs');
	urlLink.style.color = ACCENT;
	urlLink.href = page.url;
	urlLink.target = '_blank';
	urlLink.appendChild(el('span', '', prettyUrl(page.url)));
	urlLink.appendChild(icon('open_in_new', 'text-[12px]'));
	titleBox.appendChild(urlLink);
	left.appendChild(titleBox);
	header.appendChild(left);
	const collapseBtn = icon('expand_less', 'text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors');
	collapseBtn.addEventListener('click', () => {
		expandedPages.delete(page.url);
		if (currentNav.type === 'page') navigate({ type: 'domain', domain });
		else renderContent();
	});
	header.appendChild(collapseBtn);
	card.appendChild(header);

	const list = el('div', 'space-y-lg');
	for (const unit of units) list.appendChild(createAnnotationCard(unit));
	card.appendChild(list);
	return card;
}

// Reply fields start hidden; clicking anywhere on an annotation card reveals that
// card's reply editor (and focuses it), while clicking elsewhere re-hides every
// reply that has no draft text. Mirrors the live comment box's focus-gated editor.
function setupReplyFocusHandling() {
	document.addEventListener('click', (e) => {
		const card = (e.target as HTMLElement).closest('.hl-card');
		document.querySelectorAll<HTMLElement>('.hl-reply').forEach(reply => {
			if (card && card.contains(reply)) {
				if (reply.classList.contains('hidden')) {
					reply.classList.remove('hidden');
					reply.querySelector<HTMLTextAreaElement>('textarea')?.focus();
				}
			} else {
				const ta = reply.querySelector<HTMLTextAreaElement>('textarea');
				if (!ta || !ta.value.trim()) reply.classList.add('hidden');
			}
		});
	});
}

// A jump-to-moment chip linking to `…?t=Ns`. `overlay` styles it to sit over a
// frame image; otherwise it's an inline pill.
function videoTimeChip(atUrl: string, label: string, overlay = false): HTMLAnchorElement {
	const a = el('a', overlay
		? 'absolute bottom-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-white text-[11px] font-label-caps hover:bg-black/85 transition-colors'
		: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant text-[11px] font-label-caps hover:text-on-surface transition-colors');
	a.href = atUrl;
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	a.title = 'Open at this moment';
	a.appendChild(icon('play_arrow', 'text-[14px]'));
	a.appendChild(el('span', '', label));
	return a;
}

// The media block for a video annotation: a captured frame with its markup
// repainted on top, a colored transcript highlight, or a bare timestamp chip.
function createVideoMedia(item: VideoItem, pageUrl: string): HTMLElement {
	const atUrl = `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}t=${Math.floor(item.videoTime)}s`;
	const stamp = formatVideoTime(item.videoTime);

	if (item.kind === 'frame' && item.frame) {
		const fig = el('div', 'relative rounded-lg overflow-hidden border border-outline-variant/20');
		const img = el('img', 'block w-full');
		img.loading = 'lazy';
		if (item.frame.dataUrl) img.src = item.frame.dataUrl;
		else loadFrameImage(item.id).then(u => { if (u) img.src = u; });
		fig.appendChild(img);
		if (item.markup) {
			const overlay = el('div', 'absolute inset-0 pointer-events-none');
			const svg = renderMarkupSvg(item.markup, item.frame.w, item.frame.h);
			svg.setAttribute('style', 'width:100%;height:100%;display:block;');
			overlay.appendChild(svg);
			fig.appendChild(overlay);
		}
		fig.appendChild(videoTimeChip(atUrl, stamp, true));
		return fig;
	}

	if (item.kind === 'transcript' && item.quote) {
		const c = (item.color as HLColor) || 'yellow';
		const wrap = el('div', 'space-y-xs');
		const q = el('p', `font-body-reading text-body-reading text-on-surface/90 italic border-l-2 pl-md py-sm pr-sm rounded-r-md ${COLOR[c].quote}`);
		q.textContent = item.quote;
		wrap.appendChild(q);
		const range = item.timeEnd != null ? `${stamp}–${formatVideoTime(item.timeEnd)}` : stamp;
		wrap.appendChild(videoTimeChip(atUrl, range));
		return wrap;
	}

	// Frameless timestamped note — just the jump-to-moment chip.
	return videoTimeChip(atUrl, stamp);
}

function createAnnotationCard(unit: RenderUnit): HTMLElement {
	const first = unit.entries[0].data;
	const isVideo = !!(first as VideoCarrier).__video;
	const pageUrl = unit.pageUrl;

	const outer = el('div', 'relative group hl-card');
	// The card leaves a right-hand gutter (mr-9); its content stays full-width and
	// aligned on both edges. The delete lives in that gutter, never over the text.
	const card = el('div', 'bg-surface-container p-md mr-9 rounded-lg border border-outline-variant/10 shadow-sm transition-all hover:border-outline-variant/30 flex flex-col');

	// Annotation-level delete (removes the annotation and all its comments),
	// revealed on card hover, sitting in the gutter beside the card.
	const threadDel = el('button', 'absolute top-2 right-0 p-1 rounded-md hover:bg-error-container opacity-0 group-hover:opacity-100 transition-opacity');
	threadDel.title = 'Delete annotation and all its comments';
	threadDel.appendChild(icon('delete', 'text-[18px] text-on-surface-variant hover:text-error'));
	threadDel.addEventListener('click', async () => {
		if (!confirm('Delete this annotation and all its comments?')) return;
		if (isVideo) { await removeVideoItem(pageUrl, first.id); return; }
		for (const e of unit.entries) await deleteHighlight(pageUrl, e.data.id);
	});
	outer.appendChild(threadDel);

	if (isVideo) {
		// Video annotation: render its frame (+ markup), transcript highlight, or a
		// jump-to-moment chip — see createVideoMedia.
		card.appendChild(createVideoMedia((first as VideoCarrier).__video!, pageUrl));
	} else {
		// Quotes (one per entry; grouped selections separated by a divider)
		const quotes = el('div', 'space-y-sm');
		unit.entries.forEach((entry, i) => {
			const c = (entry.data.color as HLColor) || 'yellow';
			const q = el('p', `font-body-reading text-body-reading text-on-surface/90 italic border-l-2 pl-md py-sm pr-sm rounded-r-md ${COLOR[c].quote}`);
			const content = entry.data.content || '';
			if (content) q.replaceChildren(DOMPurify.sanitize(content, { RETURN_DOM_FRAGMENT: true }));
			quotes.appendChild(q);
			if (i < unit.entries.length - 1) {
				const div = el('div', 'flex items-center justify-center py-xs');
				div.appendChild(icon('more_vert', 'text-outline-variant text-[16px]'));
				quotes.appendChild(div);
			}
		});
		card.appendChild(quotes);
	}

	// Comment thread — each comment carries per-comment edit + delete (video
	// annotations keep their notes elsewhere, so they're read-only here).
	const thread = el('div', 'mt-md space-y-sm');
	for (const entry of unit.entries) {
		const vid = (entry.data as VideoCarrier).__video ?? null;
		(entry.data.notes ?? []).forEach((note, noteIndex) => {
			const clean = note.replace(/<!--timestamp:\d+-->/, '').replace(/<!--edited:\d+-->/, '').trim();
			if (!clean) return;
			thread.appendChild(createCommentRow(pageUrl, entry.data.id, noteIndex, note, clean, vid));
		});
	}

	// Reply / add-comment field — same sleek editor as the inline edit box. Hidden
	// (.hl-reply.hidden) until the card is clicked; a document listener toggles it
	// and re-hides on outside click (see setupReplyFocusHandling). Suppressed while
	// a comment in this card is being edited, matching the live box.
	const editingInUnit = editingComment !== null &&
		unit.entries.some(e => editingComment!.startsWith(`${pageUrl}::${e.data.id}::`));
	if (!editingInUnit) {
		const videoItem = isVideo ? (first as VideoCarrier).__video! : null;
		const hasComments = unit.entries.some(e => (e.data.notes ?? []).some(n =>
			n.replace(/<!--[^>]*-->/g, '').trim()));
		const replyBox = createSleekEditor({
			placeholder: hasComments ? 'Reply…' : 'Add a comment…',
			onSubmit: (text) => videoItem
				? addVideoNote(pageUrl, videoItem, text)
				: addNote(pageUrl, first.id, text),
		});
		replyBox.classList.add('mt-sm', 'hl-reply', 'hidden');
		thread.appendChild(replyBox);
	}
	card.appendChild(thread);

	outer.appendChild(card);
	return outer;
}

// A single comment row: timestamp + inline edit/delete (revealed on row hover),
// with the body swapped for an editor when this comment is being edited.
function createCommentRow(pageUrl: string, highlightId: string, noteIndex: number, note: string, clean: string, video: VideoItem | null): HTMLElement {
	const key = `${pageUrl}::${highlightId}::${noteIndex}`;
	const editing = editingComment === key;
	// Excalidraw diagram comment: the note body is just <!--diagram:ID-->; the image
	// lives in IndexedDB. Rendered as an image (not editable, but deletable).
	const diagramId = clean.match(/^<!--diagram:([A-Za-z0-9_-]+)-->$/)?.[1] ?? null;

	const row = el('div', 'group/comment');

	const header = el('div', 'flex items-center gap-sm mb-0.5');
	const tsMatch = note.match(/<!--timestamp:(\d+)-->/);
	const edited = /<!--edited:\d+-->/.test(note);
	if (tsMatch) {
		let timeStr = dayjs(parseInt(tsMatch[1], 10)).fromNow();
		if (edited) timeStr += ' (edited)';
		header.appendChild(el('span', 'font-label-caps text-label-caps text-on-surface-variant text-[10px]', timeStr));
	}
	if (!editing) {
		const actions = el('div', 'flex items-center gap-xs ml-auto opacity-0 group-hover/comment:opacity-100 transition-opacity');
		if (!diagramId) {
			const editBtn = el('button', 'p-0.5 rounded hover:bg-surface-variant transition-colors');
			editBtn.title = 'Edit comment';
			editBtn.appendChild(icon('edit', 'text-[16px] text-on-surface-variant hover:text-on-surface'));
			editBtn.addEventListener('click', () => { editingComment = key; renderContent(); });
			actions.appendChild(editBtn);
		}
		const delBtn = el('button', 'p-0.5 rounded hover:bg-error-container transition-colors');
		delBtn.title = 'Delete comment';
		delBtn.appendChild(icon('close', 'text-[16px] text-on-surface-variant hover:text-error'));
		delBtn.addEventListener('click', async () => {
			if (video) await deleteVideoNote(pageUrl, video, noteIndex);
			else await deleteNote(pageUrl, highlightId, noteIndex);
		});
		actions.appendChild(delBtn);
		header.appendChild(actions);
	}
	row.appendChild(header);

	if (diagramId) {
		const img = el('img', 'rounded-lg border border-outline-variant/20 max-w-full cursor-pointer bg-white');
		img.alt = 'Diagram';
		img.title = 'Open diagram';
		loadDiagramImage(diagramId).then(src => { if (src) img.src = src; });
		img.addEventListener('click', () => {
			browser.runtime.sendMessage({ action: 'openPopupWithDiagram', id: diagramId });
		});
		row.appendChild(img);
	} else if (editing) {
		const editor = createSleekEditor({
			value: clean,
			placeholder: 'Edit comment…',
			autofocus: true,
			onSubmit: async (text) => {
				editingComment = null;
				if (text && text !== clean) {
					if (video) await editVideoNote(pageUrl, video, noteIndex, text);
					else await editNote(pageUrl, highlightId, noteIndex, text);
				} else renderContent();
			},
			onCancel: () => { editingComment = null; renderContent(); },
		});
		row.appendChild(editor);
	} else {
		const p = el('p', 'font-body-main text-[19px] leading-[1.4] tracking-[-0.01em] text-on-surface break-words');
		p.appendChild(renderCommentText(clean));
		// Ticking a checklist item edits the comment, so the state persists and syncs.
		p.addEventListener('click', async (e) => {
			const box = (e.target as HTMLElement).closest('.ob-md-check');
			if (!box) return;
			const nth = Array.from(p.querySelectorAll('.ob-md-check')).indexOf(box);
			if (nth < 0) return;
			const next = toggleTaskInMarkdown(clean, nth);
			if (video) await editVideoNote(pageUrl, video, noteIndex, next);
			else await editNote(pageUrl, highlightId, noteIndex, next);
		});
		row.appendChild(p);
	}
	return row;
}

// Class the shared renderer hangs on `#tag` pills here — same look as the live
// comment box's .obsidian-inline-tag, expressed in the dashboard's utility classes.
const TAG_PILL_CLASS = 'text-[#a78bfa] bg-[#8c73fa]/25 rounded px-1 py-px font-medium';

// A comment body, rendered with the same markdown subset as the live page: bold,
// italic, links, bullet and task lists, `#tag` pills, and pasted images (whose bytes
// live in IndexedDB, so they're filled in once loaded).
function renderCommentText(text: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	for (const part of text.split(/(<!--image:[A-Za-z0-9_-]+-->)/g)) {
		if (!part) continue;
		const imageId = part.match(/^<!--image:([A-Za-z0-9_-]+)-->$/)?.[1];
		if (imageId) {
			const img = el('img', 'ob-md-image rounded-lg border border-outline-variant/20 max-w-full my-1');
			img.alt = 'Pasted image';
			loadDiagramImage(imageId).then(src => { if (src) (img as HTMLImageElement).src = src; });
			frag.appendChild(img);
			continue;
		}
		const holder = el('div', 'ob-md-body');
		// Sanitized: the renderer emits only its own tags, but the text came from a
		// synced record, so it goes through DOMPurify like every other body here.
		holder.replaceChildren(DOMPurify.sanitize(
			commentTextToDisplayHtml(part, { tagClass: TAG_PILL_CLASS }),
			{ RETURN_DOM_FRAGMENT: true },
		));
		frag.appendChild(holder);
	}
	return frag;
}

// Formatting buttons, matching the live comment box's editor row.
const FORMAT_BUTTONS: { command: CommentFormatCommand; label: string; glyph: string }[] = [
	{ command: 'bullet', label: 'Bullet list', glyph: 'format_list_bulleted' },
	{ command: 'task', label: 'Checklist', glyph: 'checklist' },
	{ command: 'bold', label: 'Bold (Ctrl+B)', glyph: 'format_bold' },
	{ command: 'italic', label: 'Italic (Ctrl+I)', glyph: 'format_italic' },
];

// A comment editor styled after the live-page reply box (elevated surface, subtle
// border, auto-growing field, round submit affordance that lights up purple when
// there's text). Used for both replies and inline edits.
//
// The field is a contenteditable, not a textarea, so it shows real formatting while
// you type — the same WYSIWYG editor as the live page, over the same markdown.
function createSleekEditor(opts: {
	value?: string;
	placeholder?: string;
	autofocus?: boolean;
	onSubmit: (text: string) => void | Promise<void>;
	onCancel?: () => void;
}): HTMLElement {
	// Borderless filled field; a purple ring appears only on focus (focus-within).
	const wrap = el('div', 'bg-surface-container-high rounded-xl transition-shadow focus-within:ring-1 focus-within:ring-[#8c73fa] px-3.5 py-2.5');
	const field = el('div', 'ob-md-body w-full bg-transparent outline-none text-[19px] leading-[1.4] tracking-[-0.01em] text-on-surface font-body-main break-words');
	field.contentEditable = 'true';
	field.dataset.placeholder = opts.placeholder || '';
	if (opts.value) {
		field.replaceChildren(DOMPurify.sanitize(
			commentTextToEditableHtml(opts.value), { RETURN_DOM_FRAGMENT: true }));
	}

	const actions = el('div', 'flex items-center justify-between gap-sm mt-1.5');
	const formatBar = el('div', 'flex items-center gap-0.5');
	const formatButtons = FORMAT_BUTTONS.map(({ command, label, glyph }) => {
		const btn = el('button', 'flex items-center justify-center w-6 h-6 rounded transition-colors text-on-surface-variant hover:bg-surface-variant');
		btn.title = label;
		btn.dataset.format = command;
		btn.appendChild(icon(glyph, 'text-[16px]'));
		// mousedown default would blur the field, and the editing commands act on the
		// live selection.
		btn.addEventListener('mousedown', (e) => e.preventDefault());
		btn.addEventListener('click', (e) => {
			e.preventDefault();
			applyCommentFormat(field, command);
			syncFormats();
		});
		formatBar.appendChild(btn);
		return btn;
	});

	// Round submit chip that fills purple once there's text to send.
	const submit = el('button', 'flex items-center justify-center w-6 h-6 rounded-full transition-colors shrink-0');
	submit.appendChild(icon('arrow_upward', 'text-[14px]'));
	actions.append(formatBar, submit);

	const value = () => serializeCommentEditor(field).trim();
	const syncSubmit = () => {
		const has = value().length > 0;
		submit.style.backgroundColor = has ? ACCENT : 'rgba(255,255,255,0.08)';
		submit.style.color = has ? '#fff' : 'rgba(196,199,200,0.9)';
		field.classList.toggle('is-empty', !has);
	};
	const syncFormats = () => {
		const active = activeCommentFormats(field);
		formatButtons.forEach(btn => {
			const on = active.has(btn.dataset.format as CommentFormatCommand);
			btn.classList.toggle('bg-[#8c73fa]/20', on);
			btn.classList.toggle('text-[#a78bfa]', on);
			btn.classList.toggle('text-on-surface-variant', !on);
		});
	};
	const doSubmit = async () => {
		const val = value();
		if (!val) { opts.onCancel?.(); return; }
		field.replaceChildren();
		syncSubmit();
		await opts.onSubmit(val);
	};

	field.addEventListener('input', () => { syncSubmit(); syncFormats(); });
	field.addEventListener('keyup', syncFormats);
	field.addEventListener('mouseup', syncFormats);
	field.addEventListener('click', (e) => {
		if (toggleTaskFromClick(e.target as HTMLElement)) syncSubmit();
	});
	field.addEventListener('keydown', (e) => {
		if ((e.ctrlKey || e.metaKey) && ['b', 'i'].includes(e.key.toLowerCase())) {
			e.preventDefault();
			applyCommentFormat(field, e.key.toLowerCase() === 'b' ? 'bold' : 'italic');
			syncFormats();
			return;
		}
		// Enter submits; Shift+Enter is a newline. Inside a list, Enter belongs to the
		// list (it starts the next item) — that's what makes typing bullets natural.
		const inList = !!(window.getSelection()?.anchorNode as Element | null)?.parentElement?.closest('li');
		if (e.key === 'Enter' && !e.shiftKey && !inList) { e.preventDefault(); doSubmit(); }
		else if (e.key === 'Escape' && opts.onCancel) { e.preventDefault(); opts.onCancel(); }
	});
	submit.addEventListener('click', doSubmit);

	wrap.append(field, actions);
	queueMicrotask(() => {
		syncSubmit();
		syncFormats();
		if (opts.autofocus) {
			field.focus();
			const range = document.createRange();
			range.selectNodeContents(field);
			range.collapse(false);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
		}
	});
	return wrap;
}

// --- Favicon ---

function faviconEl(domain: string, className: string): HTMLElement {
	const normalized = domain.replace(/^www\./, '');
	const src = domainSettingsMap[normalized]?.favicon;
	if (src) {
		const img = el('img', className);
		(img as HTMLImageElement).src = src;
		(img as HTMLImageElement).referrerPolicy = 'no-referrer';
		img.addEventListener('error', () => img.replaceWith(icon('public', className)));
		return img;
	}
	return icon('public', className);
}

// --- Export / delete ---

async function exportCurrentContext() {
	const pages = visiblePages();
	if (pages.length === 0) return;
	const exportData = pages.map(({ page, units }) => ({
		url: page.url,
		highlights: collapseGroupsForExport(units.flatMap(u => u.entries).map(e => e.data)),
	}));
	const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
	const blobUrl = URL.createObjectURL(blob);
	const browserType = await detectBrowser();
	const fileName = `obsidian-web-clipper-highlights-${dayjs().format('YYYYMMDDHHmm')}.json`;
	if (browserType === 'safari' || browserType === 'mobile-safari') {
		if (navigator.share) {
			try { await navigator.share({ files: [new File([blob], fileName, { type: 'application/json' })], title: 'Exported Highlights' }); }
			catch { window.open(blobUrl); }
		} else window.open(blobUrl);
	} else {
		const a = el('a');
		a.href = blobUrl; a.download = fileName;
		document.body.appendChild(a); a.click(); document.body.removeChild(a);
	}
	URL.revokeObjectURL(blobUrl);
}

async function deleteCurrentContext() {
	const nav = currentNav;
	if (nav.type === 'all') {
		if (!confirm('Delete ALL annotations?')) return;
		await clearAll('hl');
	} else if (nav.type === 'domain') {
		if (!confirm(`Delete all annotations for ${siteNameOrDomain(nav.domain)}?`)) return;
		const group = allDomainGroups.find(g => g.domain === nav.domain);
		if (group) for (const page of group.pages) await removePage('hl', page.url);
	} else if (nav.type === 'page') {
		if (!confirm('Delete all annotations for this page?')) return;
		await removePage('hl', nav.url);
	}
}

// --- Storage mutations ---

async function deleteHighlight(url: string, highlightId: string) {
	const stored = await getPage<StoredData>('hl', url);
	if (!stored) return;
	stored.highlights = stored.highlights.filter(h => h.id !== highlightId);
	if (stored.highlights.length === 0) await removePage('hl', url);
	else await setPage<StoredData>('hl', url, stored);
}

async function addNote(url: string, highlightId: string, text: string) {
	const stored = await getPage<StoredData>('hl', url);
	if (!stored) return;
	const h = stored.highlights.find(x => x.id === highlightId);
	if (!h) return;
	h.notes = h.notes || [];
	h.notes.push(`${text}<!--timestamp:${Date.now()}-->`);
	await setPage<StoredData>('hl', url, stored);
}

// --- Video comment mutations (parity with the on-page video panel) ---
// Video notes live in the 'va' store, so these route through the video APIs
// instead of the 'hl' page store, matching video-comments.ts exactly.

async function addVideoNote(watchUrl: string, item: VideoItem, text: string) {
	await updateVideoItemNotes(watchUrl, item.id, [...item.notes, makeVideoNote(text, Date.now())]);
}

async function editVideoNote(watchUrl: string, item: VideoItem, index: number, text: string) {
	const ts = item.notes[index]?.match(/<!--timestamp:(\d+)-->/)?.[1] ?? String(Date.now());
	const notes = item.notes.slice();
	notes[index] = `<!--timestamp:${ts}--><!--edited:${Date.now()}-->\n\n${text}`;
	await updateVideoItemNotes(watchUrl, item.id, notes);
}

async function deleteVideoNote(watchUrl: string, item: VideoItem, index: number) {
	const notes = item.notes.slice();
	notes.splice(index, 1);
	// A comment-only ('note') item with no comments left has nothing to show —
	// remove the whole item, mirroring the on-page panel.
	if (notes.length === 0 && item.kind === 'note') await removeVideoItem(watchUrl, item.id);
	else await updateVideoItemNotes(watchUrl, item.id, notes);
}

// Edit one comment in place: keep its original creation timestamp (the comment's
// stable id) but stamp a fresh edit time, mirroring the live comment editor.
async function editNote(url: string, highlightId: string, noteIndex: number, text: string) {
	const stored = await getPage<StoredData>('hl', url);
	if (!stored) return;
	const h = stored.highlights.find(x => x.id === highlightId);
	if (!h || !h.notes || !h.notes[noteIndex]) return;
	const ts = h.notes[noteIndex].match(/<!--timestamp:(\d+)-->/)?.[1] ?? String(Date.now());
	h.notes[noteIndex] = `${text}<!--timestamp:${ts}--><!--edited:${Date.now()}-->`;
	await setPage<StoredData>('hl', url, stored);
}

// Delete a single comment. The annotation (highlight) itself stays.
async function deleteNote(url: string, highlightId: string, noteIndex: number) {
	const stored = await getPage<StoredData>('hl', url);
	if (!stored) return;
	const h = stored.highlights.find(x => x.id === highlightId);
	if (!h || !h.notes) return;
	h.notes.splice(noteIndex, 1);
	await setPage<StoredData>('hl', url, stored);
}

// --- Helpers ---

function displayDomain(domain: string): string { return domain.replace(/^www\./, ''); }
function siteNameOrDomain(domain: string): string {
	const normalized = domain.replace(/^www\./, '');
	return domainSettingsMap[normalized]?.site || normalized;
}
function displayPath(path: string): string { return decodeURIComponent(path).replace(/^\//, '') || '/'; }
function prettyUrl(url: string): string {
	try { const u = new URL(url); return u.hostname.replace(/^www\./, '') + u.pathname; } catch { return url; }
}
