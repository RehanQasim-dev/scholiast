import dayjs from 'dayjs';
import { el, favicon, tip } from './ui';
import { state } from './store';
import { drawingOf, siteName, statsFor, unitStamp, visiblePages } from './data';
import { plural, pluralWord } from './format';
import { navigate } from './nav';
import { VisiblePage } from './types';

/**
 * The landing view. "All sources" used to be a list of collapsed rows that told
 * you nothing; this answers the questions you actually open a library with — how
 * much is in here, when was I last reading, and where do I read most.
 */

const WEEKS = 13;

function activityCounts(pages: VisiblePage[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const { units } of pages) {
		for (const unit of units) {
			const stamp = unitStamp(unit);
			if (!stamp) continue;
			const key = dayjs(stamp).format('YYYY-MM-DD');
			counts.set(key, (counts.get(key) || 0) + unit.entries.length);
		}
	}
	return counts;
}

function heatmap(pages: VisiblePage[]): HTMLElement {
	const counts = activityCounts(pages);
	const peak = Math.max(1, ...counts.values());
	// Whole weeks, ending with the current one, so columns line up with weekdays.
	const start = dayjs().endOf('week').startOf('day').subtract(WEEKS * 7 - 1, 'day');

	const wrap = el('div', 'sc-panel sc-activity');
	const head = el('div', 'sc-panel__head');
	head.appendChild(el('h2', 'sc-panel__title', 'Activity'));
	head.appendChild(el('span', 'sc-panel__note', `last ${WEEKS} weeks`));
	wrap.appendChild(head);

	const grid = el('div', 'sc-activity__grid');
	grid.style.setProperty('--weeks', String(WEEKS));
	let lastMonth = '';
	for (let week = 0; week < WEEKS; week++) {
		const column = el('div', 'sc-activity__week');
		const monthOf = start.add(week * 7, 'day').format('MMM');
		if (monthOf !== lastMonth) {
			column.appendChild(el('span', 'sc-activity__month', monthOf));
			lastMonth = monthOf;
		} else {
			column.appendChild(el('span', 'sc-activity__month'));
		}
		for (let day = 0; day < 7; day++) {
			const date = start.add(week * 7 + day, 'day');
			const future = date.valueOf() > Date.now();
			const count = counts.get(date.format('YYYY-MM-DD')) || 0;
			const cell = el('span', `sc-activity__cell${future ? ' is-future' : ''}`);
			if (count > 0) {
				// Four steps is enough to read a pattern without implying precision.
				const level = count >= peak * 0.75 ? 4 : count >= peak * 0.5 ? 3 : count >= peak * 0.25 ? 2 : 1;
				cell.dataset.level = String(level);
			}
			if (!future) tip(cell, `${count ? plural(count, 'annotation') : 'Nothing'} · ${date.format('ddd, MMM D')}`);
			column.appendChild(cell);
		}
		grid.appendChild(column);
	}
	wrap.appendChild(grid);
	return wrap;
}

function topSources(): HTMLElement {
	const rows = state.groups
		.map(g => ({ domain: g.domain, count: g.totalHighlights }))
		.sort((a, b) => b.count - a.count)
		.slice(0, 5);
	const peak = Math.max(1, ...rows.map(r => r.count));

	const wrap = el('div', 'sc-panel sc-top');
	const head = el('div', 'sc-panel__head');
	head.appendChild(el('h2', 'sc-panel__title', 'Most annotated'));
	wrap.appendChild(head);

	for (const row of rows) {
		const item = el('button', 'sc-top__row');
		item.type = 'button';
		item.appendChild(favicon(state.domainSettings[row.domain]?.favicon, 14));
		item.appendChild(el('span', 'sc-top__name', siteName(row.domain)));
		const bar = el('span', 'sc-top__bar');
		const fill = el('span', 'sc-top__fill');
		fill.style.width = `${Math.max(4, (row.count / peak) * 100)}%`;
		bar.appendChild(fill);
		item.appendChild(bar);
		item.appendChild(el('span', 'sc-count', String(row.count)));
		item.addEventListener('click', () => navigate({ type: 'domain', domain: row.domain }));
		wrap.appendChild(item);
	}
	return wrap;
}

function statTiles(pages: VisiblePage[]): HTMLElement {
	const stats = statsFor(pages);
	const drawingPages = pages.filter(p => p.units.some(u => drawingOf(u.entries[0].data))).length;
	const tiles: [string, string][] = [
		[stats.annotations.toLocaleString(), pluralWord(stats.annotations, 'annotation')],
		[stats.comments.toLocaleString(), pluralWord(stats.comments, 'comment')],
		[String(stats.sources), pluralWord(stats.sources, 'source')],
		[String(stats.pages), pluralWord(stats.pages, 'page')],
	];
	if (drawingPages) tiles.push([String(stats.drawings), 'strokes drawn']);

	const row = el('div', 'sc-stats');
	for (const [value, label] of tiles) {
		const tile = el('div', 'sc-stats__tile');
		tile.appendChild(el('span', 'sc-stats__value', value));
		tile.appendChild(el('span', 'sc-stats__label', label));
		row.appendChild(tile);
	}
	return row;
}

export function renderHome(pages = visiblePages()): HTMLElement {
	const stats = statsFor(pages);
	const wrap = el('div', 'sc-home');

	const head = el('header', 'sc-home__head');
	head.appendChild(el('h1', 'sc-home__title', 'Your library'));
	if (stats.last) {
		head.appendChild(el('p', 'sc-home__sub', `Last annotated ${dayjs(stats.last).fromNow()}`));
	}
	wrap.appendChild(head);
	wrap.appendChild(statTiles(pages));

	const panels = el('div', 'sc-home__panels');
	panels.appendChild(heatmap(pages));
	if (state.groups.length > 1) panels.appendChild(topSources());
	wrap.appendChild(panels);

	const label = el('div', 'sc-section-label');
	label.appendChild(el('span', '', 'Everything, newest first'));
	wrap.appendChild(label);
	return wrap;
}
