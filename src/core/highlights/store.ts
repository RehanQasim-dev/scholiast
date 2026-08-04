import browser from '../../utils/browser-polyfill';
import { DateRange, DomainGroup, HLColor, NavSelection, SortOrder } from './types';
import { DomainSettings } from '../../utils/highlighter';

/**
 * All mutable dashboard state lives here so every module can read it without
 * importing the render tree (which would make the module graph circular).
 * Modules mutate state, then ask for the render they need.
 */

export interface Filters {
	/** Rail search: matches domains / site names. */
	sources: string;
	/** Header search: matches quote text, comment text and url. */
	query: string;
	colors: Set<HLColor>;
	tag: string | null;
	withComments: boolean;
	range: DateRange;
}

export interface Prefs {
	sort: SortOrder;
	compact: boolean;
}

export const state = {
	loaded: false,
	groups: [] as DomainGroup[],
	domainSettings: {} as Record<string, DomainSettings>,
	nav: { type: 'all' } as NavSelection,
	filters: {
		sources: '',
		query: '',
		colors: new Set<HLColor>(),
		tag: null,
		withComments: false,
		range: 'all',
	} as Filters,
	prefs: { sort: 'new', compact: false } as Prefs,
	/** Expanded domains in the rail. */
	expandedDomains: new Set<string>(),
	/** Collapsed page groups in the stream (expanded is the default now). */
	collapsedPages: new Set<string>(),
	/** Units whose long quote has been expanded past the clamp. */
	expandedQuotes: new Set<string>(),
	/** Selected unit keys for bulk actions. */
	selection: new Set<string>(),
	/** Last unit key clicked with a checkbox, for shift-range selection. */
	selectionAnchor: null as string | null,
	/** Comment being edited inline: `${pageUrl}::${highlightId}::${noteIndex}`. */
	editingComment: null as string | null,
	/** Unit keys whose reply editor is open. */
	replyOpen: new Set<string>(),
	/** Unit key holding roving keyboard focus. */
	cursor: null as string | null,
};

export function anyFilterActive(): boolean {
	const f = state.filters;
	return !!f.query || f.colors.size > 0 || !!f.tag || f.withComments || f.range !== 'all';
}

export function clearFilters(): void {
	const f = state.filters;
	f.query = '';
	f.colors.clear();
	f.tag = null;
	f.withComments = false;
	f.range = 'all';
}

// --- Render dispatch -------------------------------------------------------
// index.ts registers the real renderers; everything else calls these.

type Renderer = () => void;
let renderers: { all: Renderer; stream: Renderer } | null = null;

export function registerRenderers(r: { all: Renderer; stream: Renderer }): void {
	renderers = r;
}

/** Full render: rail, header, stream. */
export function render(): void { renderers?.all(); }
/** Stream only — keeps rail/header DOM (and the focus inside them) untouched. */
export function renderStream(): void { renderers?.stream(); }

// --- Preferences -----------------------------------------------------------

const PREFS_KEY = 'dashboardPrefs';

export async function loadPrefs(): Promise<void> {
	try {
		const stored = await browser.storage.local.get(PREFS_KEY);
		const p = stored[PREFS_KEY] as Partial<Prefs> | undefined;
		if (p?.sort) state.prefs.sort = p.sort;
		if (typeof p?.compact === 'boolean') state.prefs.compact = p.compact;
	} catch { /* first run */ }
}

export function savePrefs(): void {
	void browser.storage.local.set({ [PREFS_KEY]: { ...state.prefs } });
}
