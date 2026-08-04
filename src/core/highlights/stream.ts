import { $, button, el, favicon, icon, menuButton, MenuItem, tip } from './ui';
import { anyFilterActive, clearFilters, render, renderStream, state } from './store';
import { colorOf, pageOldest, pageStamp, siteName, statsFor, tagsOfUnit, visiblePages } from './data';
import { formatSpan, pageLabel, plural, prettyUrl } from './format';
import { createCard } from './card';
import { copyUnitsMarkdown, deletePage, deleteUnits } from './actions';
import { renderHome } from './home';
import { RenderUnit, VisiblePage } from './types';
import { navigate } from './nav';

/**
 * The stream: a flat feed of annotation cards under sticky per-page headers.
 *
 * Two things make it hold up on a large library:
 *  - **Keyed reuse.** Cards are rebuilt only when their own content changes, so a
 *    storage event from your own comment never resets scroll, hover or focus.
 *  - **Lazy sections.** A page's cards are built the first time that page scrolls
 *    near the viewport, so opening the dashboard is instant no matter the size.
 */

interface Section {
	root: HTMLElement;
	/** The sticky page header (or, scoped to one page, its hero). */
	head: HTMLElement | null;
	list: HTMLElement;
	vp: VisiblePage;
	built: boolean;
	/** unit key → rendered card, with the signature it was rendered from. */
	cards: Map<string, { node: HTMLElement; signature: string }>;
}

const sections = new Map<string, Section>();
let observer: IntersectionObserver | null = null;
let homeNode: HTMLElement | null = null;
let homeKey = '';

/** Everything a card's appearance depends on — its cache key. */
function signatureOf(unit: RenderUnit): string {
	const parts: string[] = [];
	for (const entry of unit.entries) {
		parts.push(entry.data.id, colorOf(entry.data), String((entry.data as { updatedAt?: number }).updatedAt || ''));
		parts.push(String(entry.data.content?.length || 0));
		parts.push(...(entry.data.notes ?? []));
	}
	parts.push(
		state.selection.has(unit.key) ? 's' : '',
		state.cursor === unit.key ? 'c' : '',
		state.expandedQuotes.has(unit.key) ? 'q' : '',
		state.replyOpen.has(unit.key) ? 'r' : '',
		state.editingComment?.startsWith(`${unit.pageUrl}::`) ? state.editingComment : '',
		state.filters.query,
	);
	return parts.join('\u0001');
}

/**
 * Make `parent`'s children exactly `nodes`, in that order, touching only what is
 * actually wrong. Anything already in position keeps its DOM identity — and so its
 * focus, its caret and its hover state.
 *
 * Stale children are dropped *first*: leaving them in place would make every later
 * comparison mismatch, and the walk would then move (detach and re-attach) every
 * remaining node — silently blowing away the focus inside one of them.
 */
function syncChildren(parent: HTMLElement, nodes: Node[]): void {
	const keep = new Set(nodes);
	for (const child of Array.from(parent.childNodes)) if (!keep.has(child)) child.remove();

	let cursor: Node | null = parent.firstChild;
	for (const node of nodes) {
		if (cursor === node) {
			cursor = node.nextSibling;
			continue;
		}
		parent.insertBefore(node, cursor);
	}
}

/** Does this card hold text that hasn't been saved yet? */
function hasDraft(card: HTMLElement): boolean {
	return Array.from(card.querySelectorAll<HTMLElement>('.sc-editor__field'))
		.some(field => (field.textContent || '').trim().length > 0);
}

// --- Selection ------------------------------------------------------------

function orderedUnits(): RenderUnit[] {
	return visiblePages().flatMap(p => p.units);
}

function toggleSelection(unitKey: string, range: boolean): void {
	const units = orderedUnits();
	if (range && state.selectionAnchor) {
		const from = units.findIndex(u => u.key === state.selectionAnchor);
		const to = units.findIndex(u => u.key === unitKey);
		if (from >= 0 && to >= 0) {
			const [lo, hi] = from < to ? [from, to] : [to, from];
			for (let i = lo; i <= hi; i++) state.selection.add(units[i].key);
			renderStream();
			return;
		}
	}
	if (state.selection.has(unitKey)) state.selection.delete(unitKey);
	else state.selection.add(unitKey);
	state.selectionAnchor = unitKey;
	renderStream();
}

export function clearSelection(): void {
	if (state.selection.size === 0) return;
	state.selection.clear();
	state.selectionAnchor = null;
	renderStream();
}

function renderSelectionBar(): void {
	const host = $('hl-selection');
	host.replaceChildren();
	const count = state.selection.size;
	host.classList.toggle('is-on', count > 0);
	if (count === 0) return;

	const selected = () => orderedUnits().filter(u => state.selection.has(u.key));
	host.appendChild(el('span', 'sc-selbar__count', `${count} selected`));
	const actions = el('div', 'sc-selbar__actions');
	actions.appendChild(button({
		label: 'Copy as Markdown', iconName: 'description', variant: 'quiet',
		onClick: () => copyUnitsMarkdown(selected(), `${plural(count, 'annotation')}`),
	}));
	actions.appendChild(button({
		label: 'Delete', iconName: 'delete', variant: 'danger',
		onClick: () => {
			const units = selected();
			state.selection.clear();
			state.selectionAnchor = null;
			void deleteUnits(units);
		},
	}));
	actions.appendChild(button({
		iconName: 'close', variant: 'quiet', tooltip: 'Clear selection', onClick: clearSelection,
	}));
	host.appendChild(actions);
}

// --- Page group header ----------------------------------------------------

function groupMenu(vp: VisiblePage): MenuItem[] {
	return [
		{
			type: 'item', label: 'Select all on this page', iconName: 'check_box',
			onSelect: () => {
				for (const u of vp.units) state.selection.add(u.key);
				renderStream();
			},
		},
		{
			type: 'item', label: 'Copy page as Markdown', iconName: 'description',
			onSelect: () => copyUnitsMarkdown(vp.units, 'Page'),
		},
		{ type: 'sep' },
		{
			type: 'item', label: 'Delete this page’s annotations', iconName: 'delete', danger: true,
			onSelect: () => { void deletePage(vp.page.url); },
		},
	];
}

function groupHeader(vp: VisiblePage): HTMLElement {
	const { page, domain, units } = vp;
	const site = siteName(domain);
	const collapsed = state.collapsedPages.has(page.url);
	const header = el('div', 'sc-group__head');

	const toggle = el('button', 'sc-group__toggle');
	toggle.type = 'button';
	toggle.setAttribute('aria-expanded', String(!collapsed));
	toggle.appendChild(favicon(state.domainSettings[domain]?.favicon, 16));

	const label = el('span', 'sc-group__label');
	const title = el('span', 'sc-group__title', pageLabel(page.title, page.path, domain, site));
	if (page.title) tip(title, page.title);
	label.appendChild(title);
	label.appendChild(el('span', 'sc-group__url', prettyUrl(page.url, 52)));
	toggle.appendChild(label);
	toggle.addEventListener('click', () => {
		if (collapsed) state.collapsedPages.delete(page.url);
		else state.collapsedPages.add(page.url);
		renderStream();
	});
	header.appendChild(toggle);

	const count = el('span', 'sc-count', String(units.length));
	tip(count, plural(units.length, 'annotation'));
	header.appendChild(count);

	// Disclosure sits at the trailing edge so the title can start flush with the
	// annotation text below it — one left edge for the whole column.
	const twist = el('span', 'sc-group__chevron');
	twist.appendChild(icon('expand_more'));
	toggle.appendChild(twist);

	const open = el('a', 'sc-btn sc-btn--ghost sc-btn--icon');
	open.href = page.url;
	open.target = '_blank';
	open.rel = 'noopener noreferrer';
	tip(open, 'Open this page');
	open.appendChild(icon('open_in_new'));
	header.appendChild(open);
	header.appendChild(menuButton(
		button({ iconName: 'more_horiz', tooltip: 'Page actions' }), () => groupMenu(vp)));
	return header;
}

/** When the view is scoped to one page, its header becomes a proper hero. */
function pageHero(vp: VisiblePage): HTMLElement {
	const { page, domain, units } = vp;
	const site = siteName(domain);
	const stats = statsFor([vp]);
	const hero = el('header', 'sc-hero');

	const top = el('div', 'sc-hero__top');
	top.appendChild(favicon(state.domainSettings[domain]?.favicon, 16));
	const siteLink = el('button', 'sc-hero__site', site);
	siteLink.type = 'button';
	siteLink.addEventListener('click', () => navigate({ type: 'domain', domain }));
	top.appendChild(siteLink);
	hero.appendChild(top);

	hero.appendChild(el('h1', 'sc-hero__title', pageLabel(page.title, page.path, domain, site)));

	const link = el('a', 'sc-hero__url');
	link.href = page.url;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.appendChild(el('span', '', prettyUrl(page.url, 96)));
	link.appendChild(icon('open_in_new'));
	hero.appendChild(link);

	const facts: string[] = [plural(units.length, 'annotation')];
	if (stats.comments) facts.push(plural(stats.comments, 'comment'));
	if (stats.drawings) facts.push(plural(stats.drawings, 'stroke'));
	const span = formatSpan(pageOldest(page), pageStamp(page));
	if (span) facts.push(span);
	hero.appendChild(el('p', 'sc-hero__facts', facts.join(' · ')));

	const tags = [...new Set(units.flatMap(tagsOfUnit))].sort();
	if (tags.length) {
		const row = el('div', 'sc-hero__tags');
		for (const tag of tags) {
			const chip = el('button', `sc-chip${state.filters.tag === tag ? ' is-on' : ''}`);
			chip.type = 'button';
			chip.textContent = `#${tag}`;
			chip.addEventListener('click', () => {
				state.filters.tag = state.filters.tag === tag ? null : tag;
				render();
			});
			row.appendChild(chip);
		}
		hero.appendChild(row);
	}
	return hero;
}

// --- Section building ----------------------------------------------------

function buildCards(section: Section): void {
	const { list, vp } = section;
	const wanted = vp.units;
	const next = new Map<string, { node: HTMLElement; signature: string }>();

	for (const unit of wanted) {
		const signature = signatureOf(unit);
		const existing = section.cards.get(unit.key);
		// Never rebuild a card with an unsent draft in it — a sync from another tab
		// would otherwise throw away what someone is in the middle of typing.
		if (existing && (existing.signature === signature || hasDraft(existing.node))) {
			next.set(unit.key, existing);
			continue;
		}
		const node = createCard(unit, { onSelectionChange: toggleSelection });
		next.set(unit.key, { node, signature });
	}

	// This also drops what is no longer in the list: cards whose unit disappeared and
	// the superseded nodes of cards that were rebuilt.
	syncChildren(list, wanted.map(unit => next.get(unit.key)!.node));

	section.cards = next;
	section.built = true;
	scheduleMeasure();
}

/**
 * A clamped quote only earns a "Show more" if it is actually taller than the clamp.
 * That has to be measured after layout *and* after the serif webfont swaps in —
 * measuring once on render reports the fallback font's line count, which is wrong.
 */
export function measureClamps(): void {
	for (const card of Array.from(document.querySelectorAll<HTMLElement>('.sc-ann'))) {
		const quote = card.querySelector<HTMLElement>('.sc-quote');
		if (!quote) continue;
		if (!quote.classList.contains('is-clamped')) {
			card.classList.add('is-overflowing');
			continue;
		}
		const clipped = Array.from(quote.querySelectorAll<HTMLElement>('.sc-quote__text'))
			.some(block => block.scrollHeight - block.clientHeight > 2);
		card.classList.toggle('is-overflowing', clipped);
	}
}

let clampTimer = 0;
function scheduleMeasure(): void {
	window.clearTimeout(clampTimer);
	clampTimer = window.setTimeout(measureClamps, 80);
}

export function installStream(): void {
	window.addEventListener('resize', scheduleMeasure);
	// Fonts arrive after first paint; re-measure once they do.
	void document.fonts?.ready.then(measureClamps);
}

function ensureObserver(): IntersectionObserver {
	if (!observer) {
		observer = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const url = (entry.target as HTMLElement).dataset.page;
				const section = url ? sections.get(url) : undefined;
				if (section && !section.built && !state.collapsedPages.has(url!)) buildCards(section);
			}
		}, { rootMargin: '800px 0px' });
	}
	return observer;
}

function sectionFor(vp: VisiblePage, single: boolean): Section {
	let section = sections.get(vp.page.url);
	if (!section) {
		const root = el('section', 'sc-group');
		root.dataset.page = vp.page.url;
		const list = el('div', 'sc-group__list');
		section = { root, head: null, list, vp, built: false, cards: new Map() };
		sections.set(vp.page.url, section);
		ensureObserver().observe(root);
	}
	section.vp = vp;

	// The header reflects counts, so it's rebuilt every pass — but only the header.
	// Emptying the section would detach the card list, which blurs an open editor
	// and loses the caret.
	const head = single ? pageHero(vp) : groupHeader(vp);
	if (section.head) section.head.replaceWith(head);
	else section.root.insertBefore(head, section.root.firstChild);
	section.head = head;

	const collapsed = !single && state.collapsedPages.has(vp.page.url);
	section.root.classList.toggle('is-collapsed', collapsed);
	if (collapsed) {
		section.cards.clear();
		section.list.replaceChildren();
		section.list.remove();
		section.built = false;
		return section;
	}
	if (section.list.parentNode !== section.root) section.root.appendChild(section.list);
	return section;
}

// --- Empty / loading states ----------------------------------------------

function skeleton(): HTMLElement {
	const wrap = el('div', 'sc-skeleton');
	for (let i = 0; i < 3; i++) {
		const card = el('div', 'sc-skeleton__card');
		card.appendChild(el('div', 'sc-skeleton__bar sc-skeleton__bar--wide'));
		card.appendChild(el('div', 'sc-skeleton__bar'));
		card.appendChild(el('div', 'sc-skeleton__bar sc-skeleton__bar--short'));
		wrap.appendChild(card);
	}
	return wrap;
}

function emptyState(): HTMLElement {
	const filtering = anyFilterActive();
	const wrap = el('div', 'sc-empty');
	wrap.appendChild(icon(filtering ? 'search_off' : 'ink_highlighter', 'sc-empty__icon'));
	wrap.appendChild(el('h2', 'sc-empty__title',
		filtering ? 'No annotations match these filters' : 'Nothing annotated here yet'));
	wrap.appendChild(el('p', 'sc-empty__body', filtering
		? 'Try a different search, or clear the filters to see everything in this scope.'
		: 'Select text on any page and press Alt+H to highlight it. Your highlights, comments and drawings all collect here.'));
	if (filtering) {
		wrap.appendChild(button({
			label: 'Clear filters', variant: 'solid',
			onClick: () => { clearFilters(); render(); },
		}));
	}
	return wrap;
}

// --- Entry point ---------------------------------------------------------

export function renderStreamInto(): void {
	const host = $('hl-stream');
	renderSelectionBar();

	if (!state.loaded) {
		host.replaceChildren(skeleton());
		return;
	}

	const pages = visiblePages();
	const showHome = state.nav.type === 'all' && !anyFilterActive();

	if (pages.length === 0) {
		for (const section of sections.values()) observer?.unobserve(section.root);
		sections.clear();
		homeNode = null;
		homeKey = '';
		host.replaceChildren(emptyState());
		return;
	}

	// Drop sections whose page left the view, so their observers and cards go too.
	const wantedUrls = new Set(pages.map(p => p.page.url));
	for (const [url, section] of sections) {
		if (wantedUrls.has(url)) continue;
		observer?.unobserve(section.root);
		section.root.remove();
		sections.delete(url);
	}

	const single = state.nav.type === 'page' && pages.length === 1;

	// Update the stream in place. Emptying the container (even to re-append the
	// very same nodes) collapses its height, which resets scrollTop — so saving a
	// comment would yank the thread you were writing in out from under you.
	const scrollTop = host.scrollTop;
	const wanted: Node[] = [];
	if (showHome) {
		// Rebuilt only when its numbers actually change, so selecting a card doesn't
		// swap the whole overview out.
		const key = JSON.stringify(statsFor(pages));
		if (!homeNode || key !== homeKey) {
			homeNode = renderHome(pages);
			homeKey = key;
		}
		wanted.push(homeNode);
	} else {
		homeNode = null;
		homeKey = '';
	}

	for (const vp of pages) {
		const section = sectionFor(vp, single);
		wanted.push(section.root);
		// Rebuild what's already on screen now; the rest waits for the observer.
		if (section.built) buildCards(section);
	}

	// Touch only what is out of order: re-attaching a node that holds the focus blurs
	// whatever is inside it, so anything already in place must be left alone.
	syncChildren(host, wanted);
	if (host.scrollTop !== scrollTop) host.scrollTop = scrollTop;

	// The first screenful has no scroll event to trigger the observer on a fresh
	// render, so prime whatever is already in view.
	requestAnimationFrame(() => {
		for (const section of sections.values()) {
			if (section.built || state.collapsedPages.has(section.vp.page.url)) continue;
			const box = section.root.getBoundingClientRect();
			if (box.top < window.innerHeight + 800) buildCards(section);
		}
	});
}

// --- Keyboard cursor -----------------------------------------------------

export function moveCursor(delta: number): void {
	const units = orderedUnits();
	if (units.length === 0) return;
	const at = state.cursor ? units.findIndex(u => u.key === state.cursor) : -1;
	const next = at < 0
		? (delta > 0 ? 0 : units.length - 1)
		: Math.min(units.length - 1, Math.max(0, at + delta));
	setCursor(units[next].key);
}

export function setCursor(key: string | null): void {
	const previous = state.cursor;
	state.cursor = key;
	if (previous) sections.get(unitPage(previous))?.root
		.querySelector(`[data-unit="${cssEscape(previous)}"]`)?.classList.remove('is-cursor');
	if (!key) return;
	// The card may not be built yet (lazy section) — build it, then focus.
	const section = sections.get(unitPage(key));
	if (section && !section.built) buildCards(section);
	const node = document.querySelector<HTMLElement>(`[data-unit="${cssEscape(key)}"]`);
	if (!node) return;
	node.classList.add('is-cursor');
	node.focus({ preventScroll: true });
	node.scrollIntoView({ block: 'center', behavior: 'auto' });
}

export function cursorUnit(): RenderUnit | null {
	if (!state.cursor) return null;
	return orderedUnits().find(u => u.key === state.cursor) ?? null;
}

function unitPage(unitKey: string): string {
	return unitKey.slice(0, unitKey.lastIndexOf('::'));
}

function cssEscape(value: string): string {
	return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

export { orderedUnits, toggleSelection };
