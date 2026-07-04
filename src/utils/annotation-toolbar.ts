// Excalidraw-style annotation toolbar: a floating pill at the top-center of
// the page, visible only while annotation mode is on. It makes the current
// tool VISIBLE — which is what makes tool behavior predictable.
//
// Tools: Select (browse/manage), Highlighter, Pen. Exit (×) leaves annotation
// mode entirely. Tools change only when the user changes them (toolbar click
// or H/P keys); an open comment draft temporarily suspends annotation and is
// shown by dimming the tool buttons (see the obsidian-draft-state listener).
//
// The toolbar doesn't own the tools — highlighter mode and pencil mode keep
// their existing toggles (body classes obsidian-highlighter-active /
// obsidian-pencil-active). A MutationObserver on <body> keeps the buttons in
// sync no matter which path toggled a tool (toolbar, H/P keys, Escape,
// extension popup). It also auto-shows the toolbar whenever a tool activates,
// so every existing entry point into annotating brings the toolbar with it.

import { toggleHighlighterMenu } from './highlighter';
import { removeExistingHighlights } from './highlighter-overlays';
import { generalSettings } from './storage-utils';
import * as pencil from './pencil-overlays';

export type AnnotationTool = 'select' | 'highlight' | 'pen';

const TOOLBAR_CLASS = 'obsidian-annotation-toolbar';
const LAST_TOOL_KEY = 'annotationLastTool';

let toolbarEl: HTMLElement | null = null;
let modeActive = false;
let observer: MutationObserver | null = null;

function currentTool(): AnnotationTool {
	if (document.body.classList.contains('obsidian-highlighter-active')) return 'highlight';
	if (document.body.classList.contains('obsidian-pencil-active')) return 'pen';
	return 'select';
}

export function isAnnotationModeActive(): boolean {
	return modeActive;
}

// Enter annotation mode: show the toolbar and activate the last-used tool
// (entering the mode is already an explicit "I want to annotate" signal, so
// starting on Select would just add a click). Defaults to the highlighter.
export function enterAnnotationMode() {
	if (modeActive) return;
	modeActive = true;
	ensureToolbar();
	browser.storage.local.get(LAST_TOOL_KEY).then((res) => {
		if (!modeActive) return; // exited before storage answered
		const last = (res as Record<string, unknown>)[LAST_TOOL_KEY];
		setTool(last === 'pen' || last === 'select' || last === 'highlight' ? last as AnnotationTool : 'highlight');
	});
}

export function exitAnnotationMode() {
	// Idempotent: the background echoes setHighlighterMode back to the tab, so
	// a second call with everything already off must not re-send the message.
	if (!modeActive && !pencil.isPencilActive() && !document.body.classList.contains('obsidian-highlighter-active')) {
		return;
	}
	if (pencil.isPencilActive()) pencil.togglePencilMode(false);
	if (document.body.classList.contains('obsidian-highlighter-active')) toggleHighlighterMenu(false);
	modeActive = false;
	toolbarEl?.remove();
	toolbarEl = null;
	browser.runtime.sendMessage({ action: 'setHighlighterMode', isActive: false }).catch(() => {});
	// Hide highlight overlays on full exit if "Always show highlights" is off.
	if (!generalSettings.alwaysShowHighlights) {
		removeExistingHighlights();
	}
}

export function setTool(tool: AnnotationTool) {
	if (!modeActive) {
		modeActive = true;
		ensureToolbar();
	}
	if (tool === 'highlight') {
		if (pencil.isPencilActive()) pencil.togglePencilMode(false);
		if (!document.body.classList.contains('obsidian-highlighter-active')) toggleHighlighterMenu(true);
	} else if (tool === 'pen') {
		if (document.body.classList.contains('obsidian-highlighter-active')) toggleHighlighterMenu(false);
		if (!pencil.isPencilActive()) pencil.togglePencilMode(true);
	} else {
		if (pencil.isPencilActive()) pencil.togglePencilMode(false);
		if (document.body.classList.contains('obsidian-highlighter-active')) toggleHighlighterMenu(false);
	}
	browser.storage.local.set({ [LAST_TOOL_KEY]: tool }).catch(() => {});
	syncButtons();
}

function svgIcon(paths: string[], extra = ''): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths.map(d => `<path d="${d}"/>`).join('')}${extra}</svg>`;
}

function ensureToolbar() {
	if (toolbarEl && document.body.contains(toolbarEl)) return;
	const bar = document.createElement('div');
	bar.className = TOOLBAR_CLASS;
	bar.innerHTML = `
		<button data-tool="select" title="Select (Esc)" aria-label="Select tool">
			${svgIcon(['M12.586 12.586 19 19', 'M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z'])}
		</button>
		<button data-tool="highlight" title="Highlighter (H)" aria-label="Highlighter tool">
			${svgIcon(['m9 11-6 6v3h9l3-3', 'm22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4'])}
		</button>
		<button data-tool="pen" title="Pen (P)" aria-label="Pen tool">
			${svgIcon(['M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z', 'm15 5 4 4'])}
		</button>
		<span class="obsidian-toolbar-divider"></span>
		<button data-tool="exit" title="Exit annotation mode" aria-label="Exit annotation mode">
			${svgIcon(['M18 6 6 18', 'm6 6 12 12'])}
		</button>
	`;
	bar.addEventListener('click', (e) => {
		const btn = (e.target as HTMLElement).closest('button[data-tool]') as HTMLElement | null;
		if (!btn) return;
		e.preventDefault();
		e.stopPropagation();
		const tool = btn.dataset.tool;
		if (tool === 'exit') exitAnnotationMode();
		else setTool(tool as AnnotationTool);
	});
	// Keep toolbar clicks from becoming page clicks/selections.
	bar.addEventListener('mousedown', (e) => e.stopPropagation());
	document.body.appendChild(bar);
	toolbarEl = bar;
	syncButtons();
}

function syncButtons() {
	if (!toolbarEl) return;
	const active = currentTool();
	toolbarEl.querySelectorAll('button[data-tool]').forEach((btn) => {
		btn.classList.toggle('is-active', (btn as HTMLElement).dataset.tool === active);
	});
}

// Keep the toolbar honest no matter who toggles a tool (H/P keys, Escape,
// popup messages) — and bring the toolbar up whenever a tool activates, so
// every existing entry point into annotation shows it.
export function initAnnotationToolbar() {
	if (observer) return;
	observer = new MutationObserver(() => {
		const toolOn = document.body.classList.contains('obsidian-highlighter-active') || pencil.isPencilActive();
		if (toolOn && !modeActive) {
			modeActive = true;
			ensureToolbar();
		}
		if (modeActive) {
			// Re-append if the page nuked our node (SPA re-renders).
			if (!toolbarEl || !document.body.contains(toolbarEl)) ensureToolbar();
			syncButtons();
		}
	});
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

	// Dim the annotation tools while a comment draft is open (annotation is
	// suspended until the draft is submitted or discarded).
	window.addEventListener('obsidian-draft-state', ((e: CustomEvent) => {
		toolbarEl?.classList.toggle('has-draft', !!e.detail);
	}) as EventListener);

}
