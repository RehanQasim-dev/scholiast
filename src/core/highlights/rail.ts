import { $, el, favicon, icon, tip } from './ui';
import { render, state } from './store';
import { railGroups, siteName, tagCounts, pageStamp } from './data';
import { pageLabel, plural } from './format';
import { navigate } from './nav';

/**
 * The rail: sources, then tags.
 *
 * The two lists are sized by content rather than stretched to fill — the previous
 * version gave both a flex-grow, which parked the tag list in the middle of an
 * empty column. Sources take the space that's left; tags cap at a share of the
 * height and scroll inside it.
 */

export function renderRail(): void {
	renderSources();
	renderTags();
}

function renderSources(): void {
	const host = $('hl-sources');
	host.replaceChildren();
	const groups = railGroups();

	if (groups.length === 0) {
		host.appendChild(el('p', 'sc-rail__empty',
			state.filters.sources ? 'No sources match' : 'No annotations yet'));
		return;
	}

	const all = el('button', `sc-src sc-src--all${state.nav.type === 'all' ? ' is-active' : ''}`);
	all.type = 'button';
	all.appendChild(icon('inbox', 'sc-src__icon'));
	all.appendChild(el('span', 'sc-src__name', 'All sources'));
	all.appendChild(el('span', 'sc-count', String(state.groups.reduce((s, g) => s + g.totalHighlights, 0))));
	all.addEventListener('click', () => navigate({ type: 'all' }));
	host.appendChild(all);

	for (const group of groups) {
		const active = state.nav.type !== 'all' && state.nav.domain === group.domain;
		const expanded = state.expandedDomains.has(group.domain);
		const wrap = el('div', 'sc-src-group');

		const row = el('button', `sc-src${active ? ' is-active' : ''}`);
		row.type = 'button';
		row.setAttribute('aria-expanded', String(expanded));

		const twist = el('span', 'sc-src__twist');
		twist.appendChild(icon('chevron_right'));
		row.appendChild(twist);

		row.appendChild(favicon(state.domainSettings[group.domain]?.favicon, 16));
		row.appendChild(el('span', 'sc-src__name', siteName(group.domain)));
		row.appendChild(el('span', 'sc-count', String(group.totalHighlights)));
		tip(row, `${group.domain} — ${plural(group.totalHighlights, 'annotation')}`);
		row.addEventListener('click', (e) => {
			if (e.ctrlKey || e.metaKey) { window.open(`https://${group.domain}`, '_blank', 'noopener'); return; }
			// One control: opening a source expands it, and clicking the source you
			// are already reading folds it away again.
			if (active && expanded) {
				state.expandedDomains.delete(group.domain);
				renderRail();
				return;
			}
			state.expandedDomains.add(group.domain);
			navigate({ type: 'domain', domain: group.domain });
		});
		wrap.appendChild(row);

		if (expanded) {
			const nested = el('div', 'sc-src__pages');
			// Newest first, matching the stream — the two lists used to disagree.
			for (const page of [...group.pages].sort((a, b) => pageStamp(b) - pageStamp(a))) {
				const pageActive = state.nav.type === 'page' && state.nav.url === page.url;
				const item = el('button', `sc-page${pageActive ? ' is-active' : ''}`);
				item.type = 'button';
				item.appendChild(el('span', 'sc-page__name',
					pageLabel(page.title, page.path, group.domain, siteName(group.domain))));
				item.appendChild(el('span', 'sc-count', String(page.highlights.length)));
				tip(item, page.url);
				item.addEventListener('click', (e) => {
					if (e.ctrlKey || e.metaKey) { window.open(page.url, '_blank', 'noopener'); return; }
					navigate({ type: 'page', domain: group.domain, url: page.url });
				});
				nested.appendChild(item);
			}
			wrap.appendChild(nested);
		}
		host.appendChild(wrap);
	}
}

function renderTags(): void {
	const panel = $('hl-tags');
	const host = $('hl-tag-list');
	host.replaceChildren();

	const counts = tagCounts();
	panel.hidden = counts.size === 0;
	if (counts.size === 0) return;

	for (const path of [...counts.keys()].sort()) {
		const depth = path.split('/').length - 1;
		const active = state.filters.tag === path;
		const row = el('button', `sc-tag${active ? ' is-active' : ''}`);
		row.type = 'button';
		row.setAttribute('aria-pressed', String(active));
		if (depth) row.style.paddingInlineStart = `${10 + depth * 14}px`;
		row.appendChild(el('span', 'sc-tag__hash', '#'));
		row.appendChild(el('span', 'sc-tag__name', depth ? path.slice(path.lastIndexOf('/') + 1) : path));
		row.appendChild(el('span', 'sc-count', String(counts.get(path))));
		row.addEventListener('click', () => {
			state.filters.tag = active ? null : path;
			state.cursor = null;
			render();
		});
		host.appendChild(row);
	}
}
