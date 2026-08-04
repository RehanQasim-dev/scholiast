import { AnyHighlightData, highlights, saveHighlights, updateHighlights, getPageUrl } from './highlighter';
import { getElementByXPath } from './dom-utils';
import { textHighlightRanges, setActiveHighlight } from './highlighter-overlays';
import { loadDiagramImage, deleteDiagramImage, saveDiagramImage } from './video/frame-store';
import { getAll } from './page-store';
import { normalizeUrl } from './url-utils';

let pageSnap: any = null;
let hasFetchedSnap = false;

function getCommentTextFromContentEditable(el: HTMLElement): string {
	let text = '';
	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			text += node.textContent;
		} else if (node.nodeType === Node.ELEMENT_NODE) {
			const element = node as HTMLElement;
			if (element.tagName === 'IMG' && element.classList.contains('obsidian-comment-pasted-img')) {
				const imageId = element.dataset.imageId;
				if (imageId) {
					text += `<!--image:${imageId}-->`;
				}
			} else if (element.tagName === 'A') {
				const href = element.getAttribute('href') || '';
				const linkText = element.textContent || '';
				if (href === linkText) {
					text += linkText;
				} else {
					text += `[${linkText}](${href})`;
				}
			} else if (element.tagName === 'BR') {
				text += '\n';
			} else if (element.tagName === 'DIV' || element.tagName === 'P') {
				if (text.length > 0 && !text.endsWith('\n')) {
					text += '\n';
				}
				for (let i = 0; i < node.childNodes.length; i++) {
					walk(node.childNodes[i]);
				}
				if (element.tagName === 'DIV' && !text.endsWith('\n')) {
					text += '\n';
				}
			} else {
				for (let i = 0; i < node.childNodes.length; i++) {
					walk(node.childNodes[i]);
				}
			}
		}
	};
	for (let i = 0; i < el.childNodes.length; i++) {
		walk(el.childNodes[i]);
	}
	return text.replace(/\n+$/, '');
}

function renderCommentBodyToEditableHtml(text: string): string {
	const parts = text.split(/(<!--image:[A-Za-z0-9_-]+-->)/g);
	let html = '';
	for (const part of parts) {
		if (!part) continue;
		const imgMatch = part.match(/^<!--image:([A-Za-z0-9_-]+)-->$/);
		if (imgMatch) {
			const imageId = imgMatch[1];
			const src = localDiagramCache.get(imageId) || '';
			html += `<img class="obsidian-comment-pasted-img" data-image-id="${imageId}" src="${src || ''}" alt="Pasted image"/>`;
			if (!src) {
				loadDiagramImage(imageId).then(dataUrl => {
					if (dataUrl) {
						localDiagramCache.set(imageId, dataUrl);
						document.querySelectorAll(`img[data-image-id="${imageId}"]`).forEach(img => {
							(img as HTMLImageElement).src = dataUrl;
						});
					}
				});
			}
		} else {
			let chunk = escapeHtml(part);
			
			// 1. Markdown links
			const mdLinks: string[] = [];
			chunk = chunk.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, linkText, url) => {
				const placeholder = `__MDLINK_${mdLinks.length}__`;
				mdLinks.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`);
				return placeholder;
			});

			// 2. Raw URLs
			const urlRegex = /\bhttps?:\/\/[^\s<)]+/g;
			chunk = chunk.replace(urlRegex, (match) => {
				let url = match;
				let suffix = '';
				const trailingPunct = /[.,;:?!]+$/;
				const m = url.match(trailingPunct);
				if (m) {
					suffix = m[0];
					url = url.slice(0, -suffix.length);
				}
				return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` + suffix;
			});

			// 3. Restore Markdown links
			mdLinks.forEach((linkHtml, index) => {
				chunk = chunk.replace(`__MDLINK_${index}__`, linkHtml);
			});

			html += chunk.replace(/\n/g, '<br>');
		}
	}
	return html;
}

function getEditorValue(ta: HTMLElement): string {
	if (ta instanceof HTMLTextAreaElement) return ta.value;
	return getCommentTextFromContentEditable(ta);
}

function setEditorValue(ta: HTMLElement, value: string) {
	if (ta instanceof HTMLTextAreaElement) {
		ta.value = value;
	} else {
		ta.innerHTML = renderCommentBodyToEditableHtml(value);
	}
}

function fetchPageSnap() {
	if (hasFetchedSnap) return;
	hasFetchedSnap = true;
	const currentUrl = normalizeUrl(getPageUrl());
	const snapK = `snap:${currentUrl}`;
	browser.storage.local.get(snapK).then((got: any) => {
		pageSnap = got[snapK] || null;
		renderCommentBoxes();
	});
}

const COMMENT_BOX_WIDTH = 384;
const COMMENT_BOX_MARGIN = 20;
const COMMENT_BOX_GAP = 12;

// Layout width excluding the classic scrollbar — `innerWidth` includes it, which
// made the gutter measurement optimistic by up to ~15px.
const viewportWidth = () => document.documentElement.clientWidth || window.innerWidth;

let activeCommentBoxes = new Map<string, HTMLElement>();
let editingHighlightIds = new Set<string>();
let focusedHighlightId: string | null = null;
let expandedCommentIndexes = new Set<string>(); // highlightId-index
let editingNoteKey: string | null = null; // highlightId-index
const clickTimeouts = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
// Set when mousedown already expanded the comment being clicked (see the
// document mousedown handler). The click that follows the same gesture must not
// treat it as an "already expanded → collapse" toggle.
let expandedOnMousedown: string | null = null;

browser.storage.onChanged.addListener((changes, area) => {
	if (area === 'local') {
		const currentUrl = normalizeUrl(getPageUrl());
		const snapK = `snap:${currentUrl}`;
		if (changes[snapK]) {
			pageSnap = changes[snapK].newValue || null;
			renderCommentBoxes();
		}
	}
	
	if (area === 'local' && changes.diagrams) {
		const newDiagrams = (changes.diagrams.newValue || {}) as Record<string, any>;
		const oldDiagrams = (changes.diagrams.oldValue || {}) as Record<string, any>;
		for (const [id, data] of Object.entries(newDiagrams)) {
			const stamp = (data as any).updatedAt;
			if (!stamp || stamp === oldDiagrams[id]?.updatedAt) continue;
			// A pasted image's bytes never change after it's registered, and the <img>
			// that referenced it is already rendered from the local cache — skip the
			// forced rebuild (which would wipe any editor open elsewhere on the page).
			if ((data as any).pasted && localDiagramCache.has(id)) continue;
			// The rendered PNG now lives in IndexedDB (not in this entry) — fetch it
			// into the cache, then render. Loading first avoids a flash of empty <img>.
			loadDiagramImage(id).then((dataUrl) => {
				if (dataUrl) localDiagramCache.set(id, dataUrl);
				activeCommentBoxes.forEach((box) => boxRenderCache.delete(box));
				// A pending (just-drawn) diagram: now that Excalidraw has actually saved
				// it, create its comment on the highlight that opened the editor. Nothing
				// is written on open, so closing without saving leaves no orphan comment.
				const pendingHid = pendingDiagrams.get(id);
				if (pendingHid) {
					pendingDiagrams.delete(id);
					saveComment(pendingHid, `<!--diagram:${id}-->`);
				} else {
					renderCommentBoxes();
				}
			});
		}
	}
});

// Last innerHTML rendered into each box. renderCommentBoxes() runs on every
// highlight mutation, storage sync, scroll-driven reapply, etc. Rebuilding
// innerHTML every time wipes an open editor (losing in-progress text + focus)
// and — worse — detaches the Save/Cancel buttons. If an async rebuild lands
// between a button's mousedown and mouseup, the click resolves on the box div
// instead of the button and the action silently no-ops. Skipping the rebuild
// when the rendered content is unchanged keeps the editor DOM stable so typing
// and saving work reliably. Keyed by box element so entries GC with the box.
const boxRenderCache = new WeakMap<HTMLElement, string>();
// The same render, split per comment item (+ the reply editor), so updateCommentBox
// can replace only the pieces that actually changed. See its patch path.
const boxItemCache = new WeakMap<HTMLElement, { items: string[]; editor: string }>();

const localDiagramCache = new Map<string, string>();

// Diagrams whose Excalidraw editor is open but not yet saved: diagramId →
// highlightId. The comment is created only once the editor saves (see the
// storage listener above), so an unsaved/closed editor never leaves a stray
// comment.
const pendingDiagrams = new Map<string, string>();

// --- Group handling ----------------------------------------------------------
// A multi-block selection (e.g. several bullet points) produces one highlight
// per block sharing a `groupId`. On the live page we treat the whole group as a
// SINGLE annotation: one comment thread, one box, anchored to the group's first
// piece (its "representative"). All comment ids passed around in this module are
// representative ids.

// Every highlight in the same annotation unit as `h`, in document order.
// `highlights` is kept sorted, so the first entry is the representative.
function groupMembers(h: AnyHighlightData): AnyHighlightData[] {
	if (!h.groupId) return [h];
	return highlights.filter(x => x.groupId === h.groupId);
}

// Map any piece id to its group's representative highlight.
function repFor(id: string): AnyHighlightData | undefined {
	const h = highlights.find(x => x.id === id);
	return h ? groupMembers(h)[0] : undefined;
}

// One flattened comment thread for the whole group. Each ref records which
// piece actually stores the note so edits/deletes target the right highlight.
interface NoteRef { note: string; ownerId: string; ownerIndex: number }
function groupNotes(rep: AnyHighlightData): NoteRef[] {
	const refs: NoteRef[] = [];
	for (const m of groupMembers(rep)) {
		(m.notes || []).forEach((note, ownerIndex) => refs.push({ note, ownerId: m.id, ownerIndex }));
	}
	return refs;
}

function parseNoteString(note: string): { text: string, timestamp?: number, edited?: number } {
	const tsMatch = note.match(/<!--timestamp:(\d+)-->/);
	const edMatch = note.match(/<!--edited:(\d+)-->/);
	const text = note
		.replace(/<!--timestamp:\d+-->/, '')
		.replace(/<!--edited:\d+-->/, '')
		.trim();
	return {
		text,
		// Creation time, also the stable per-comment id used by the sync merge.
		timestamp: tsMatch ? parseInt(tsMatch[1]) : undefined,
		// Last-edit time, written by saveEditedComment; used to resolve when the
		// same comment was edited on two devices.
		edited: edMatch ? parseInt(edMatch[1]) : undefined
	};
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getHighlightBoundingRect(highlight: AnyHighlightData): DOMRect | null {
	if (highlight.type === 'text') {
		const ranges = textHighlightRanges.get(highlight.id);
		if (ranges && ranges.length > 0) {
			const rects = ranges[0].getClientRects();
			if (rects.length > 0) {
				let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
				for (let i = 0; i < rects.length; i++) {
					const r = rects[i];
					if (r.top < top) top = r.top;
					if (r.bottom > bottom) bottom = r.bottom;
					if (r.left < left) left = r.left;
					if (r.right > right) right = r.right;
				}
				return new DOMRect(left, top, right - left, bottom - top);
			}
		}
	} else {
		const target = getElementByXPath(highlight.xpath);
		if (target) {
			return target.getBoundingClientRect();
		}
	}
	return null;
}

export function startAddingComment(highlightId: string) {
	// Comment on the group as a whole, not the individual block that was clicked.
	const rep = repFor(highlightId);
	if (rep) highlightId = rep.id;
	editingHighlightIds.add(highlightId);
	renderCommentBoxes();
	
	// Defer focus slightly so that browser events (like mouseup/click resolution) don't steal focus
	setTimeout(() => {
		const box = activeCommentBoxes.get(highlightId);
		if (box) {
			const textarea = box.querySelector('.new-comment-textarea') as HTMLElement | null;
			if (textarea) {
				textarea.focus({ preventScroll: true });
			}
		}
	}, 50);
}

export function stopAddingComment(highlightId: string) {
	editingHighlightIds.delete(highlightId);
	renderCommentBoxes();
}

// Reflect each comment's collapse state as a class on the live element rather
// than baking it into the box's HTML. Like is-focused, this keeps the rendered
// markup identical regardless of expand state, so toggling never rebuilds the
// box (the cache short-circuits) — which is what makes a single click expand
// instantly and leaves the element intact for a follow-up double-click to edit.
function applyCollapseState(box: HTMLElement, highlightId: string) {
	box.querySelectorAll('.obsidian-comment-text[data-index]').forEach(el => {
		const idx = (el as HTMLElement).dataset.index;
		const expanded = expandedCommentIndexes.has(`${highlightId}-${idx}`);
		el.classList.toggle('is-collapsed', !expanded);
	});
}

export function renderCommentBoxes() {
	fetchPageSnap();

	// Reset layout first to get true un-shifted coordinates
	document.body.style.paddingLeft = '';
	document.body.style.paddingRight = '';
	document.body.style.marginLeft = '';
	document.body.style.marginRight = '';

	// One box per annotation unit (a group → its representative; or an ungrouped
	// highlight). A unit gets a box if any of its pieces carries a comment or its
	// representative is currently being edited.
	const highlightsWithComments: AnyHighlightData[] = [];
	const seenUnits = new Set<string>();
	for (const h of highlights) {
		const key = h.groupId || h.id;
		if (seenUnits.has(key)) continue;
		seenUnits.add(key);
		const rep = groupMembers(h)[0];
		const hasComment = groupMembers(rep).some(m => m.notes && m.notes.length > 0);
		if (hasComment || editingHighlightIds.has(rep.id)) highlightsWithComments.push(rep);
	}

	if (highlightsWithComments.length === 0) {
		// No annotation unit needs a box anymore (e.g. the last commented highlight
		// was just deleted). Tear down any leftover boxes — skipping the cleanup
		// below would otherwise strand an orphaned comment thread on the page.
		for (const box of activeCommentBoxes.values()) box.remove();
		activeCommentBoxes.clear();
		document.body.classList.remove('obsidian-draft-open');
		window.dispatchEvent(new CustomEvent('obsidian-draft-state', { detail: false }));
		return;
	}

	const newActiveBoxes = new Map<string, HTMLElement>();
	// All boxes live in a single right-side column, stacked in document order of
	// their highlights. A single fixed side (vs. per-box best-fit) means boxes
	// never land over left-side page chrome (nav / table of contents) and the
	// column reads top-to-bottom in the same order as the annotations.
	const rightLayoutItems: { id: string, top: number, height: number, el: HTMLElement }[] = [];

	let maxRightDeficit = 0;
	const spaceNeeded = COMMENT_BOX_WIDTH + COMMENT_BOX_MARGIN * 2;

	for (const highlight of highlightsWithComments) {
		let box = activeCommentBoxes.get(highlight.id);
		if (!box) {
			box = createCommentBox(highlight);
			document.body.appendChild(box);
		} else {
			updateCommentBox(box, highlight);
		}
		newActiveBoxes.set(highlight.id, box);
		applyCollapseState(box, highlight.id);

		// Temporarily set position to get accurate offsetHeight
		box.style.top = '0px';
		const boxHeight = box.offsetHeight;

		const rect = getHighlightBoundingRect(highlight);
		if (!rect) {
			box.style.display = 'none';
			continue;
		}
		box.style.display = '';

		const top = rect.top + window.scrollY;

		const availableRight = viewportWidth() - rect.right;
		const deficit = spaceNeeded - availableRight;
		if (deficit > maxRightDeficit) maxRightDeficit = deficit;
		rightLayoutItems.push({ id: highlight.id, top, height: boxHeight, el: box });
	}

	preserveScrollPosition(() => {
		const contentArea = guessMainContentArea(document.body);
		let finalRightMargin = 0;

		if (maxRightDeficit > 0) {
			if (contentArea) {
				const freeSpace = Math.max(0, viewportWidth() - contentArea.right);
				finalRightMargin = Math.max(0, maxRightDeficit - freeSpace);
			} else {
				finalRightMargin = maxRightDeficit;
			}
		}

		if (finalRightMargin > 0) document.body.style.marginRight = `${finalRightMargin}px`;
	});

	// Remove old boxes
	for (const [id, box] of activeCommentBoxes.entries()) {
		if (!newActiveBoxes.has(id)) {
			box.remove();
		}
	}
	activeCommentBoxes = newActiveBoxes;

	// Stack the column: each box sits at its highlight's top, pushed down just
	// enough to clear the box above it.
	rightLayoutItems.sort((a, b) => a.top - b.top);
	// Anchor the column with an explicit `left` in page coordinates instead of
	// `right`. `right` resolves against the containing block, so on any page whose
	// body is positioned the reserved gutter (body margin-right) pushed the boxes
	// left along with the content — straight back on top of the text. That showed
	// up most on zoom, where the gutter is what makes the boxes fit at all.
	const columnPageLeft = window.scrollX + Math.max(
		COMMENT_BOX_MARGIN,
		viewportWidth() - COMMENT_BOX_WIDTH - COMMENT_BOX_MARGIN
	);
	let currentYRight = 0;
	for (const item of rightLayoutItems) {
		const targetY = item.top;
		const actualY = Math.max(currentYRight, targetY);
		// Convert to the box's own containing block (usually the initial containing
		// block, i.e. document origin — but a positioned ancestor shifts it).
		const parent = item.el.offsetParent as HTMLElement | null;
		const originX = parent
			? parent.getBoundingClientRect().left + parent.clientLeft + window.scrollX
			: 0;
		item.el.style.top = `${actualY}px`;
		item.el.style.left = `${columnPageLeft - originX}px`;
		item.el.style.right = 'auto';
		currentYRight = actualY + item.height + COMMENT_BOX_GAP;
	}

	// Reflect draft state outward: the toolbar dims its tool buttons, and the
	// body class swaps the highlighter cursor back to the normal text cursor
	// (annotation is suspended — the selection is for copying into the draft).
	// renderCommentBoxes runs on every editor mutation, so this stays current.
	const draftOpen = hasUnsavedCommentText();
	document.body.classList.toggle('obsidian-draft-open', draftOpen);
	window.dispatchEvent(new CustomEvent('obsidian-draft-state', { detail: draftOpen }));

	// Determine overflow for collapsed comments to show gradient
	requestAnimationFrame(() => {
		activeCommentBoxes.forEach(box => {
			box.querySelectorAll('.obsidian-comment-text.is-collapsed').forEach(el => {
				if (el.scrollHeight > el.clientHeight) {
					el.classList.add('has-overflow');
				} else {
					el.classList.remove('has-overflow');
				}
			});
		});
	});
}

// Window resize AND browser zoom both change how much room is left beside the
// content, so the gutter reservation and the column's x position have to be
// recomputed. Zoom fires `resize` (plus visualViewport `resize` for pinch-zoom);
// without this the boxes kept a layout measured at the previous zoom level and
// ended up over the text.
let relayoutQueued = false;
function relayoutCommentBoxes() {
	if (relayoutQueued || activeCommentBoxes.size === 0) return;
	relayoutQueued = true;
	requestAnimationFrame(() => {
		relayoutQueued = false;
		if (activeCommentBoxes.size > 0) renderCommentBoxes();
	});
}
window.addEventListener('resize', relayoutCommentBoxes);
window.visualViewport?.addEventListener('resize', relayoutCommentBoxes);

// --- Tag autocomplete ----------------------------------------------------------
// Typing `#` in a comment editor pops a small dropdown of known tags (collected
// from every page's saved comments), filtered by the prefix typed so far.
// Nested tags use slashes (#question/important). Enter/Tab or click inserts;
// arrows navigate; Escape closes the menu without touching the draft.

const KNOWN_TAG_RE = /(^|\s)#([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)/g;
// The (possibly partial) #token immediately before the caret.
const TAG_TOKEN_RE = /(^|\s)#([A-Za-z0-9_/-]*)$/;

let tagMenuEl: HTMLDivElement | null = null;
let tagMenuTags: string[] = [];
let tagMenuIndex = 0;
let tagMenuTa: HTMLTextAreaElement | null = null;
// All tags across every page; invalidated whenever a comment is saved.
let knownTagsCache: string[] | null = null;

async function collectKnownTags(): Promise<string[]> {
	if (knownTagsCache) return knownTagsCache;
	const tags = new Set<string>();
	const addFrom = (notes?: string[]) => {
		for (const n of notes || []) {
			const clean = n.replace(/<!--[^>]*-->/g, ' ');
			KNOWN_TAG_RE.lastIndex = 0;
			let m: RegExpExecArray | null;
			while ((m = KNOWN_TAG_RE.exec(clean))) tags.add(m[2]);
		}
	};
	for (const h of highlights) addFrom(h.notes);
	try {
		const all = await getAll<{ highlights?: AnyHighlightData[] }>('hl');
		for (const page of Object.values(all)) {
			for (const h of page.highlights || []) addFrom(h.notes);
		}
	} catch { /* storage unavailable — fall back to current page's tags */ }
	knownTagsCache = [...tags].sort();
	return knownTagsCache;
}

function hideTagMenu() {
	tagMenuEl?.remove();
	tagMenuEl = null;
	tagMenuTags = [];
	tagMenuIndex = 0;
	tagMenuTa = null;
}

// Pixel position of the caret INSIDE a textarea or contenteditable element, relative to
// its own border box.
function getCaretCoordinates(ta: HTMLElement, position?: number): { left: number, top: number, height: number } {
	if (ta instanceof HTMLTextAreaElement) {
		const div = document.createElement('div');
		const computed = getComputedStyle(ta);
		const style = div.style;
		style.position = 'absolute';
		style.visibility = 'hidden';
		style.whiteSpace = 'pre-wrap';
		style.wordWrap = 'break-word';
		style.top = '0';
		style.left = '0';
		const props = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
			'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
			'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontFamily',
			'lineHeight', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing', 'wordSpacing', 'tabSize'];
		for (const p of props) (style as any)[p] = (computed as any)[p];

		div.textContent = ta.value.slice(0, position || 0);
		const span = document.createElement('span');
		span.textContent = ta.value.slice(position || 0) || '.';
		div.appendChild(span);

		(ta.parentElement || document.body).appendChild(div);
		const coords = { left: span.offsetLeft, top: span.offsetTop, height: parseFloat(computed.lineHeight) || 18 };
		div.remove();
		return coords;
	}
	
	const selection = window.getSelection();
	if (selection && selection.rangeCount > 0) {
		const range = selection.getRangeAt(0).cloneRange();
		if (range.collapsed) {
			const span = document.createElement('span');
			span.appendChild(document.createTextNode('\u200b'));
			range.insertNode(span);
			const rect = span.getBoundingClientRect();
			const taRect = ta.getBoundingClientRect();
			span.remove();
			return {
				left: rect.left - taRect.left + ta.scrollLeft,
				top: rect.top - taRect.top + ta.scrollTop,
				height: rect.height || 18
			};
		} else {
			const rect = range.getBoundingClientRect();
			const taRect = ta.getBoundingClientRect();
			return {
				left: rect.left - taRect.left + ta.scrollLeft,
				top: rect.top - taRect.top + ta.scrollTop,
				height: rect.height || 18
			};
		}
	}
	return { left: 0, top: 0, height: 18 };
}

// Place the menu just under the caret line, aligned to the `#`.
function positionTagMenu(ta: HTMLElement) {
	if (!tagMenuEl) return;
	const editor = ta.closest('.obsidian-comment-editor') as HTMLElement | null;
	if (!editor) return;
	const VIEWPORT_MARGIN = 8;

	let left = 0;
	let top = 0;
	let height = 18;

	if (ta instanceof HTMLTextAreaElement) {
		const caret = ta.selectionStart ?? ta.value.length;
		const m = ta.value.slice(0, caret).match(TAG_TOKEN_RE);
		const hashPos = m ? caret - m[2].length - 1 : caret;
		const c = getCaretCoordinates(ta, Math.max(0, hashPos));
		left = ta.offsetLeft + c.left;
		top = ta.offsetTop + c.top + c.height + 2;
		height = c.height;
	} else {
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			const container = range.startContainer;
			const offset = range.startOffset;
			if (container.nodeType === Node.TEXT_NODE) {
				const text = container.textContent || '';
				const preCaretText = text.slice(0, offset);
				const m = preCaretText.match(TAG_TOKEN_RE);
				if (m) {
					const hashOffset = offset - m[2].length - 1;
					const tempRange = document.createRange();
					tempRange.setStart(container, hashOffset);
					tempRange.setEnd(container, hashOffset + 1);
					const rect = tempRange.getBoundingClientRect();
					const taRect = ta.getBoundingClientRect();
					
					left = ta.offsetLeft + (rect.left - taRect.left + ta.scrollLeft);
					top = ta.offsetTop + (rect.top - taRect.top + ta.scrollTop) + rect.height + 2;
					height = rect.height || 18;
				}
			}
		}
	}

	tagMenuEl.style.left = `${left}px`;
	tagMenuEl.style.top = `${top}px`;
	tagMenuEl.style.right = 'auto';

	const rect = tagMenuEl.getBoundingClientRect();
	const overflowRight = rect.right - (window.innerWidth - VIEWPORT_MARGIN);
	if (overflowRight > 0) {
		left -= overflowRight;
		tagMenuEl.style.left = `${left}px`;
	}
	const newRect = tagMenuEl.getBoundingClientRect();
	if (newRect.left < VIEWPORT_MARGIN) {
		left += VIEWPORT_MARGIN - newRect.left;
		tagMenuEl.style.left = `${left}px`;
	}
	const finalRect = tagMenuEl.getBoundingClientRect();
	if (finalRect.bottom > window.innerHeight - VIEWPORT_MARGIN) {
		top = ta.offsetTop + (top - ta.offsetTop - finalRect.height - height - 4);
		tagMenuEl.style.top = `${top}px`;
	}
}

function showTagMenu(ta: HTMLElement, matches: string[]) {
	const editor = ta.closest('.obsidian-comment-editor') as HTMLElement | null;
	if (!editor) return;
	if (!tagMenuEl || tagMenuTa !== ta) {
		hideTagMenu();
		tagMenuEl = document.createElement('div');
		tagMenuEl.className = 'obsidian-tag-autocomplete';
		tagMenuEl.addEventListener('mousedown', (e) => e.preventDefault());
		editor.appendChild(tagMenuEl);
		tagMenuTa = ta;
	}
	tagMenuTags = matches;
	tagMenuIndex = Math.min(tagMenuIndex, matches.length - 1);
	tagMenuEl.replaceChildren();
	matches.forEach((tag, i) => {
		const opt = document.createElement('div');
		opt.className = 'obsidian-tag-option' + (i === tagMenuIndex ? ' is-selected' : '');
		opt.textContent = '#' + tag;
		opt.addEventListener('click', () => insertTagCompletion(ta, tag));
		tagMenuEl!.appendChild(opt);
	});
	positionTagMenu(ta);
	tagMenuEl.children[tagMenuIndex]?.scrollIntoView({ block: 'nearest' });
}

function insertTagCompletion(ta: HTMLElement, tag: string) {
	if (ta instanceof HTMLTextAreaElement) {
		const caret = ta.selectionStart ?? ta.value.length;
		const m = ta.value.slice(0, caret).match(TAG_TOKEN_RE);
		if (m) {
			const start = caret - m[2].length;
			ta.value = ta.value.slice(0, start) + tag + ' ' + ta.value.slice(caret);
			const pos = start + tag.length + 1;
			ta.setSelectionRange(pos, pos);
		}
	} else {
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			const container = range.startContainer;
			const offset = range.startOffset;
			if (container.nodeType === Node.TEXT_NODE) {
				const text = container.textContent || '';
				const preCaretText = text.slice(0, offset);
				const m = preCaretText.match(TAG_TOKEN_RE);
				if (m) {
					const start = offset - m[2].length - 1;
					const postCaretText = text.slice(offset);
					container.textContent = text.slice(0, start) + tag + ' ' + postCaretText;
					
					const newOffset = start + tag.length + 1;
					range.setStart(container, newOffset);
					range.setEnd(container, newOffset);
					selection.removeAllRanges();
					selection.addRange(range);
				}
			}
		}
	}
	hideTagMenu();
	ta.focus();
	autosizeTextarea(ta);
	renderCommentBoxes();
}

// Refresh the dropdown for the token under the caret (or hide it).
function updateTagAutocomplete(ta: HTMLElement) {
	let text = '';
	let caretPos = 0;

	if (ta instanceof HTMLTextAreaElement) {
		text = ta.value;
		caretPos = ta.selectionStart ?? ta.value.length;
	} else {
		text = getEditorValue(ta);
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			const container = range.startContainer;
			const offset = range.startOffset;
			if (container.nodeType === Node.TEXT_NODE) {
				const preCaretText = container.textContent?.slice(0, offset) || '';
				const m = preCaretText.match(TAG_TOKEN_RE);
				if (m) {
					// We match against this local text node prefix
					const prefix = m[2].toLowerCase();
					collectKnownTags().then(all => {
						const selection2 = window.getSelection();
						if (!selection2 || selection2.rangeCount === 0) return;
						const container2 = selection2.getRangeAt(0).startContainer;
						const offset2 = selection2.getRangeAt(0).startOffset;
						const preCaretText2 = container2.textContent?.slice(0, offset2) || '';
						const m2 = preCaretText2.match(TAG_TOKEN_RE);
						if (!m2 || m2[2].toLowerCase() !== prefix) return;
						const matches = all.filter(t => t.toLowerCase().startsWith(prefix) && t.toLowerCase() !== prefix).slice(0, 30);
						if (matches.length === 0) { hideTagMenu(); return; }
						showTagMenu(ta, matches);
					});
					return;
				}
			}
		}
		hideTagMenu();
		return;
	}

	const m = text.slice(0, caretPos).match(TAG_TOKEN_RE);
	if (!m) { hideTagMenu(); return; }
	const prefix = m[2].toLowerCase();
	collectKnownTags().then(all => {
		let currentText = ta instanceof HTMLTextAreaElement ? ta.value : getEditorValue(ta);
		let currentCaret = ta instanceof HTMLTextAreaElement ? (ta.selectionStart ?? currentText.length) : 0; // fallback
		const m2 = currentText.slice(0, currentCaret).match(TAG_TOKEN_RE);
		if (!m2 || m2[2].toLowerCase() !== prefix) return;
		const matches = all.filter(t => t.toLowerCase().startsWith(prefix) && t.toLowerCase() !== prefix).slice(0, 30);
		if (matches.length === 0) { hideTagMenu(); return; }
		showTagMenu(ta, matches);
	});
}

// Keyboard handling while the menu is open.
function tagMenuHandleKey(e: KeyboardEvent, ta: HTMLElement): boolean {
	if (!tagMenuEl || !tagMenuEl.isConnected || tagMenuTa !== ta || tagMenuTags.length === 0) return false;
	if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
		e.preventDefault();
		const dir = e.key === 'ArrowDown' ? 1 : -1;
		tagMenuIndex = (tagMenuIndex + dir + tagMenuTags.length) % tagMenuTags.length;
		showTagMenu(ta, tagMenuTags);
		return true;
	}
	if (e.key === 'Enter' || e.key === 'Tab') {
		e.preventDefault();
		insertTagCompletion(ta, tagMenuTags[tagMenuIndex]);
		return true;
	}
	if (e.key === 'Escape') {
		e.preventDefault();
		e.stopPropagation();
		hideTagMenu();
		return true;
	}
	return false;
}

// Toggle is-single-line/is-multi-line so the send button sits inline on the
// right for a single line and drops below once the text wraps. Handles both the
// legacy textarea and the contenteditable editor.
function autosizeTextarea(ta: HTMLElement) {
	const editorDiv = ta.closest('.obsidian-comment-editor');
	if (!editorDiv) return;

	// Measure with single-line padding (padding-right reserves room for the
	// button) so wrapping is detected against the actual usable width.
	editorDiv.classList.add('is-single-line');
	editorDiv.classList.remove('is-multi-line');

	if (ta instanceof HTMLTextAreaElement) {
		ta.style.height = 'auto';
	}

	if (ta.scrollHeight > 35) {
		editorDiv.classList.remove('is-single-line');
		editorDiv.classList.add('is-multi-line');
	}

	if (ta instanceof HTMLTextAreaElement) {
		ta.style.height = 'auto';
		ta.style.height = `${ta.scrollHeight}px`;
	}
}

function wrapSelection(ta: HTMLElement, marker: string) {
	if (ta instanceof HTMLTextAreaElement) {
		const { selectionStart: s, selectionEnd: e, value } = ta;
		const selected = value.slice(s, e);
		ta.value = value.slice(0, s) + marker + selected + marker + value.slice(e);
		if (selected) {
			ta.setSelectionRange(s + marker.length, e + marker.length);
		} else {
			ta.setSelectionRange(s + marker.length, s + marker.length);
		}
		return;
	}

	const selection = window.getSelection();
	if (selection && selection.rangeCount > 0) {
		const range = selection.getRangeAt(0);
		const selectedText = range.toString();
		const wrapper = document.createTextNode(marker + selectedText + marker);
		range.deleteContents();
		range.insertNode(wrapper);
		
		range.selectNode(wrapper);
		selection.removeAllRanges();
		selection.addRange(range);
	}
	ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// editingNoteKey is `${highlightId}-${index}`. Highlight ids never contain '-'
// (they're timestamps or `<ts>_tx_<n>` style), so split on the last dash.
function parseNoteKey(key: string): { highlightId: string; index: number } {
	const dash = key.lastIndexOf('-');
	return { highlightId: key.slice(0, dash), index: parseInt(key.slice(dash + 1)) };
}

// Render a small, safe subset of inline markdown in *displayed* comments:
// [text](http(s) url), **bold**, *italic*. Input is already HTML-escaped, so
// only the tags we emit here are live HTML. Links are restricted to http(s).
function renderInlineMarkdown(escaped: string): string {
	const mdLinks: string[] = [];
	let html = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (match, text, url) => {
		const placeholder = `__MDLINK_${mdLinks.length}__`;
		mdLinks.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`);
		return placeholder;
	});

	const urlRegex = /\bhttps?:\/\/[^\s<)]+/g;
	html = html.replace(urlRegex, (match) => {
		let url = match;
		let suffix = '';
		const trailingPunct = /[.,;:?!]+$/;
		const m = url.match(trailingPunct);
		if (m) {
			suffix = m[0];
			url = url.slice(0, -suffix.length);
		}
		return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>` + suffix;
	});

	mdLinks.forEach((linkHtml, index) => {
		html = html.replace(`__MDLINK_${index}__`, linkHtml);
	});

	return html
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>')
		.replace(/\n/g, '<br>');
}

// Focus the edit editor **synchronously**, in the same task as the render that
// created it. Deferring it (setTimeout) and re-rendering afterwards gave entering
// edit mode two paints: the swapped-in editor first, then a second frame where the
// caret/sizing/stacking settled — which read as a flicker.
function focusEditTextarea(highlightId: string) {
	const box = activeCommentBoxes.get(highlightId);
	if (!box) return;
	const ta = box.querySelector('.edit-comment-textarea') as HTMLElement | null;
	if (!ta) return;

	ta.focus({ preventScroll: true });
	autosizeTextarea(ta);
	const editorDiv = ta.closest('.obsidian-comment-editor');
	if (editorDiv && getEditorValue(ta).trim().length > 0) {
		editorDiv.classList.add('has-text');
	}

	const selection = window.getSelection();
	if (selection) {
		const range = document.createRange();
		range.selectNodeContents(ta);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
	}
}

function createCommentBox(highlight: AnyHighlightData): HTMLElement {
	const box = document.createElement('div');
	box.className = 'obsidian-comment-box';
	box.dataset.highlightId = highlight.id;
	// Drives the box's permanent color-matched border (see highlighter.scss).
	box.dataset.color = highlight.color || 'yellow';
	box.style.width = `${COMMENT_BOX_WIDTH}px`;

	updateCommentBox(box, highlight);
	
	// Add event delegation for save/delete actions
	box.addEventListener('click', (e) => {
		const target = e.target as HTMLElement;
		if (target.closest('.obsidian-comment-save')) {
			const textarea = box.querySelector('.new-comment-textarea') as HTMLElement;
			if (textarea) {
				const text = getEditorValue(textarea).trim();
				saveComment(highlight.id, text);
			}
		} else if (target.closest('.obsidian-comment-save-edit')) {
			const textarea = box.querySelector('.edit-comment-textarea') as HTMLElement;
			if (textarea && editingNoteKey) {
				const { highlightId, index } = parseNoteKey(editingNoteKey);
				saveEditedComment(highlightId, index, getEditorValue(textarea).trim());
			}
		} else if (target.closest('.obsidian-comment-cancel')) {
			stopAddingComment(highlight.id);
		} else if (target.closest('.obsidian-comment-cancel-edit')) {
			editingNoteKey = null;
			renderCommentBoxes();
		} else if (target.closest('.obsidian-comment-edit')) {
			const noteIndex = parseInt((target.closest('.obsidian-comment-edit') as HTMLElement).dataset.index || '0');
			editingNoteKey = `${highlight.id}-${noteIndex}`;
			renderCommentBoxes();
			focusEditTextarea(highlight.id);
		} else if (target.closest('.obsidian-comment-delete')) {
			const noteIndex = parseInt((target.closest('.obsidian-comment-delete') as HTMLElement).dataset.index || '0');
			deleteComment(highlight.id, noteIndex);
		} else if (target.closest('.obsidian-comment-thread-delete')) {
			deleteCommentThread(highlight.id);
		} else if (target.closest('.obsidian-comment-save-new')) {
			const textarea = box.querySelector('.new-comment-textarea') as HTMLElement;
			if (textarea) {
				const text = getEditorValue(textarea).trim();
				saveComment(highlight.id, text);
			}
		} else if (target.closest('.obsidian-comment-diagram-new')) {
			// Open the editor for a brand-new diagram WITHOUT writing a comment yet.
			// The comment is created when (and only when) the editor saves an image.
			const diagramId = 'd' + Math.random().toString(36).substring(2, 9);
			pendingDiagrams.set(diagramId, highlight.id);
			browser.runtime.sendMessage({ action: 'openPopupWithDiagram', id: diagramId });
		} else if (target.closest('.obsidian-comment-diagram-img')) {
			const img = target.closest('.obsidian-comment-diagram-img') as HTMLImageElement;
			const diagramId = img.dataset.diagramId;
			if (diagramId) {
				browser.runtime.sendMessage({ action: 'openPopupWithDiagram', id: diagramId });
			}
		} else if (target.closest('.obsidian-comment-text')) {
			const textEl = target.closest('.obsidian-comment-text') as HTMLElement;
			const noteIndex = textEl.dataset.index;
			const expandKey = `${highlight.id}-${noteIndex}`;
			
			if (clickTimeouts.has(textEl)) {
				clearTimeout(clickTimeouts.get(textEl));
				clickTimeouts.delete(textEl);
			}

			// This gesture's mousedown already expanded it — don't read that as an
			// "already expanded" state and collapse it right back.
			if (expandedOnMousedown === expandKey) {
				expandedOnMousedown = null;
				return;
			}

			if (expandedCommentIndexes.has(expandKey)) {
				const timeout = setTimeout(() => {
					expandedCommentIndexes.delete(expandKey);
					textEl.classList.add('is-collapsed');
					renderCommentBoxes();
					clickTimeouts.delete(textEl);
				}, 180);
				clickTimeouts.set(textEl, timeout);
			} else {
				const overflows = textEl.classList.contains('has-overflow') || textEl.scrollHeight > textEl.clientHeight;
				if (overflows) {
					expandedCommentIndexes.add(expandKey);
					textEl.classList.remove('is-collapsed');
					renderCommentBoxes();
				}
			}
		}
	});

	box.addEventListener('mouseenter', () => setActiveHighlight(highlight.id));
	box.addEventListener('mouseleave', () => setActiveHighlight(null));

	box.addEventListener('dblclick', (e) => {
		const target = e.target as HTMLElement;
		const textEl = target.closest('.obsidian-comment-text') as HTMLElement;
		if (textEl) {
			// The native double-click word selection would land on text we're about to
			// replace with the editor, and re-selecting it fights the caret we place.
			e.preventDefault();
			if (clickTimeouts.has(textEl)) {
				clearTimeout(clickTimeouts.get(textEl));
				clickTimeouts.delete(textEl);
			}
			const noteIndex = textEl.dataset.index;
			if (noteIndex !== undefined) {
				editingNoteKey = `${highlight.id}-${noteIndex}`;
				expandedCommentIndexes.add(editingNoteKey);
				// Render + focus in this same task, so the switch into edit mode is a
				// single paint.
				renderCommentBoxes();
				focusEditTextarea(highlight.id);
			}
		}
	});

	// Keep the editor sized to its content as the user types, and glow the submit button.
	box.addEventListener('input', (e) => {
		const ta = e.target as HTMLElement;
		if (ta.classList.contains('edit-comment-textarea') || ta.classList.contains('new-comment-textarea')) {
			updateTagAutocomplete(ta);
			autosizeTextarea(ta);

			const editorDiv = ta.closest('.obsidian-comment-editor');
			if (editorDiv) {
				const text = getEditorValue(ta);
				if (text.trim().length > 0) {
					editorDiv.classList.add('has-text');
				} else {
					editorDiv.classList.remove('has-text');
				}
			}
			renderCommentBoxes();
		}
	});

	box.addEventListener('paste', async (e) => {
		const ta = e.target as HTMLElement;
		if (ta.classList.contains('edit-comment-textarea') || ta.classList.contains('new-comment-textarea')) {
			const clipboardData = e.clipboardData;
			if (!clipboardData) return;

			let hasImage = false;
			for (const item of clipboardData.items) {
				if (item.type.startsWith('image/')) {
					hasImage = true;
					e.preventDefault();
					const file = item.getAsFile();
					if (file) {
						const reader = new FileReader();
						reader.onload = (ev) => {
							const dataUrl = ev.target?.result as string;
							const imageId = 'img_' + Math.random().toString(36).substring(2, 9);
							saveDiagramImage(imageId, dataUrl).then(() => {
								localDiagramCache.set(imageId, dataUrl);
								
								// Insert image into contenteditable
								const selection = window.getSelection();
								if (selection && selection.rangeCount > 0) {
									const range = selection.getRangeAt(0);
									range.deleteContents();

									let insertNextToImage = false;
									let brToRemove: HTMLElement | null = null;
									
									const startNode = range.startContainer;
									const startOffset = range.startOffset;
									
									let container = startNode as HTMLElement;
									let offset = startOffset;
									
									if (startNode.nodeType === Node.TEXT_NODE) {
										container = startNode.parentNode as HTMLElement;
										offset = Array.from(container.childNodes).indexOf(startNode as ChildNode);
									}

									let consecutiveImages = 0;
									let idx = offset - 1;
									while (idx >= 0) {
										const sibling = container.childNodes[idx] as HTMLElement;
										if (sibling && sibling.tagName === 'IMG' && sibling.classList.contains('obsidian-comment-pasted-img')) {
											consecutiveImages++;
											idx--;
										} else if (sibling && sibling.tagName === 'BR') {
											if (idx > 0 && (container.childNodes[idx - 1] as HTMLElement).tagName === 'IMG') {
												idx--;
											} else {
												break;
											}
										} else {
											break;
										}
									}

									if (consecutiveImages % 2 === 1) {
										insertNextToImage = true;
										const prevSibling = container.childNodes[offset - 1] as HTMLElement;
										if (prevSibling && prevSibling.tagName === 'BR') {
											brToRemove = prevSibling;
										}
									}

									if (insertNextToImage && brToRemove) {
										brToRemove.remove();
									}

									const img = document.createElement('img');
									img.className = 'obsidian-comment-pasted-img';
									img.dataset.imageId = imageId;
									img.src = dataUrl;

									const frag = document.createDocumentFragment();
									frag.appendChild(img);
									
									const br = document.createElement('br');
									frag.appendChild(br);

									range.insertNode(frag);
									
									range.setStartAfter(br);
									range.setEndAfter(br);
									selection.removeAllRanges();
									selection.addRange(range);
								}
								
								ta.dispatchEvent(new Event('input', { bubbles: true }));
							});
						};
						reader.readAsDataURL(file);
					}
					break;
				}
			}

			if (!hasImage) {
				const pastedText = clipboardData.getData('text/plain');
				const urlMatch = pastedText.trim().match(/^https?:\/\/[^\s<)]+$/);
				if (urlMatch) {
					e.preventDefault();
					const url = urlMatch[0];
					const selection = window.getSelection();
					if (selection && selection.rangeCount > 0) {
						const range = selection.getRangeAt(0);
						range.deleteContents();
						
						const a = document.createElement('a');
						a.href = url;
						a.target = '_blank';
						a.rel = 'noopener noreferrer';
						a.textContent = url;
						
						range.insertNode(a);
						
						range.setStartAfter(a);
						range.setEndAfter(a);
						selection.removeAllRanges();
						selection.addRange(range);
					}
					ta.dispatchEvent(new Event('input', { bubbles: true }));
				}
			}
		}
	});

	box.addEventListener('keydown', (e) => {
		const ta = e.target as HTMLElement;
		const isNew = ta.classList.contains('new-comment-textarea');
		const isEdit = ta.classList.contains('edit-comment-textarea');
		if (!isNew && !isEdit) return;

		if (tagMenuHandleKey(e, ta)) return;

		if (e.key === 'Enter' && e.ctrlKey) {
			if (e.isComposing) return;
			e.preventDefault();
			if (isNew) {
				saveComment(highlight.id, getEditorValue(ta).trim());
			} else if (editingNoteKey) {
				const { highlightId, index } = parseNoteKey(editingNoteKey);
				saveEditedComment(highlightId, index, getEditorValue(ta).trim());
			}
			return;
		}

		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			if (isNew) {
				setEditorValue(ta, '');
				stopAddingComment(highlight.id);
				if (focusedHighlightId === highlight.id) focusedHighlightId = null;
				renderCommentBoxes();
			} else if (editingNoteKey) {
				editingNoteKey = null;
				renderCommentBoxes();
			}
			return;
		}

		if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'i' || e.key === 'B' || e.key === 'I')) {
			e.preventDefault();
			wrapSelection(ta, e.key.toLowerCase() === 'b' ? '**' : '*');
		}
	});

	return box;
}



function renderCommentBody(text: string, box: HTMLElement): string {
	const parts = text.split(/(<!--image:[A-Za-z0-9_-]+-->)/g);
	let html = '';
	let currentImageGroup: string[] = [];

	const flushImageGroup = () => {
		if (currentImageGroup.length > 0) {
			html += '<div class="obsidian-comment-image-gallery">';
			for (const imageId of currentImageGroup) {
				const src = localDiagramCache.get(imageId) || '';
				if (!src) {
					loadDiagramImage(imageId).then(dataUrl => {
						if (dataUrl) {
							localDiagramCache.set(imageId, dataUrl);
							boxRenderCache.delete(box);
							renderCommentBoxes();
						}
					});
				}
				html += `<img class="obsidian-comment-pasted-img" data-image-id="${imageId}" src="${src || ''}" alt="Pasted image"/>`;
			}
			html += '</div>';
			currentImageGroup = [];
		}
	};

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (!part) continue;

		const imgMatch = part.match(/^<!--image:([A-Za-z0-9_-]+)-->$/);
		if (imgMatch) {
			currentImageGroup.push(imgMatch[1]);
		} else {
			if (part.trim() === '') {
				continue;
			}
			flushImageGroup();
			
			let textHtml = escapeHtml(part);
			textHtml = renderInlineMarkdown(textHtml);
			textHtml = textHtml.replace(/(^|\s)(#[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)/g, '$1<span class="obsidian-inline-tag">$2</span>');
			html += `<div class="obsidian-comment-text-block">${textHtml}</div>`;
		}
	}
	flushImageGroup();

	return html;
}

function updateCommentBox(box: HTMLElement, highlight: AnyHighlightData) {
	// `highlight` is the group representative; the thread aggregates every piece.
	const noteRefs = groupNotes(highlight);
	const notes = noteRefs.map(r => r.note);
	const isEditing = editingHighlightIds.has(highlight.id);
	const isFocused = focusedHighlightId === highlight.id || isEditing;

	// Focus state is reflected as a class (not baked into the HTML) so the box's
	// rendered markup is identical whether or not it's focused. That keeps the
	// DOM stable across a focus change, which is essential: rebuilding innerHTML
	// on focus used to detach the very element the user just clicked, swallowing
	// that click — so expanding a comment took two clicks (one to focus, one to
	// expand). With visibility driven by CSS, a single click both focuses and
	// expands. Applied before the cache short-circuit so focus always updates.
	box.classList.toggle('is-focused', isFocused);
	// No comments yet → collapse the outer card so the new-comment field is a
	// single slim box rather than a box-within-a-box.
	box.classList.toggle('is-empty', notes.length === 0);

	// The comment editor / reply field. Always rendered (hidden via CSS unless
	// the box is focused) so toggling focus never rebuilds the DOM. It sits after
	// the comment list, so the reply field is always at the end of the thread.
	const editorHtml = `
		<div class="obsidian-comment-editor sleek-input">
			<div class="new-comment-textarea obsidian-comment-editor-contenteditable" contenteditable="true" placeholder="${notes.length > 0 ? 'Reply…' : 'Add a comment…'}"></div>
			<div class="obsidian-comment-editor-actions">
				<button class="obsidian-comment-diagram-new" aria-label="Add Diagram" title="Add Diagram">
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>
				</button>
				<button class="obsidian-comment-save-new" aria-label="Submit">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
				</button>
			</div>
		</div>
	`;

	// Per-item markup, kept as separate strings so a render that changes ONE note
	// (entering edit mode, a sync icon flipping) can patch just that note's element
	// instead of replacing the card's innerHTML — which re-created every <img> in
	// the thread and made the switch into edit mode visibly blink.
	const itemHtmls: string[] = [];
	{
		notes.forEach((note, index) => {
			const isEditingThisNote = editingNoteKey === `${highlight.id}-${index}`;
			const parsed = parseNoteString(note);

			let displayHtml = '';
			const diagramMatch = parsed.text.match(/^<!--diagram:([A-Za-z0-9_-]+)-->$/);
			
			if (diagramMatch) {
				const diagramId = diagramMatch[1];
				const src = localDiagramCache.get(diagramId) || '';
				displayHtml = `<img class="obsidian-comment-diagram-img" data-diagram-id="${diagramId}" src="${src}" alt="Diagram"/>`;
				if (!src) {
					loadDiagramImage(diagramId).then(dataUrl => {
						if (dataUrl) {
							localDiagramCache.set(diagramId, dataUrl);
							boxRenderCache.delete(box);
							renderCommentBoxes();
						}
					});
				}
			} else {
				displayHtml = renderCommentBody(parsed.text, box);
			}

			let isSynced = false;
			if (pageSnap && pageSnap.highlights) {
				const snapHl = pageSnap.highlights.find((h: any) => h.id === highlight.id);
				if (snapHl && snapHl.notes && snapHl.notes.includes(note)) {
					isSynced = true;
				}
			}

			// Threaded layout: a header line (colored dot on the thread rail +
			// timestamp + hover actions) that stays IDENTICAL whether or not this
			// note is being edited — so entering edit mode only swaps the text line
			// for an inline editor and nothing jumps. The body beneath the header is
			// either the rendered text or the edit textarea.
			const bodyHtml = isEditingThisNote
				? `<div class="obsidian-comment-editor sleek-input is-editing">
						<div class="edit-comment-textarea obsidian-comment-editor-contenteditable" contenteditable="true">${renderCommentBodyToEditableHtml(parsed.text)}</div>
						<div class="obsidian-comment-editor-actions">
							<button class="obsidian-comment-diagram-new" aria-label="Add Diagram" title="Add Diagram">
								<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>
							</button>
							<button class="obsidian-comment-save-edit obsidian-comment-save-new" aria-label="Submit">
								<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
							</button>
						</div>
					</div>`
				: `<div class="obsidian-comment-text" data-index="${index}">${displayHtml}</div>`;
			itemHtmls.push(`
				<div class="obsidian-comment-item">
					<div class="obsidian-comment-item-header">
						<span class="obsidian-comment-dot"></span>
						${parsed.timestamp ? `<span class="obsidian-comment-timestamp">${formatTime(parsed.timestamp)}</span>` : '<span class="obsidian-comment-timestamp"></span>'}
						<div class="obsidian-comment-actions-inline">
							<span class="obsidian-comment-sync-status ${isSynced ? 'synced' : 'unsynced'}" aria-label="${isSynced ? 'Synced' : 'Not synced'}" title="${isSynced ? 'Synced to Google Drive' : 'Waiting to sync'}">
								${isSynced 
									? `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`
									: `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>`
								}
							</span>
							<button class="obsidian-comment-edit" data-index="${index}" aria-label="Edit comment">
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
							</button>
							<button class="obsidian-comment-delete" data-index="${index}" aria-label="Delete comment">
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
							</button>
							${index === 0 && notes.length > 1 ? `<button class="obsidian-comment-thread-delete" aria-label="Delete comment thread" title="Delete comment thread">
								<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
							</button>` : ''}
						</div>
					</div>
					${bodyHtml}
				</div>
			`);
		});
	}

	// While a note in this thread is being edited, the reply/new-comment field is
	// hidden — an inline edit editor is already open, so a second editor below it is
	// confusing and redundant. It stays MOUNTED and is hidden by CSS (see the
	// `is-editing-note` rules): removing it from the markup changed the box's height,
	// so entering and leaving edit mode re-stacked the whole column.
	const isEditingNoteInThisBox = editingNoteKey?.startsWith(`${highlight.id}-`) ?? false;
	box.classList.toggle('is-editing-note', isEditingNoteInThisBox);

	// Keep the color-matched border in sync if the highlight was recolored.
	box.dataset.color = highlight.color || 'yellow';

	// Only touch the DOM when the rendered content actually changed. An open
	// editor's textarea value (and the add-comment editor's emptiness) is not part
	// of the markup, so skipping the rebuild preserves whatever the user has typed
	// and keeps the Save/Cancel buttons attached across re-renders.
	const signature = itemHtmls.join('') + editorHtml;
	if (boxRenderCache.get(box) === signature) {
		syncDraftClass(box);
		return;
	}

	const prev = boxItemCache.get(box);
	const list = box.querySelector(':scope > .obsidian-comment-list');
	const editorEl = box.querySelector(':scope > .obsidian-comment-editor');
	// Same set of notes as last render → patch only the items that changed, leaving
	// every other element (and its already-decoded images) untouched.
	const canPatch = !!prev
		&& !!editorEl
		&& prev.items.length === itemHtmls.length
		&& (itemHtmls.length === 0 || (!!list && list.children.length === itemHtmls.length));

	if (canPatch) {
		itemHtmls.forEach((itemHtml, index) => {
			if (prev!.items[index] === itemHtml) return;
			const replacement = htmlToElement(itemHtml);
			if (replacement) list!.children[index].replaceWith(replacement);
		});
		if (prev!.editor !== editorHtml) {
			const replacement = htmlToElement(editorHtml);
			if (replacement) editorEl!.replaceWith(replacement);
		}
	} else {
		box.innerHTML = (itemHtmls.length
			? `<div class="obsidian-comment-list">${itemHtmls.join('')}</div>`
			: '') + editorHtml;
	}

	boxItemCache.set(box, { items: itemHtmls, editor: editorHtml });
	boxRenderCache.set(box, signature);
	syncDraftClass(box);
}

function htmlToElement(html: string): Element | null {
	const holder = document.createElement('div');
	holder.innerHTML = html;
	return holder.firstElementChild;
}

// A box whose reply editor holds draft text keeps that editor visible even
// when the box isn't focused (drafts persist across click-away). Recomputed on
// every render from the live textarea value — after an innerHTML rebuild the
// textarea is fresh/empty, so the class drops off automatically.
function syncDraftClass(box: HTMLElement) {
	const ta = box.querySelector(':scope > .obsidian-comment-editor .new-comment-textarea') as HTMLElement | null;
	box.classList.toggle('has-draft', !!ta && getEditorValue(ta).trim().length > 0);
}

window.addEventListener('obsidian-add-comment', ((e: CustomEvent) => {
	startAddingComment(e.detail);
}) as EventListener);

// --- Draft model ---------------------------------------------------------------
// A comment editor with text in it is a DRAFT. Drafts never save or die
// silently: they persist across clicks/scrolls/selections until the user
// explicitly submits (Enter / ↑ button) or discards (Escape). While a draft is
// open, highlight creation is suspended (the highlighter checks
// hasUnsavedCommentText() and calls flashDraftAttention() instead). Only
// EMPTY editors are cleaned up on click-away.

// True while any visible comment editor holds uncommitted text.
export function hasUnsavedCommentText(): boolean {
	for (const box of activeCommentBoxes.values()) {
		const tas = box.querySelectorAll('.new-comment-textarea, .edit-comment-textarea');
		for (const ta of Array.from(tas) as HTMLElement[]) {
			if (ta.offsetParent !== null && getEditorValue(ta).trim()) return true;
		}
	}
	return false;
}

// The original (saved) text of the note being edited, for detecting whether an
// open edit editor has actually been changed.
function originalTextForNoteKey(noteKey: string): string | undefined {
	const { highlightId, index } = parseNoteKey(noteKey);
	const rep = highlights.find(h => h.id === highlightId);
	const ref = rep ? groupNotes(rep)[index] : undefined;
	return ref ? parseNoteString(ref.note).text : undefined;
}

document.addEventListener('mousedown', (e) => {
	const target = e.target as HTMLElement | null;
	const box = target?.closest('.obsidian-comment-box') as HTMLElement | null;
	expandedOnMousedown = null;

	if (!box) {
		hideTagMenu();
		if (editingHighlightIds.size === 0 && !editingNoteKey && !focusedHighlightId && expandedCommentIndexes.size === 0) {
			return;
		}
		// Defer the cleanup until after mouseup: tearing boxes down on mousedown
		// re-runs the layout (body margin shifts), which moves the text under the
		// cursor mid-selection-drag and breaks highlight creation. Deferring keeps
		// the layout frozen for the whole drag. Only editors open NOW are
		// considered — one opened by this very gesture (Ctrl+drag → new comment
		// box) must survive.
		//
		// No commit happens here: drafts (editors with text) stay open. Only
		// EMPTY new-comment editors and UNCHANGED edit editors are closed.
		const staleEditing = new Set(editingHighlightIds);
		const staleFocused = focusedHighlightId;
		const staleNoteKey = editingNoteKey;
		window.addEventListener('mouseup', () => {
			setTimeout(() => {
				for (const id of staleEditing) {
					if (!editingHighlightIds.has(id)) continue;
					const ta = activeCommentBoxes.get(id)?.querySelector('.new-comment-textarea') as HTMLElement | null;
					if (!ta || !getEditorValue(ta).trim()) stopAddingComment(id);
				}
				if (staleNoteKey && editingNoteKey === staleNoteKey) {
					const ta = activeCommentBoxes.get(parseNoteKey(staleNoteKey).highlightId)
						?.querySelector('.edit-comment-textarea') as HTMLElement | null;
					const original = originalTextForNoteKey(staleNoteKey);
					if (!ta || getEditorValue(ta).trim() === '' || getEditorValue(ta).trim() === original) {
						editingNoteKey = null;
					}
				}
				if (focusedHighlightId === staleFocused) focusedHighlightId = null;
				expandedCommentIndexes.clear();
				renderCommentBoxes();
			}, 0);
		}, { once: true, capture: true });
		return;
	}

	const highlightId = Array.from(activeCommentBoxes.entries()).find(([_, b]) => b === box)?.[0];
	const focusChanged = !!highlightId && focusedHighlightId !== highlightId;
	if (focusChanged) {
		// Focus moves to this box; drafts elsewhere stay open untouched. Comments
		// expanded in the box we just left collapse with it, matching what clicking
		// on empty page does.
		for (const key of [...expandedCommentIndexes]) {
			if (!key.startsWith(`${highlightId}-`)) expandedCommentIndexes.delete(key);
		}
		focusedHighlightId = highlightId!;
	}

	// Expand a clamped comment on mousedown rather than waiting for the click.
	// Focus (which reveals the thread's reply field) lands on mousedown, so
	// expanding on the later click made the reply field appear one frame before
	// the comment unfolded. Doing both here means a single render shows both.
	let expandChanged = false;
	const textEl = (e.target as HTMLElement | null)?.closest('.obsidian-comment-text') as HTMLElement | null;
	if (highlightId && textEl && textEl.dataset.index !== undefined) {
		const expandKey = `${highlightId}-${textEl.dataset.index}`;
		const overflows = textEl.classList.contains('has-overflow') || textEl.scrollHeight > textEl.clientHeight;
		if (!expandedCommentIndexes.has(expandKey) && overflows) {
			expandedCommentIndexes.add(expandKey);
			textEl.classList.remove('is-collapsed');
			expandedOnMousedown = expandKey;
			expandChanged = true;
		}
	}

	if (focusChanged || expandChanged) renderCommentBoxes();
}, true);

// Pasted images live in the same IndexedDB store as diagrams, but nothing used to
// record them in the `diagrams` map — and the sync engine derives a page's image
// pointers from that map. So a pasted image was stored locally, never uploaded,
// and came back as a blank <img> on a device that restored from backup. Registering
// an entry here (at save time, so an abandoned draft leaves nothing behind) makes a
// pasted image sync exactly like a drawn diagram. `pasted: true` marks the bytes as
// immutable, which lets the storage listener skip a pointless re-render.
async function registerPastedImages(text: string): Promise<void> {
	const ids = [...text.matchAll(/<!--image:([A-Za-z0-9_-]+)-->/g)].map(m => m[1]);
	if (ids.length === 0) return;
	const res = await browser.storage.local.get('diagrams');
	const diagrams = (res.diagrams || {}) as Record<string, any>;
	let changed = false;
	for (const id of ids) {
		if (diagrams[id]) continue;
		diagrams[id] = { updatedAt: Date.now(), pasted: true };
		changed = true;
	}
	if (changed) await browser.storage.local.set({ diagrams });
}

// Drop `diagrams` map entries for images whose comment was deleted, so the sync
// engine stops treating them as live pointers.
async function forgetDiagramEntries(ids: string[]): Promise<void> {
	const res = await browser.storage.local.get('diagrams');
	const diagrams = (res.diagrams || {}) as Record<string, any>;
	let changed = false;
	for (const id of ids) {
		if (!diagrams[id]) continue;
		delete diagrams[id];
		changed = true;
	}
	if (changed) await browser.storage.local.set({ diagrams });
}

function saveComment(highlightId: string, text: string) {
	hideTagMenu();
	knownTagsCache = null; // the new comment may introduce new tags
	if (!text) {
		stopAddingComment(highlightId);
		if (focusedHighlightId === highlightId) {
			focusedHighlightId = null;
			renderCommentBoxes();
		}
		return;
	}
	
	const formattedText = `${text}<!--timestamp:${Date.now()}-->`;
	void registerPastedImages(text);

	const highlight = highlights.find(h => h.id === highlightId);
	if (highlight) {
		// Build a NEW highlight object (don't mutate in place) so updateHighlights'
		// pre-change snapshot keeps the old notes — that's what makes Ctrl+Z able to
		// remove a just-added comment.
		const newNotes = [...(highlight.notes || []), formattedText];
		expandedCommentIndexes.delete(`${highlightId}-${newNotes.length - 1}`);
		const updated = { ...highlight, notes: newNotes };
		const newHighlights = highlights.map(h => h.id === highlightId ? updated : h);
		updateHighlights(newHighlights);
		saveHighlights();
	}
	stopAddingComment(highlightId);
}

function saveEditedComment(highlightId: string, index: number, text: string) {
	hideTagMenu();
	knownTagsCache = null;
	editingNoteKey = null;
	if (!text) {
		renderCommentBoxes();
		return;
	}

	void registerPastedImages(text);

	// `index` is into the group's flattened thread; resolve the piece that owns it.
	const rep = highlights.find(h => h.id === highlightId);
	const ref = rep ? groupNotes(rep)[index] : undefined;
	const owner = ref ? highlights.find(h => h.id === ref.ownerId) : undefined;
	if (owner && owner.notes && ref) {
		const oldParsed = parseNoteString(owner.notes[ref.ownerIndex]);
		const ts = oldParsed.timestamp || Date.now();
		// Keep the original creation timestamp (the comment's stable id) but record
		// a fresh edit time so cross-device merges keep the most recent edit.
		// Build new objects so the undo snapshot retains the pre-edit text.
		const newNotes = owner.notes.map((n, i) =>
			i === ref.ownerIndex ? `${text}<!--timestamp:${ts}--><!--edited:${Date.now()}-->` : n);
		expandedCommentIndexes.delete(`${highlightId}-${index}`);
		const updated = { ...owner, notes: newNotes };
		const newHighlights = highlights.map(h => h.id === owner.id ? updated : h);
		updateHighlights(newHighlights);
		saveHighlights();
		renderCommentBoxes();
	}
}

function deleteComment(highlightId: string, index: number) {
	// `index` is into the group's flattened thread; resolve the owning piece.
	const rep = highlights.find(h => h.id === highlightId);
	const ref = rep ? groupNotes(rep)[index] : undefined;
	const owner = ref ? highlights.find(h => h.id === ref.ownerId) : undefined;
	if (owner && owner.notes && ref) {
		const deleted = owner.notes[ref.ownerIndex];
		const newNotes = owner.notes.filter((_, i) => i !== ref.ownerIndex);
		const updated = { ...owner, notes: newNotes };
		const newHighlights = highlights.map(h => h.id === owner.id ? updated : h);
		updateHighlights(newHighlights);
		saveHighlights();

		const parsedText = parseNoteString(deleted).text;
		const dm = parsedText.match(/^<!--diagram:([A-Za-z0-9_-]+)-->$/);
		if (dm) {
			const did = dm[1];
			localDiagramCache.delete(did);
			deleteDiagramImage(did).catch(() => {});
			browser.storage.local.get('diagrams').then(res => {
				const diagrams = (res.diagrams || {}) as Record<string, any>;
				if (diagrams[did]) { delete diagrams[did]; return browser.storage.local.set({ diagrams }); }
			});
		}
		
		let imgMatch;
		const imgRegex = /<!--image:([A-Za-z0-9_-]+)-->/g;
		const imageIds: string[] = [];
		while ((imgMatch = imgRegex.exec(parsedText)) !== null) {
			const iid = imgMatch[1];
			imageIds.push(iid);
			localDiagramCache.delete(iid);
			deleteDiagramImage(iid).catch(() => {});
		}
		if (imageIds.length) void forgetDiagramEntries(imageIds);
		setActiveHighlight(null); // clear emphasis in case the box is removed
		renderCommentBoxes();
	}
}

// Delete the whole comment thread for an annotation unit while keeping the
// highlight: clears notes from every group member. (Deleting the highlight
// itself removes both highlight and notes — that path lives in the highlighter.)
function deleteCommentThread(highlightId: string) {
	const rep = highlights.find(h => h.id === highlightId);
	if (!rep) return;
	const members = groupMembers(rep);
	const memberIds = new Set(members.map(m => m.id));

	// Collect diagram comments so their scene + rendered image are cleaned up too,
	// mirroring single-comment deletion (no orphans in storage.local / IndexedDB).
	const diagramIds: string[] = [];
	const imageIds: string[] = [];
	for (const m of members) {
		for (const note of m.notes || []) {
			const text = parseNoteString(note).text;
			const dm = text.match(/^<!--diagram:([A-Za-z0-9_-]+)-->$/);
			if (dm) diagramIds.push(dm[1]);

			let imgMatch;
			const imgRegex = /<!--image:([A-Za-z0-9_-]+)-->/g;
			while ((imgMatch = imgRegex.exec(text)) !== null) {
				imageIds.push(imgMatch[1]);
			}
		}
	}

	// New objects (no in-place mutation) so undo can restore the whole thread.
	const newHighlights = highlights.map(h => memberIds.has(h.id) ? { ...h, notes: [] } : h);
	updateHighlights(newHighlights);
	saveHighlights();

	for (const did of diagramIds) {
		localDiagramCache.delete(did);
		deleteDiagramImage(did).catch(() => {});
		browser.storage.local.get('diagrams').then(res => {
			const diagrams = (res.diagrams || {}) as Record<string, any>;
			if (diagrams[did]) { delete diagrams[did]; return browser.storage.local.set({ diagrams }); }
		});
	}
	
	for (const iid of imageIds) {
		localDiagramCache.delete(iid);
		deleteDiagramImage(iid).catch(() => {});
	}
	if (imageIds.length) void forgetDiagramEntries(imageIds);

	setActiveHighlight(null); // clear emphasis — the box is about to be removed
	renderCommentBoxes();
}

export function clearCommentBoxes() {
	activeCommentBoxes.forEach(box => box.remove());
	activeCommentBoxes.clear();
	preserveScrollPosition(() => {
		document.body.style.paddingRight = '';
		document.body.style.paddingLeft = '';
		document.body.style.marginRight = '';
		document.body.style.marginLeft = '';
	});
	setActiveHighlight(null);
}

// Emphasize the comment box tied to a highlight (e.g. while hovering that
// highlight's text) so it's visually distinguishable from the other boxes.
// Pass null to clear. Guarded so we only touch the DOM on an actual change.
let emphasizedBoxId: string | null = null;
export function emphasizeCommentBox(highlightId: string | null) {
	if (emphasizedBoxId === highlightId) return;
	if (emphasizedBoxId) {
		activeCommentBoxes.get(emphasizedBoxId)?.classList.remove('is-active');
	}
	emphasizedBoxId = highlightId;
	if (highlightId) {
		activeCommentBoxes.get(highlightId)?.classList.add('is-active');
	}
}

function escapeHtml(unsafe: string) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function guessMainContentArea(root: Element): { left: number; right: number } | null {
	const paragraphs = Array.from(root.querySelectorAll('p, .para'))
		.map(p => ({ rect: p.getBoundingClientRect(), textLength: p.textContent?.length || 0 }))
		.filter(({ rect }) => rect.width > 0 && rect.height > 0)
		.sort((a, b) => b.textLength - a.textLength)
		.slice(0, 15);

	if (paragraphs.length === 0) return null;

	const leftVotes = new Map<number, number>();
	const rightVotes = new Map<number, number>();

	paragraphs.forEach(({ rect }) => {
		leftVotes.set(rect.left, (leftVotes.get(rect.left) || 0) + 1);
		rightVotes.set(rect.right, (rightVotes.get(rect.right) || 0) + 1);
	});

	const leftMargin = [...leftVotes.entries()].sort((a, b) => b[1] - a[1]);
	const rightMargin = [...rightVotes.entries()].sort((a, b) => b[1] - a[1]);

	return { left: leftMargin[0][0], right: rightMargin[0][0] };
}

function preserveScrollPosition(callback: () => void) {
	const anchor = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, li, blockquote')).find(el => {
		const rect = el.getBoundingClientRect();
		return rect.top >= 0 && rect.top < window.innerHeight && rect.width > 0 && rect.height > 0;
	});

	if (!anchor) {
		callback();
		return;
	}

	const anchorTop = anchor.getBoundingClientRect().top;
	callback();
	const newAnchorTop = anchor.getBoundingClientRect().top;
	
	const scrollDelta = newAnchorTop - anchorTop;
	if (scrollDelta !== 0) {
		document.documentElement.scrollTop += scrollDelta;
		document.body.scrollTop += scrollDelta;
	}
}
