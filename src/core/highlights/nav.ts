import { render, state } from './store';
import { NavSelection } from './types';

/**
 * Navigation is all → domain → page, mirrored into the url query so a dashboard
 * tab can be reloaded, bookmarked or opened from elsewhere in the extension
 * (`openHighlights` passes `?domain=`).
 */

export function navigate(nav: NavSelection): void {
	state.nav = nav;
	if (nav.type === 'domain' || nav.type === 'page') state.expandedDomains.add(nav.domain);
	// A fresh scope shouldn't inherit the previous one's selection or cursor.
	state.selection.clear();
	state.selectionAnchor = null;
	state.cursor = null;
	writeUrl();
	render();
	document.getElementById('hl-stream')?.scrollTo({ top: 0 });
	window.scrollTo({ top: 0 });
}

export function writeUrl(): void {
	const params = new URLSearchParams();
	if (state.nav.type === 'domain') params.set('domain', state.nav.domain);
	else if (state.nav.type === 'page') {
		params.set('domain', state.nav.domain);
		params.set('url', state.nav.url);
	}
	const search = params.toString();
	window.history.replaceState({}, '', window.location.pathname + (search ? `?${search}` : ''));
}

export function readUrl(): NavSelection {
	const params = new URLSearchParams(window.location.search);
	const domain = params.get('domain')?.replace(/^www\./, '');
	const url = params.get('url');
	if (url && domain) return { type: 'page', domain, url };
	if (domain) return { type: 'domain', domain };
	return { type: 'all' };
}
