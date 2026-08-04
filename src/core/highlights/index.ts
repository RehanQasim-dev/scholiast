import browser from '../../utils/browser-polyfill';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { anyPageChanged } from '../../utils/page-store';
import { $, closeMenu, installUi } from './ui';
import {
	anyFilterActive, clearFilters, loadPrefs, registerRenderers, render, renderStream, state,
} from './store';
import { loadData } from './data';
import { readUrl, writeUrl } from './nav';
import { renderRail } from './rail';
import { applyDensity, installHeader, renderHeader, syncSearchField } from './header';
import {
	clearSelection, cursorUnit, installStream, moveCursor, renderStreamInto, setCursor, toggleSelection,
} from './stream';
import { copyUnitsMarkdown, deleteUnits, selectedUnits } from './actions';
import { sourceUrl } from './card';
import { showShortcuts, shortcutsOpen } from './shortcuts';

/**
 * Annotation dashboard bootstrap: load, wire, render, and keep in step with
 * storage. Every render path goes through here so the rest of the modules never
 * need to know about each other.
 */

dayjs.extend(relativeTime);

document.addEventListener('DOMContentLoaded', async () => {
	installUi();
	installHeader();
	installStream();
	installKeyboard();

	registerRenderers({
		all: () => { renderRail(); renderHeader(); renderStreamInto(); },
		stream: () => { renderStreamInto(); },
	});

	state.nav = readUrl();
	if (state.nav.type !== 'all') state.expandedDomains.add(state.nav.domain);
	writeUrl();

	await loadPrefs();
	applyDensity();
	render();

	await loadData();
	render();

	browser.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local') return;
		if (anyPageChanged(changes, ['hl', 'va', 'dr'])) {
			void loadData().then(render);
		} else if (changes.diagrams) {
			// A diagram was re-saved from the Excalidraw popup: its rendered PNG
			// changed in the blob store, so the images need refetching.
			renderStream();
		} else if (changes.domains) {
			renderRail();
		}
	});
});

function isTyping(target: EventTarget | null): boolean {
	const node = target as HTMLElement | null;
	if (!node) return false;
	if (node.isContentEditable) return true;
	const tag = node.tagName;
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function installKeyboard(): void {
	let lastG = 0;

	document.addEventListener('keydown', (e) => {
		const typing = isTyping(e.target);

		// Escape unwinds one layer at a time: selection, then search, then filters.
		if (e.key === 'Escape' && !typing) {
			if (state.selection.size) { clearSelection(); return; }
			if (state.filters.query) {
				state.filters.query = '';
				syncSearchField();
				render();
				return;
			}
			if (anyFilterActive()) { clearFilters(); render(); }
			return;
		}

		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			focusSearch();
			return;
		}
		if (typing || e.ctrlKey || e.metaKey || e.altKey || shortcutsOpen()) return;

		switch (e.key) {
			case '/':
				e.preventDefault();
				focusSearch();
				return;
			case '?':
				e.preventDefault();
				showShortcuts();
				return;
			case 'j':
				e.preventDefault();
				moveCursor(1);
				return;
			case 'k':
				e.preventDefault();
				moveCursor(-1);
				return;
			case 'g': {
				const now = Date.now();
				if (now - lastG < 600) {
					lastG = 0;
					setCursor(null);
					window.scrollTo({ top: 0 });
					$('hl-stream').scrollTo({ top: 0 });
				} else lastG = now;
				return;
			}
			default:
				break;
		}

		const unit = cursorUnit();
		if (!unit) return;
		switch (e.key) {
			case 'o':
				e.preventDefault();
				window.open(sourceUrl(unit), '_blank', 'noopener');
				return;
			case 'c':
				e.preventDefault();
				state.replyOpen.add(unit.key);
				renderStream();
				return;
			case 'y':
				e.preventDefault();
				copyUnitsMarkdown([unit], 'Annotation');
				return;
			case 'e':
				e.preventDefault();
				if (state.expandedQuotes.has(unit.key)) state.expandedQuotes.delete(unit.key);
				else state.expandedQuotes.add(unit.key);
				renderStream();
				return;
			case 'x':
				e.preventDefault();
				toggleSelection(unit.key, e.shiftKey);
				return;
			case 'Backspace':
			case 'Delete': {
				e.preventDefault();
				const targets = state.selection.size ? selectedUnits() : [unit];
				state.selection.clear();
				state.selectionAnchor = null;
				void deleteUnits(targets);
				return;
			}
			default:
				return;
		}
	});

	// A menu should never outlive the thing it belongs to.
	window.addEventListener('blur', closeMenu);
}

function focusSearch(): void {
	const search = $('hl-search') as HTMLInputElement;
	search.focus();
	search.select();
}
