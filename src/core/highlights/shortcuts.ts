import { el, icon } from './ui';

/** The shortcut sheet. Small enough to be a panel rather than a dialog flow. */

const GROUPS: { title: string; rows: [string[], string][] }[] = [
	{
		title: 'Move',
		rows: [
			[['j'], 'Next annotation'],
			[['k'], 'Previous annotation'],
			[['g', 'g'], 'Back to top'],
		],
	},
	{
		title: 'Act on the focused annotation',
		rows: [
			[['c'], 'Write a comment'],
			[['o'], 'Open the source page'],
			[['y'], 'Copy as Markdown'],
			[['e'], 'Expand or collapse a long quote'],
			[['x'], 'Select — Shift to select a range'],
			[['⌫'], 'Delete (undoable)'],
		],
	},
	{
		title: 'Find',
		rows: [
			[['/'], 'Search annotations'],
			[['Esc'], 'Clear selection, then search, then filters'],
			[['?'], 'This sheet'],
		],
	},
];

let openSheet: HTMLElement | null = null;

export function showShortcuts(): void {
	if (openSheet) { hide(); return; }
	const backdrop = el('div', 'sc-backdrop');
	const panel = el('div', 'sc-sheet');
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-modal', 'true');
	panel.setAttribute('aria-label', 'Keyboard shortcuts');

	const head = el('div', 'sc-sheet__head');
	head.appendChild(el('h2', 'sc-sheet__title', 'Keyboard shortcuts'));
	const close = el('button', 'sc-btn sc-btn--ghost sc-btn--icon');
	close.type = 'button';
	close.setAttribute('aria-label', 'Close');
	close.appendChild(icon('close'));
	close.addEventListener('click', hide);
	head.appendChild(close);
	panel.appendChild(head);

	for (const group of GROUPS) {
		panel.appendChild(el('h3', 'sc-sheet__group', group.title));
		const list = el('dl', 'sc-sheet__list');
		for (const [keys, label] of group.rows) {
			const dt = el('dt', 'sc-sheet__keys');
			keys.forEach((k, i) => {
				if (i) dt.appendChild(el('span', 'sc-sheet__then', 'then'));
				dt.appendChild(el('kbd', '', k));
			});
			list.append(dt, el('dd', 'sc-sheet__what', label));
		}
		panel.appendChild(list);
	}

	backdrop.appendChild(panel);
	document.body.appendChild(backdrop);
	openSheet = backdrop;
	requestAnimationFrame(() => backdrop.classList.add('sc-backdrop--on'));
	close.focus({ preventScroll: true });
	backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) hide(); });
	document.addEventListener('keydown', onKey, true);
}

function onKey(e: KeyboardEvent): void {
	if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); hide(); }
}

function hide(): void {
	if (!openSheet) return;
	const node = openSheet;
	openSheet = null;
	document.removeEventListener('keydown', onKey, true);
	node.classList.remove('sc-backdrop--on');
	window.setTimeout(() => node.remove(), 240);
}

export function shortcutsOpen(): boolean { return !!openSheet; }
