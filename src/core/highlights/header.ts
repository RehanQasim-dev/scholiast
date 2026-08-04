import { $, button, el, icon, menuButton, MenuItem, tip } from './ui';
import { anyFilterActive, clearFilters, render, savePrefs, state } from './store';
import { colorCounts, siteName, statsFor, visiblePages, findPage } from './data';
import { pageLabel, plural } from './format';
import { navigate } from './nav';
import { exportJson, exportMarkdown, copyUnitsMarkdown, deleteScope } from './actions';
import { showShortcuts } from './shortcuts';
import { DateRange, HLColor, SortOrder } from './types';

/**
 * The header: where you are, and everything that changes what you're looking at.
 *
 * The destructive action lives inside the overflow menu, labelled with the exact
 * scope it would delete — it used to sit next to Export, one generic confirm away
 * from wiping the whole library.
 */

const SORT_LABELS: Record<SortOrder, string> = {
	new: 'Newest first',
	old: 'Oldest first',
	doc: 'Page order',
	color: 'By colour',
};

const RANGE_LABELS: Record<DateRange, string> = {
	all: 'Any time',
	today: 'Today',
	'7d': 'Last 7 days',
	'30d': 'Last 30 days',
};

const COLOR_LABELS: Record<HLColor, string> = { yellow: 'Yellow', red: 'Red', green: 'Green' };

let searchTimer = 0;

export function installHeader(): void {
	const search = $('hl-search') as HTMLInputElement;
	search.addEventListener('input', () => {
		window.clearTimeout(searchTimer);
		searchTimer = window.setTimeout(() => {
			state.filters.query = search.value.trim().toLowerCase();
			state.cursor = null;
			render();
		}, 130);
	});
	search.addEventListener('keydown', (e) => {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		if (search.value) {
			search.value = '';
			state.filters.query = '';
			render();
		} else search.blur();
	});

	const clear = $('hl-search-clear');
	clear.addEventListener('click', () => {
		search.value = '';
		state.filters.query = '';
		render();
		search.focus();
	});

	const sources = $('hl-source-search') as HTMLInputElement;
	sources.addEventListener('input', () => {
		state.filters.sources = sources.value.trim().toLowerCase();
		render();
	});

	menuButton($('hl-sort') as HTMLButtonElement, sortMenu, 'end');
	menuButton($('hl-filter') as HTMLButtonElement, filterMenu, 'end');
	menuButton($('hl-more') as HTMLButtonElement, moreMenu, 'end');
}

function sortMenu(): MenuItem[] {
	return (Object.keys(SORT_LABELS) as SortOrder[]).map(order => ({
		type: 'item',
		label: SORT_LABELS[order],
		checked: state.prefs.sort === order,
		onSelect: () => {
			state.prefs.sort = order;
			savePrefs();
			render();
		},
	}));
}

function filterMenu(): MenuItem[] {
	const counts = colorCounts();
	const items: MenuItem[] = [{ type: 'label', text: 'Colour' }];
	for (const color of ['yellow', 'green', 'red'] as HLColor[]) {
		items.push({
			type: 'item',
			label: `${COLOR_LABELS[color]} · ${counts[color]}`,
			checked: state.filters.colors.has(color),
			disabled: counts[color] === 0 && !state.filters.colors.has(color),
			onSelect: () => {
				if (state.filters.colors.has(color)) state.filters.colors.delete(color);
				else state.filters.colors.add(color);
				render();
			},
		});
	}
	items.push({ type: 'sep' }, { type: 'label', text: 'When' });
	for (const range of Object.keys(RANGE_LABELS) as DateRange[]) {
		items.push({
			type: 'item',
			label: RANGE_LABELS[range],
			checked: state.filters.range === range,
			onSelect: () => { state.filters.range = range; render(); },
		});
	}
	items.push({ type: 'sep' }, {
		type: 'item',
		label: 'Only with comments',
		checked: state.filters.withComments,
		onSelect: () => { state.filters.withComments = !state.filters.withComments; render(); },
	});
	if (anyFilterActive()) {
		items.push({ type: 'sep' }, {
			type: 'item', label: 'Clear all filters', iconName: 'filter_alt_off',
			onSelect: () => { clearFilters(); syncSearchField(); render(); },
		});
	}
	return items;
}

function scopeName(): string {
	const nav = state.nav;
	if (nav.type === 'all') return 'all sources';
	if (nav.type === 'domain') return siteName(nav.domain);
	const page = findPage(nav.url);
	return pageLabel(page?.title, page?.path || '', nav.domain, siteName(nav.domain));
}

function moreMenu(): MenuItem[] {
	const pages = visiblePages();
	const stats = statsFor(pages);
	const units = pages.flatMap(p => p.units);
	const empty = units.length === 0;
	return [
		{ type: 'label', text: `${plural(stats.annotations + stats.videos, 'annotation')} in view` },
		{
			type: 'item', label: 'Export as JSON', iconName: 'data_object', disabled: empty,
			onSelect: () => { void exportJson(pages); },
		},
		{
			type: 'item', label: 'Export as Markdown', iconName: 'description', disabled: empty,
			onSelect: () => { void exportMarkdown(pages); },
		},
		{
			type: 'item', label: 'Copy all as Markdown', iconName: 'content_copy', disabled: empty,
			onSelect: () => copyUnitsMarkdown(units, plural(units.length, 'annotation')),
		},
		{ type: 'sep' },
		{
			type: 'item', label: state.prefs.compact ? 'Comfortable density' : 'Compact density',
			iconName: state.prefs.compact ? 'density_medium' : 'density_small',
			onSelect: () => {
				state.prefs.compact = !state.prefs.compact;
				savePrefs();
				applyDensity();
			},
		},
		{ type: 'item', label: 'Keyboard shortcuts', iconName: 'keyboard', hint: '?', onSelect: showShortcuts },
		{ type: 'sep' },
		{
			type: 'item', label: `Delete ${scopeName()}…`, iconName: 'delete', danger: true, disabled: empty,
			onSelect: () => { void deleteScope(); },
		},
	];
}

export function applyDensity(): void {
	document.documentElement.classList.toggle('sc-compact', state.prefs.compact);
}

export function syncSearchField(): void {
	const search = $('hl-search') as HTMLInputElement;
	if (search.value !== state.filters.query) search.value = state.filters.query;
	$('hl-search-clear').hidden = !state.filters.query;
}

export function renderHeader(): void {
	renderBreadcrumb();
	renderFilterChips();
	syncSearchField();

	const pages = visiblePages();
	const stats = statsFor(pages);
	const count = $('hl-search-count');
	count.textContent = state.filters.query
		? plural(stats.annotations + stats.videos, 'result')
		: '';

	const sort = $('hl-sort');
	sort.querySelector('.sc-btn__label')!.textContent = SORT_LABELS[state.prefs.sort];
	$('hl-filter').classList.toggle('is-on', anyFilterActive());
}

function renderBreadcrumb(): void {
	const host = $('hl-breadcrumb');
	host.replaceChildren();
	const nav = state.nav;

	const all = el('button', `sc-crumb${nav.type === 'all' ? ' is-current' : ''}`, 'All sources');
	all.type = 'button';
	all.addEventListener('click', () => navigate({ type: 'all' }));
	host.appendChild(all);
	if (nav.type === 'all') return;

	host.appendChild(icon('chevron_right', 'sc-crumb__sep'));
	const domain = el('button', `sc-crumb${nav.type === 'domain' ? ' is-current' : ''}`, siteName(nav.domain));
	domain.type = 'button';
	domain.addEventListener('click', () => navigate({ type: 'domain', domain: nav.domain }));
	host.appendChild(domain);
	if (nav.type === 'domain') return;

	const page = findPage(nav.url);
	host.appendChild(icon('chevron_right', 'sc-crumb__sep'));
	const label = pageLabel(page?.title, page?.path || '', nav.domain, siteName(nav.domain));
	const current = el('span', 'sc-crumb is-current', label);
	tip(current, page?.url || label);
	host.appendChild(current);
}

function renderFilterChips(): void {
	const host = $('hl-filters');
	host.replaceChildren();
	const f = state.filters;
	const chips: { label: string; clear: () => void }[] = [];

	if (f.tag) chips.push({ label: `#${f.tag}`, clear: () => { f.tag = null; } });
	for (const color of f.colors) {
		chips.push({ label: COLOR_LABELS[color], clear: () => f.colors.delete(color) });
	}
	if (f.range !== 'all') chips.push({ label: RANGE_LABELS[f.range], clear: () => { f.range = 'all'; } });
	if (f.withComments) chips.push({ label: 'With comments', clear: () => { f.withComments = false; } });

	host.hidden = chips.length === 0;
	if (chips.length === 0) return;

	host.appendChild(el('span', 'sc-filters__label', 'Filtered by'));
	for (const chip of chips) {
		const node = el('button', 'sc-chip is-on');
		node.type = 'button';
		node.appendChild(el('span', '', chip.label));
		node.appendChild(icon('close'));
		tip(node, `Remove ${chip.label}`);
		node.addEventListener('click', () => { chip.clear(); render(); });
		host.appendChild(node);
	}
	if (chips.length > 1) {
		host.appendChild(button({
			label: 'Clear all', variant: 'quiet',
			onClick: () => { clearFilters(); syncSearchField(); render(); },
		}));
	}
}
