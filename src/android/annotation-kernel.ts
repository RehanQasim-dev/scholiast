// Android reader annotation kernel.
//
// Adapted (NOT imported wholesale) from the desktop extension's chrome-bound
// modules: `src/utils/highlighter-overlays.ts` (Custom Highlight API painting,
// active-highlight emphasis, floating pill) and `src/utils/highlighter.ts`
// (highlight CRUD + recolor semantics). Those files pull in chrome.storage,
// i18n, comment overlays etc., so this is a dependency-free re-host of their
// pure core behind a `KernelHost` callback interface. The anchoring math itself
// is NOT copied — it imports the shared, dependency-free cores directly:
//   shared/anchor.ts      (createAnchor / resolveAnchor / findTextQuoteRange)
//   src/utils/trim-range.ts (Hypothesis-style whitespace trim)
//
// Data shape matches desktop TextHighlightData exactly so Task 35 can persist
// and Drive-sync reader highlights on the same path as web ones.

import {
	createAnchor,
	resolveAnchor,
	buildTextMap,
	locateRange,
	offsetsFromRange,
	toDomRange,
	elementFromXPath,
	type AnnotationAnchor,
	type RangeLike,
} from '../../shared/anchor';
import { trimRange } from '../utils/trim-range';

export type HlColor = 'yellow' | 'red' | 'green';

/** Same JSON shape as the extension's TextHighlightData. */
export interface ReaderTextHighlight {
	type: 'text';
	id: string;
	xpath: string;
	startOffset: number;
	endOffset: number;
	content: string;
	notes: string[];
	color: HlColor;
	groupId?: string;
	anchor?: AnnotationAnchor;
	updatedAt?: number;
}

/** Callbacks the entry script injects; every one guards AndroidBridge itself. */
export interface KernelHost {
	onHighlightCreated(json: ReaderTextHighlight): void;
	onHighlightUpdated(json: ReaderTextHighlight): void;
	onHighlightDeleted(id: string): void;
	onSelectionState(json: string): void;
}

const COLORS: HlColor[] = ['yellow', 'red', 'green'];
const COLOR_HEX: Record<HlColor, string> = {
	yellow: '#F9E64D',
	red: '#FF5A5A',
	green: '#5FE3A0',
};

/** Block-level elements a selection is split across (one highlight per block). */
const BLOCK_TAGS = new Set([
	'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE',
	'FIGCAPTION', 'DD', 'DT', 'TD', 'TH',
]);

// --- CSS Custom Highlight API plumbing (mirrors highlighter-overlays.ts) ---

interface HighlightInstance {
	add(range: Range): void;
	clear(): void;
	priority: number;
}
type HighlightsRegistry = Map<string, HighlightInstance> & { set(n: string, v: unknown): unknown };

function registry(): HighlightsRegistry | null {
	return ((CSS as unknown as { highlights?: HighlightsRegistry }).highlights) ?? null;
}
function highlightCtor(): (new () => HighlightInstance) | null {
	return (window as unknown as { Highlight?: new () => HighlightInstance }).Highlight ?? null;
}

export class AnnotationKernel {
	readonly highlights: ReaderTextHighlight[] = [];
	private ranges = new Map<string, Range[]>();
	private layers = new Map<string, HighlightInstance>();
	private badges = new Map<string, HTMLButtonElement>();
	private pill: HTMLDivElement | null = null;
	private article: HTMLElement;
	private host: KernelHost;
	private rootText = '';
	private lastColor: HlColor = 'yellow';
	private destroyed = false;

	constructor(article: HTMLElement, host: KernelHost) {
		this.article = article;
		this.host = host;
		this.rootText = buildTextMap(article).text;
		this.ensurePill();
		document.addEventListener('selectionchange', this.onSelectionChange);
		window.addEventListener('scroll', this.onScrollHidePill, true);
		window.addEventListener('resize', this.onScrollHidePill);
		document.addEventListener('click', this.onDocClick, true);
	}

	destroy(): void {
		this.destroyed = true;
		this.clearPaint();
		document.removeEventListener('selectionchange', this.onSelectionChange);
		window.removeEventListener('scroll', this.onScrollHidePill, true);
		window.removeEventListener('resize', this.onScrollHidePill);
		document.removeEventListener('click', this.onDocClick, true);
		this.pill?.remove();
		this.pill = null;
	}

	getArticle(): HTMLElement { return this.article; }
	getRootText(): string { return this.rootText; }

	// ------------------------------------------------------------------
	// Creation
	// ------------------------------------------------------------------

	/** Current trimmed selection as a DOM Range confined to the article, or null. */
	currentSelectionRange(): Range | null {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
		const range = sel.getRangeAt(0);
		if (!this.article.contains(range.commonAncestorContainer)) return null;
		try {
			return trimRange(range);
		} catch {
			return null;
		}
	}

	/**
	 * Create highlight(s) from the live selection. A selection spanning blocks
	 * becomes one highlight per block sharing a groupId (desktop semantics).
	 * Re-selecting text identical to an existing highlight RECOLORS its whole
	 * group instead of duplicating. Returns created/updated members.
	 */
	createFromSelection(color: HlColor): ReaderTextHighlight[] {
		const range = this.currentSelectionRange();
		if (!range) return [];
		const quoteFull = collapseWs(range.toString());
		if (!quoteFull) return [];

		const existing = this.findGroupByQuote(quoteFull);
		if (existing.length > 0) {
			for (const h of existing) this.setColor(h.id, color, /* notify */ true);
			window.getSelection()?.removeAllRanges();
			this.hidePill();
			return existing;
		}

		const base = Date.now();
		const subRanges = this.splitSelectionByBlocks(range);
		const groupId = subRanges.length > 1
			? `grp_${base.toString(36)}_${Math.random().toString(36).slice(2, 6)}`
			: undefined;
		const created: ReaderTextHighlight[] = [];
		subRanges.forEach((r, i) => {
			const anchor = createAnchor(r, this.article, 'web');
			if (!anchor || !anchor.structural) return;
			const id = i === 0 ? String(base) : String(base + i); // decimal ids, desktop-compatible
			const hl: ReaderTextHighlight = {
				type: 'text',
				id,
				xpath: anchor.structural.xpath,
				startOffset: anchor.structural.startOffset,
				endOffset: anchor.structural.endOffset,
				content: collapseWs(r.toString()),
				notes: [],
				color,
				...(groupId ? { groupId } : {}),
				anchor,
				updatedAt: Date.now(),
			};
			this.highlights.push(hl);
			created.push(hl);
		});
		if (created.length === 0) return [];
		this.lastColor = color;
		this.paintAll();
		this.renderBadges();
		for (const hl of created) this.host.onHighlightCreated(hl);
		window.getSelection()?.removeAllRanges();
		this.hidePill();
		return created;
	}

	/** Split a selection into per-block Ranges (supports Ctrl+A select-all). */
	private splitSelectionByBlocks(range: Range): Range[] {
		const span = offsetsFromRange(this.article, range);
		if (!span) return [range];
		const map = buildTextMap(this.article);
		const blocks = new Map<Element, { min: number; max: number }>();
		for (const seg of map.segments) {
			const owner = this.closestBlock(seg.node.parentElement);
			if (!owner) continue;
			const end = seg.start + seg.node.data.length;
			const b = blocks.get(owner);
			if (!b) blocks.set(owner, { min: seg.start, max: end });
			else {
				b.min = Math.min(b.min, seg.start);
				b.max = Math.max(b.max, end);
			}
		}
		const out: Array<{ r: Range; s: number }> = [];
		blocks.forEach((b) => {
			const s = Math.max(span.start, b.min);
			const e = Math.min(span.end, b.max);
			if (s >= e) return;
			if (!map.text.slice(s, e).trim()) return;
			const rl = locateRange(this.article, s, e);
			if (rl) out.push({ r: toDomRange(rl, document), s });
		});
		out.sort((a, b) => a.s - b.s);
		return out.map((o) => o.r);
	}

	private closestBlock(node: Node | null): Element | null {
		let cur: Node | null = node;
		while (cur && cur !== this.article) {
			if (cur.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((cur as Element).tagName)) {
				return cur as Element;
			}
			cur = cur.parentNode;
		}
		return null;
	}

	private findGroupByQuote(quote: string): ReaderTextHighlight[] {
		const hit = this.highlights.find((h) => collapseWs(h.content) === quote);
		if (!hit) return [];
		return hit.groupId
			? this.highlights.filter((h) => h.groupId === hit.groupId)
			: [hit];
	}

	// ------------------------------------------------------------------
	// Painting
	// ------------------------------------------------------------------

	private layer(color: HlColor, active = false): HighlightInstance | null {
		const reg = registry();
		const Ctor = highlightCtor();
		if (!reg || !Ctor) return null;
		const key = active ? `sch-hl-active-${color}` : `sch-hl-${color}`;
		const found = this.layers.get(key);
		if (found) return found;
		const inst = new Ctor();
		inst.priority = active ? 10 : -1;
		reg.set(key, inst);
		this.layers.set(key, inst);
		return inst;
	}

	/** Resolve where a stored highlight paints (xpath-first, quote+fuzzy fallback). */
	resolveRange(hl: ReaderTextHighlight): Range | null {
		// Structural fast path over the reader DOM.
		const el = elementFromXPath(hl.xpath, this.article);
		if (el && hl.endOffset > hl.startOffset) {
			const localText = buildTextMap(el).text.slice(hl.startOffset, hl.endOffset);
			if (localText === collapseWs(hl.content) || localText.trim() === hl.content.trim()) {
				const rl = locateRange(el, hl.startOffset, hl.endOffset);
				if (rl) return toDomRange(rl, document);
			}
		}
		// Portable path: text-quote anchor incl. whitespace-insensitive + fuzzy tiers.
		if (hl.anchor) {
			const rl: RangeLike | null = resolveAnchor(hl.anchor, this.article, 'web', this.rootText);
			if (rl) return toDomRange(rl, document);
		}
		// Last resort for hand-made payloads without an anchor: trust offsets blindly.
		if (el && !hl.anchor) {
			const rl = locateRange(el, hl.startOffset, hl.endOffset);
			if (rl) return toDomRange(rl, document);
		}
		return null;
	}

	/** Repaint everything from `this.highlights` (also used by paintAll JSON). */
	paintAll(next?: ReaderTextHighlight[]): void {
		if (next) {
			this.highlights.length = 0;
			this.highlights.push(...next);
		}
		this.clearPaint();
		let placed = 0;
		for (const hl of this.highlights) {
			const range = this.resolveRange(hl);
			if (!range) continue;
			this.layer(hl.color)?.add(range);
			this.ranges.set(hl.id, [...(this.ranges.get(hl.id) ?? []), range]);
			placed++;
		}
		void placed;
		this.renderBadges();
	}

	clearPaint(): void {
		this.layers.forEach((l, k) => {
			l.clear();
			if (!k.startsWith('sch-hl-active')) this.layers.delete(k);
		});
		this.ranges.clear();
		this.badges.forEach((b) => b.remove());
		this.badges.clear();
	}

	// ------------------------------------------------------------------
	// Mutations
	// ------------------------------------------------------------------

	setColor(id: string, color: HlColor, notify: boolean): ReaderTextHighlight[] {
		const target = this.highlights.find((h) => h.id === id);
		if (!target) return [];
		const members = target.groupId
			? this.highlights.filter((h) => h.groupId === target.groupId)
			: [target];
		const changed: ReaderTextHighlight[] = [];
		for (const m of members) {
			if (m.color === color) continue;
			m.color = color;
			m.updatedAt = Date.now();
			changed.push(m);
		}
		if (changed.length) {
			this.paintAll();
			for (const m of changed) if (notify) this.host.onHighlightUpdated(m);
		}
		return changed;
	}

	deleteById(id: string, notify = true): boolean {
		const target = this.highlights.find((h) => h.id === id);
		if (!target) return false;
		const doomed = target.groupId
			? this.highlights.filter((h) => h.groupId === target.groupId)
			: [target];
		this.highlights.splice(0, this.highlights.length,
			...this.highlights.filter((h) => !doomed.includes(h)));
		this.paintAll();
		if (notify) for (const m of doomed) this.host.onHighlightDeleted(m.id);
		return true;
	}

	reveal(id: string): boolean {
		const target = this.highlights.find((h) => h.id === id);
		if (!target) return false;
		const members = target.groupId
			? this.highlights.filter((h) => h.groupId === target.groupId)
			: [target];
		const first = this.ranges.get(target.id)?.[0];
		if (!first) return false;
		const rect = first.getBoundingClientRect();
		const top = rect.top + window.scrollY - window.innerHeight / 3;
		window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
		for (const m of members) {
			const rs = this.ranges.get(m.id);
			if (rs) rs.forEach((r) => this.layer(m.color, true)?.add(r));
		}
		window.setTimeout(() => {
			members.forEach((m) => this.layer(m.color, true)?.clear());
		}, 2600);
		return true;
	}

	// ------------------------------------------------------------------
	// 💬 badges — one per group at the end of its final painted span
	// ------------------------------------------------------------------

	renderBadges(): void {
		this.badges.forEach((b) => b.remove());
		this.badges.clear();
		if (this.highlights.length === 0) return;
		const groups = new Map<string, ReaderTextHighlight[]>();
		for (const h of this.highlights) {
			const key = h.groupId ?? h.id;
			const g = groups.get(key);
			if (g) g.push(h);
			else groups.set(key, [h]);
		}
		groups.forEach((members, key) => {
			let endRect: DOMRect | null = null;
			for (let i = members.length - 1; i >= 0 && !endRect; i--) {
				const rects = this.ranges.get(members[i].id)?.[0]?.getClientRects();
				if (rects && rects.length) endRect = rects[rects.length - 1] as DOMRect;
			}
			if (!endRect) return;
			const badge = document.createElement('button');
			badge.type = 'button';
			badge.className = 'sch-hl-badge';
			badge.dataset.group = key;
			badge.setAttribute('data-annot-ui', ''); // excluded from buildTextMap
			const noteCount = members.reduce((n, m) => n + m.notes.length, 0);
			badge.textContent = noteCount > 0 ? `💬${noteCount}` : '💬';
			badge.addEventListener('pointerdown', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.host.onSelectionState(JSON.stringify({
					highlightIds: members.map((m) => m.id),
					quote: members[0].content,
				}));
			});
			document.body.appendChild(badge);
			badge.style.left = `${Math.round(endRect.right + window.scrollX + 6)}px`;
			badge.style.top = `${Math.round(endRect.top + window.scrollY - 12)}px`;
			this.badges.set(key, badge);
		});
	}

	repositionBadges(): void { this.renderBadges(); }

	// ------------------------------------------------------------------
	// Swatch pill (floats above selection start)
	// ------------------------------------------------------------------

	private ensurePill(): void {
		if (this.pill) return;
		const pill = document.createElement('div');
		pill.className = 'sch-swatch-pill';
		pill.setAttribute('data-annot-ui', '');
		COLORS.forEach((color) => {
			const dot = document.createElement('button');
			dot.type = 'button';
			dot.className = `sch-swatch-dot color-${color}`;
			dot.dataset.color = color;
			dot.setAttribute('aria-label', `${color} highlight`);
			dot.style.background = COLOR_HEX[color];
			// `pointerdown`, not `click`: right after a native text selection is
			// made, Android's WebView treats the very next tap — anywhere,
			// including on our own pill — as "dismiss the selection", and never
			// synthesizes a `click` for it at all. `pointerdown` fires at the
			// start of that same tap, before the browser has decided that, so
			// it's the only event guaranteed to actually reach us.
			dot.addEventListener('pointerdown', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.onCreateTap(dot.dataset.color as HlColor);
			});
			pill.appendChild(dot);
		});
		const mic = document.createElement('button');
		mic.type = 'button';
		mic.className = 'sch-pill-btn';
		mic.textContent = '🎙';
		mic.setAttribute('aria-label', 'Voice note');
		mic.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.onStateTap(); });
		const cmt = document.createElement('button');
		cmt.type = 'button';
		cmt.className = 'sch-pill-btn';
		cmt.textContent = '💬';
		cmt.setAttribute('aria-label', 'Comment');
		cmt.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.onStateTap(); });
		pill.appendChild(cmt);
		pill.appendChild(mic);
		document.body.appendChild(pill);
		this.pill = pill;
	}

	private onCreateTap(color?: HlColor): void {
		const c = color ?? this.lastColor;
		const created = this.createFromSelection(c);
		if (created.length === 0) { this.hidePill(); return; }
		this.host.onSelectionState(JSON.stringify({
			highlightIds: created.map((h) => h.id),
			quote: created[0].content,
			color: c,
		}));
	}

	private onStateTap(): void {
		const range = this.currentSelectionRange();
		const quote = collapseWs(window.getSelection()?.toString() ?? '');
		if (!range || !quote) { this.hidePill(); return; }
		let ids = this.findGroupByQuote(quote).map((h) => h.id);
		if (ids.length === 0) {
			const created = this.createFromSelection(this.lastColor);
			ids = created.map((h) => h.id);
		}
		if (ids.length === 0) { this.hidePill(); return; }
		this.host.onSelectionState(JSON.stringify({ highlightIds: ids, quote }));
	}

	showPillForSelection(): void {
		const range = this.currentSelectionRange();
		const pill = this.pill;
		if (!range || !pill) { this.hidePill(); return; }
		const rect = range.getBoundingClientRect();
		if (!rect.width && !rect.height) { this.hidePill(); return; }
		pill.classList.add('is-visible');
		const pw = pill.offsetWidth || 150;
		const ph = pill.offsetHeight || 40;
		let left = rect.left;
		left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
		// Default BELOW the selection: Android's native ActionMode toolbar
		// (Copy/Share/Select all) always claims the space above a selection,
		// drawn by the system above the entire WebView surface — placing our
		// pill there means it's permanently hidden behind that native bar.
		// Only fall back above when there's no room below.
		let top = rect.bottom + 10;
		if (top + ph > window.innerHeight - 8) top = rect.top - ph - 10;
		pill.style.left = `${Math.round(left)}px`;
		pill.style.top = `${Math.round(top)}px`;
	}

	hidePill(): void {
		this.pill?.classList.remove('is-visible');
	}

	private onSelectionChange = (): void => {
		if (this.destroyed) return;
		window.setTimeout(() => {
			const sel = window.getSelection();
			if (!sel || sel.isCollapsed) { this.hidePill(); return; }
			this.showPillForSelection();
		}, 120);
	};

	private onScrollHidePill = (): void => { this.hidePill(); };

	private onDocClick = (e: MouseEvent): void => {
		const t = e.target as Element | null;
		if (t?.closest('.sch-swatch-pill')) return;
		// Touch-drag-to-select on Android WebView fires a synthetic `click` on
		// release even when the gesture was a selection, not a tap. A genuine
		// "tap elsewhere to dismiss" collapses the selection first; only hide
		// here when that's actually happened, else the pill closes before the
		// user can ever tap a color.
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed && this.article.contains(sel.anchorNode)) return;
		this.hidePill();
	};
}

export const COLOR_VALUES = COLOR_HEX;
