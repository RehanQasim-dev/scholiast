import browser from './browser-polyfill';
import { getElementByXPath } from './dom-utils';
import {
	AnyHighlightData, highlights, saveHighlights, updateHighlights, getPageUrl,
} from './highlighter';
import { deleteDiagramImage, loadDiagramImage } from './video/frame-store';
import { normalizeUrl } from './url-utils';
import { resolveImageElement } from '../../shared/anchor';

/**
 * Redraw a highlighted page image in Excalidraw.
 *
 * Highlight an image, hit the Excalidraw button on its action bar, and the picture
 * opens as the canvas backdrop — annotate it, save, and the page shows the edited
 * version in its place. Re-opening picks up the same scene, so the previous edit can
 * be changed rather than started over.
 *
 * The edited PNG is the canonical image for that highlight from then on: it replaces
 * the `<img>` in the live DOM (so anything clipped from the page carries it), and the
 * dashboard shows it too.
 *
 * State: the scene + PNG live in the shared `diagrams` stores under a diagram id
 * derived from the highlight id, and the highlight records `imageEdit`. Deleting the
 * highlight restores the original image (see `restoreEditedImage`).
 */

// Derived, not random, so re-opening the editor for the same highlight always lands
// on the same scene — even if the highlight's `imageEdit` was never written (the
// editor was closed without saving).
export function imageDiagramId(highlightId: string): string {
	return `img${highlightId.replace(/[^A-Za-z0-9_-]/g, '')}`;
}

// The <img> an element highlight points at, or null when it isn't an image.
export function imageForHighlight(highlight: AnyHighlightData): HTMLImageElement | null {
	if (highlight.type !== 'element') return null;
	// The xpath can be empty or stale (an image highlight made in Obsidian points into
	// the note's DOM) — the portable image anchor finds it by source instead, mirroring
	// what applyHighlights does when painting.
	const element = highlight.xpath ? getElementByXPath(highlight.xpath) : null;
	if (!element) {
		if (!highlight.anchor?.image) return null;
		return resolveImageElement(highlight.anchor, document.body, getPageUrl()) as HTMLImageElement | null;
	}
	if (element.tagName === 'IMG') return element as HTMLImageElement;
	return element.querySelector('img');
}

export function isImageHighlight(id: string): boolean {
	const highlight = highlights.find(h => h.id === id);
	return !!highlight && !!imageForHighlight(highlight);
}

const ORIGINAL_SRC_ATTR = 'obsidianOriginalSrc';

// Swap in the edited PNG. `srcset`/`sizes` have to go: the browser prefers them over
// `src`, so leaving them in place meant the original kept winning.
function showEditedImage(img: HTMLImageElement, dataUrl: string): void {
	if (img.dataset[ORIGINAL_SRC_ATTR] === undefined) {
		img.dataset[ORIGINAL_SRC_ATTR] = img.getAttribute('src') || '';
		const srcset = img.getAttribute('srcset');
		if (srcset) img.dataset.obsidianOriginalSrcset = srcset;
	}
	img.removeAttribute('srcset');
	img.removeAttribute('sizes');
	if (img.src !== dataUrl) img.src = dataUrl;
}

function restoreImage(img: HTMLImageElement): void {
	const original = img.dataset[ORIGINAL_SRC_ATTR];
	if (original === undefined) return;
	delete img.dataset[ORIGINAL_SRC_ATTR];
	const srcset = img.dataset.obsidianOriginalSrcset;
	if (srcset !== undefined) {
		img.setAttribute('srcset', srcset);
		delete img.dataset.obsidianOriginalSrcset;
	}
	if (original) img.setAttribute('src', original);
	else img.removeAttribute('src');
}

// Decoded PNGs by diagram id, so re-running the pass on every highlight change
// doesn't re-read IndexedDB (and doesn't flash the original back in).
const editedImageCache = new Map<string, string>();

/**
 * Put every edited image back on the page. Cheap and idempotent — call it after
 * highlights are (re)applied, after a sync pull, and after an edit is saved.
 */
export function applyImageEdits(): void {
	for (const highlight of highlights) {
		const edit = highlight.imageEdit;
		if (!edit) continue;
		const img = imageForHighlight(highlight);
		if (!img) continue;

		const cached = editedImageCache.get(edit.diagramId);
		if (cached) { showEditedImage(img, cached); continue; }
		void loadDiagramImage(edit.diagramId).then((dataUrl) => {
			if (!dataUrl) return;
			editedImageCache.set(edit.diagramId, dataUrl);
			const target = imageForHighlight(highlight);
			if (target) showEditedImage(target, dataUrl);
		});
	}
}

/**
 * Undo the swap for one highlight and drop its edit, used when that highlight is
 * deleted: the original image comes back and the scene + PNG are removed, so nothing
 * is left behind to sync.
 */
export function restoreEditedImage(highlight: AnyHighlightData): void {
	const img = imageForHighlight(highlight);
	if (img) restoreImage(img);
	const diagramId = highlight.imageEdit?.diagramId;
	if (!diagramId) return;
	editedImageCache.delete(diagramId);
	void deleteDiagramImage(diagramId);
	void browser.storage.local.get('diagrams').then((res: any) => {
		const diagrams = (res.diagrams || {}) as Record<string, unknown>;
		if (!diagrams[diagramId]) return;
		delete diagrams[diagramId];
		return browser.storage.local.set({ diagrams });
	});
}

/**
 * Open the Excalidraw editor for a highlighted image. The background does the
 * fetching — a cross-origin image's bytes aren't readable from the page, and the
 * editor page can't reach them either.
 */
export function openImageEditor(highlightId: string): void {
	const highlight = highlights.find(h => h.id === highlightId);
	if (!highlight) return;
	const img = imageForHighlight(highlight);
	if (!img) return;

	void browser.runtime.sendMessage({
		action: 'openImageEditor',
		id: imageDiagramId(highlightId),
		highlightId,
		pageUrl: normalizeUrl(getPageUrl()),
		// currentSrc is what the browser actually loaded (the right entry from a
		// srcset), which is the picture the reader is looking at.
		src: img.currentSrc || img.src,
		width: img.naturalWidth || img.width,
		height: img.naturalHeight || img.height,
	});
}

/**
 * Record a saved edit on its highlight and show it. Called from the `diagramSaved`
 * relay, with the PNG passed along so nothing has to be read back.
 */
export function onImageEditSaved(highlightId: string, diagramId: string, dataUrl?: string): void {
	const highlight = highlights.find(h => h.id === highlightId);
	if (!highlight) return;
	if (dataUrl) editedImageCache.set(diagramId, dataUrl);

	const now = Date.now();
	updateHighlights(highlights.map(h => (
		h.id === highlightId
			? { ...h, imageEdit: { diagramId, updatedAt: now }, updatedAt: now }
			: h
	)));
	saveHighlights();
	applyImageEdits();
}
