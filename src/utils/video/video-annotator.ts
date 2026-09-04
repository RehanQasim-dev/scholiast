import {
	VideoColor, VideoItem, VideoMarkup, emptyMarkup, genVideoId,
	upsertVideoItem,
} from './video-storage';
import { renderMarkupSvg, snapLineTo45 } from './video-markup';
import { makeVideoNote, parseVideoNote, renderNoteHtml, formatVideoTime } from './video-notes';
import {
	getVideoElement, getVideoId, getVideoTitle, getPlayerContainer, isYouTubeWatchPage, getAccurateCurrentTime,
} from './youtube-detect';
import { captureFrame } from './frame-capture';
import { saveFrameImage } from './frame-store';
import { openComments, isCommentsActive, appendFrameFromSnapshot } from './video-comments';

// In-page overlay for capturing + marking up a YouTube frame and attaching a
// chat-style comment thread. Lazy-loaded by content.ts on first use, so none of
// this (or its CSS-driving classes) touches non-YouTube pages.
//
// Flow (see plan): S → draw mode over the frozen frame; Enter saves, C advances
// to the comment panel, Esc discards. N → comment-only (frameless) panel.
// The overlay scopes itself to the <video>'s on-screen rect, mounted into the
// fullscreen element when fullscreen, so the same layout works in both modes.

type Mode = 'draw' | 'comment';
// 'select' is the neutral home state: no drawing happens, and Enter saves / Esc
// exits / N comments. Picking pencil/line/text activates that tool; Esc steps
// back to 'select' keeping whatever was drawn.
type Tool = 'select' | 'pencil' | 'line' | 'text' | 'rect' | 'arrow';

let active = false;
let session = 0; // bumps each open; guards stale async/listeners

let video: HTMLVideoElement | null = null;
let wasPlaying = false;
let mode: Mode = 'draw';
let frameless = false;
let openedFullscreen = false; // was YouTube fullscreen when the overlay opened?

// Set while a text-label editor is open, so the global key handler can commit /
// cancel it (we route keys through onKeyDown to shield YouTube's shortcuts).
let activeTextCommit: (() => void) | null = null;

let watchUrl = '';
let videoId = '';
let videoTitle = '';
let videoTime = 0;
let item: VideoItem | null = null;

import { StrokeWidth } from './video-storage';

let currentTool: Tool = 'pencil';
let toolLocked = false;
let currentColor: VideoColor = 'yellow';
let currentStrokeWidth: StrokeWidth = 'medium';
let lastFontSizeScale = 1.0;
let markup: VideoMarkup = emptyMarkup();
const undoStack: VideoMarkup[] = [];

let linePopup: HTMLElement | null = null;
function hideLinePopup() {
	if (linePopup) { linePopup.remove(); linePopup = null; }
}

// DOM refs
let root: HTMLElement | null = null;
let frameWrap: HTMLElement | null = null;
let frameInner: HTMLElement | null = null; // image-aspect box; the drawing surface
let frameImg: HTMLImageElement | null = null;
let committedHolder: HTMLElement | null = null;
let liveSvg: SVGSVGElement | null = null;
let panel: HTMLElement | null = null;
let msgsEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;

// --- Pooled Excalidraw iframe ------------------------------------------------
// The Excalidraw bundle + React mount + canvas/font init is expensive, so we
// keep ONE iframe alive for the whole watch-page session and reuse it for every
// capture (resetting its scene each time). It's parented to the player
// container (which is what YouTube fullscreens), so it renders in both windowed
// and fullscreen without ever being reparented — moving an iframe reloads it,
// which would throw away the warm state.
let pooledIframe: HTMLIFrameElement | null = null;
let pooledReady = false;   // EXCALIDRAW_READY received from the iframe
let pendingInit = false;   // an INIT is queued, waiting on readiness

export function isAnnotatorActive(): boolean {
	return active;
}

// Create (once) and keep warm the reusable Excalidraw iframe. Safe to call
// repeatedly; cheap no-op once mounted.
export function warmAnnotator(): void {
	const host = getPlayerContainer();
	if (!host) return;
	if (pooledIframe && pooledIframe.isConnected) return;
	if (!pooledIframe) {
		pooledIframe = document.createElement('iframe');
		pooledIframe.src = browser.runtime.getURL('video-excalidraw.html');
		pooledIframe.className = 'ob-vid-excali-frame';
		pooledIframe.allow = 'clipboard-read; clipboard-write; keyboard-lock *';
		Object.assign(pooledIframe.style, {
			// Absolute (relative to the player), NOT fixed: a fixed element paints
			// above a fullscreened #movie_player but hit-tests *below* it, so pointer
			// events fall through to YouTube. Absolute keeps it in the player's
			// stacking subtree, clickable in both windowed and fullscreen.
			position: 'absolute', border: 'none', display: 'none',
			zIndex: '2147483647', background: 'transparent',
		} as Partial<CSSStyleDeclaration>);
		window.addEventListener('message', onPooledMessage, false);
	}
	pooledReady = false;
	host.appendChild(pooledIframe);
}

function positionPooledIframe() {
	if (!pooledIframe) return;
	const r = videoContentRect();
	if (!r) return;
	// Coords are relative to the player (the iframe's offset parent), so they hold
	// in both windowed and fullscreen.
	const host = pooledIframe.offsetParent as HTMLElement | null
		?? getPlayerContainer();
	const hr = host?.getBoundingClientRect();
	const left = hr ? r.left - hr.left : r.left;
	const top = hr ? r.top - hr.top : r.top;
	Object.assign(pooledIframe.style, {
		left: `${left}px`, top: `${top}px`,
		width: `${r.w}px`, height: `${r.h}px`,
	} as Partial<CSSStyleDeclaration>);
}

// Show the (already-warm) iframe for a capture: position it, hide it until the
// frame is painted, then feed it the captured frame.
function showPooledIframe() {
	warmAnnotator();
	if (!pooledIframe || !item?.frame) return;
	// Keep it invisible (but laid out) until FRAME_RENDERED arrives, so the user
	// never sees a blank/loading Excalidraw canvas.
	pooledIframe.style.display = 'block';
	pooledIframe.style.visibility = 'hidden';
	positionPooledIframe();
	pendingInit = true;
	if (pooledReady) sendInitFrame();
	// Fallback: reveal even if FRAME_RENDERED is somehow missed, so the iframe
	// can never get stuck invisible.
	const my = session;
	setTimeout(() => {
		if (session === my && active && mode === 'draw' && pooledIframe && pooledIframe.style.visibility === 'hidden') {
			pooledIframe.style.visibility = 'visible';
			pooledIframe.contentWindow?.focus();
		}
	}, 700);
}

function sendInitFrame() {
	if (!pooledIframe || !item?.frame) return;
	// Note: pendingInit stays true until FRAME_RENDERED — the warm iframe can
	// re-mount when first shown, dropping this message, so we must re-send on the
	// next EXCALIDRAW_READY.
	pooledIframe.contentWindow?.postMessage({
		type: 'INIT_FRAME',
		dataUrl: item.frame.dataUrl,
		w: item.frame.w,
		h: item.frame.h,
	}, '*');
}

function hidePooledIframe() {
	if (!pooledIframe) return;
	pooledIframe.style.display = 'none';
	pooledIframe.style.visibility = 'hidden';
	// Return focus to the player. While the iframe had focus, key events fired in
	// its (separate) browsing context, so neither YouTube's shortcuts (F, etc.)
	// nor our window-level S/N/T listener would fire until the user clicked back
	// into the page. Refocusing the player container releases that trap.
	try { (getPlayerContainer() as HTMLElement | null)?.focus({ preventScroll: true }); } catch { /* ignore */ }
}

// Forward a host-side key (when focus isn't already inside the iframe) to the
// iframe so save/comment/discard always run through Excalidraw's export path.
function triggerIframe(type: 'TRIGGER_SAVE' | 'TRIGGER_COMMENT' | 'TRIGGER_DISCARD') {
	pooledIframe?.contentWindow?.postMessage({ type }, '*');
}

function triggerIframeTool(tool: string) {
	pooledIframe?.contentWindow?.postMessage({ type: 'TRIGGER_TOOL', tool }, '*');
}

function onPooledMessage(e: MessageEvent) {
	const d = e.data;
	if (!d || !pooledIframe) return;
	if (d.type === 'EXCALIDRAW_READY') {
		pooledReady = true;
		// Re-send on every READY: a remount (e.g. the first show after warm) drops
		// the prior INIT_FRAME, and only a fresh READY tells us the new mount is
		// listening again.
		if (pendingInit && active && mode === 'draw') sendInitFrame();
	} else if (d.type === 'FRAME_RENDERED') {
		pendingInit = false;
		if (active && mode === 'draw' && pooledIframe) {
			pooledIframe.style.visibility = 'visible';
			pooledIframe.contentWindow?.focus();
		}
	} else if (d.type === 'SAVE_ANNOTATION') {
		if (!active || !item) return;
		item.excalidrawScene = d.sceneData;
		if (d.sceneData?.bakedDataUrl && item.frame) {
			item.frame.dataUrl = d.sceneData.bakedDataUrl;
		}
		if (d.action === 'comment') persist().then(goToComment);
		else saveAndClose();
	} else if (d.type === 'DISCARD_ANNOTATION' || d.type === '__obVpsEscPressed') {
		if (active) teardown(false);
	}
}

// --- Public entry points -----------------------------------------------------

export async function startCaptureAndDraw(): Promise<void> {
	if (active || !isYouTubeWatchPage()) return;
	video = getVideoElement();
	if (!video) return;
	prepareSession();
	const my = session;
	const frame = await captureFrame(video);
	if (session !== my || !active) return; // navigated/closed mid-capture
	if (!frame) { toast('Could not capture this frame'); teardown(false); return; }
	item = { id: genVideoId(), kind: 'frame', videoTime, frame, markup, notes: [] };
	frameless = false;
	mode = 'draw';
	buildOverlay();
}

export async function startCommentOnly(): Promise<void> {
	if (active || isCommentsActive() || !isYouTubeWatchPage()) return;
	const v = getVideoElement();
	if (!v) return;
	// Comment-only (frameless) is now just the per-video conversation panel,
	// opened on a fresh note item (written on first reply).
	const note: VideoItem = { id: genVideoId(), kind: 'note', videoTime: getAccurateCurrentTime(v), notes: [] };
	await openComments({
		watchUrl: location.href,
		videoId: getVideoId(),
		videoTitle: getVideoTitle(),
		video: v,
		wasPlaying: !v.paused,
		focusItemId: note.id,
		resumeOnClose: true,
		ensureItem: note,
	});
}

// --- Session lifecycle -------------------------------------------------------

function prepareSession() {
	active = true;
	session += 1;
	markup = emptyMarkup();
	undoStack.length = 0;
	selectedId = null;
	currentTool = 'pencil';
	currentColor = 'yellow';
	currentStrokeWidth = 'medium';
	videoTime = getAccurateCurrentTime(video);
	watchUrl = location.href;
	videoId = getVideoId();
	videoTitle = getVideoTitle();
	wasPlaying = !!video && !video.paused;
	openedFullscreen = !!document.fullscreenElement;
	document.body.dataset.obVidAnnotatorActive = 'true';
	if (video) video.pause();
}

// While in fullscreen, capture Escape so it closes our overlay instead of the
// browser force-exiting YouTube fullscreen. Released on teardown, after which a
// plain Esc exits fullscreen as usual. No-ops outside fullscreen / unsupported.
function lockEscape() {
	if (!document.fullscreenElement) return;
	try { window.postMessage({ type: '__obVpsLock' }, '*'); } catch {}
	try { window.dispatchEvent(new CustomEvent('__obVpsLock')); } catch {}
	try { document.dispatchEvent(new CustomEvent('__obVpsLock')); } catch {}
	const kb = (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard;
	if (kb?.lock) {
		try { kb.lock(['Escape'])?.catch(() => {}); } catch { /* ignore */ }
	}
}

function unlockEscape() {
	try { window.postMessage({ type: '__obVpsUnlock' }, '*'); } catch {}
	try { window.dispatchEvent(new CustomEvent('__obVpsUnlock')); } catch {}
	try { document.dispatchEvent(new CustomEvent('__obVpsUnlock')); } catch {}
	const kb = (navigator as unknown as { keyboard?: { unlock?: () => void } }).keyboard;
	if (kb?.unlock) {
		try { kb.unlock(); } catch { /* ignore */ }
	}
}

function mountTarget(): HTMLElement {
	return (document.fullscreenElement as HTMLElement | null) || getPlayerContainer() || document.body;
}

// The <video> element box can be larger than the actual picture (letterbox bars
// when the screen/player aspect differs from the video). Fit the video's
// intrinsic aspect into the element box to get the true content rectangle, so
// the overlay (and the iframe over it) covers exactly the visible picture — no
// dead margins to "click into nothing".
function videoContentRect(): { left: number; top: number; w: number; h: number } | null {
	if (!video) return null;
	const el = video.getBoundingClientRect();
	let { left, top, width: w, height: h } = el;
	const vw = video.videoWidth, vh = video.videoHeight;
	if (vw > 0 && vh > 0) {
		const va = vw / vh;
		const ea = el.width / el.height;
		if (ea > va) { h = el.height; w = h * va; } // bars left/right
		else { w = el.width; h = w / va; }          // bars top/bottom
		left = el.left + (el.width - w) / 2;
		top = el.top + (el.height - h) / 2;
	}
	return { left, top, w, h };
}

function positionRoot() {
	if (!root) return;
	const r = videoContentRect();
	if (!r) return;
	root.style.left = `${r.left}px`;
	root.style.top = `${r.top}px`;
	root.style.width = `${r.w}px`;
	root.style.height = `${r.h}px`;
}

function buildOverlay() {
	root = document.createElement('div');
	root.className = `ob-vid-overlay mode-${mode}${frameless ? ' frameless' : ''}`;
	root.dataset.color = currentColor;
	root.dataset.tool = currentTool;

	// Frame side (image + markup + live draw layer + toolbar + hint)
	frameWrap = document.createElement('div');
	frameWrap.className = 'ob-vid-frame-wrap';

	// The inner box is sized to the captured frame's aspect ratio and centered, so
	// drawing coords (normalized to it) line up exactly with the saved image even
	// when the player letterboxes. Absent in frameless (comment-only) mode.
	if (!frameless && item?.frame) {
		frameInner = document.createElement('div');
		frameInner.className = 'ob-vid-frame-inner';
		frameInner.style.aspectRatio = `${item.frame.w} / ${item.frame.h}`;
		frameInner.style.position = 'relative';

		if (mode === 'draw') {
			// Drawing happens in the pooled iframe (positioned over this rect by
			// showPooledIframe / onReposition), not a per-session child iframe.
		} else {
			frameImg = document.createElement('img');
			frameImg.className = 'ob-vid-frame';
			if (item.frame.dataUrl) frameImg.src = item.frame.dataUrl;
			frameInner.appendChild(frameImg);

			committedHolder = document.createElement('div');
			committedHolder.className = 'ob-vid-markup';
			frameInner.appendChild(committedHolder);
		}

		frameWrap.appendChild(frameInner);
	}

	// Chat panel
	panel = buildPanel();

	const stage = document.createElement('div');
	stage.className = 'ob-vid-stage';
	stage.appendChild(frameWrap);
	stage.appendChild(panel);
	root.appendChild(stage);

	mountTarget().appendChild(root);
	positionRoot();
	renderCommitted();
	if (mode === 'draw') showPooledIframe();

	window.addEventListener('resize', onReposition, true);
	window.addEventListener('scroll', onReposition, true);
	document.addEventListener('fullscreenchange', onFullscreenChange, true);
	// On `window` capture so we run before YouTube's own document-level key
	// handlers (which were registered at page load) — needed to stop Space from
	// reaching the player and toggling play while typing, in windowed mode too.
	window.addEventListener('keydown', onKeyDown, true);
	window.addEventListener('keyup', onKeyUpShield, true);
	window.addEventListener('keypress', onKeyUpShield, true);
	lockEscape();

	if (mode === 'comment') focusInput();
}

function onReposition() {
	positionRoot();
	if (mode === 'draw') positionPooledIframe();
	renderCommitted();
}

function onFullscreenChange() {
	if (!root || !active) return;
	// If snapshot mode was opened in fullscreen and fullscreen exits (user pressed Esc or exited),
	// close the snapshot mode cleanly so it never stays stuck as a broken black box.
	if (openedFullscreen && !document.fullscreenElement) {
		teardown(false);
		return;
	}
	const target = mountTarget();
	if (root.parentElement !== target) target.appendChild(root);
	positionRoot();
	if (mode === 'draw') {
		positionPooledIframe();
		sendInitFrame();
	}
	renderCommitted();
}

function wrapSize() {
	const surface = frameInner || frameWrap!;
	const r = surface.getBoundingClientRect();
	return { w: r.width, h: r.height, left: r.left, top: r.top };
}

function renderCommitted() {
	if (!committedHolder || !frameInner) return;
	const { w, h } = wrapSize();
	committedHolder.replaceChildren(renderMarkupSvg(markup, Math.max(1, w), Math.max(1, h), null));
}

function onPointerDown(e: PointerEvent) {
	if (e.button !== 0 || mode !== 'draw') return;

	// Select tool: click a markup element to select it (then drag to move); click
	// empty space to deselect. Hit-testing is geometric against the markup coords.
	if (currentTool === 'select') {
		const p = toLocal(e);
		const mid = hitTest(p.x, p.y);
		selectedId = mid;
		if (root) {
			root.querySelectorAll('.ob-vid-swatch').forEach(el =>
				el.classList.toggle('is-active', (el as HTMLElement).dataset.color === selectedColor()));
		}
		renderCommitted();
		if (mid) {
			selDragging = true;
			selLast = p;
			selSnapshot = JSON.parse(JSON.stringify(markup));
			frameInner?.setPointerCapture?.(e.pointerId);
			e.preventDefault();
		}
		return;
	}

	// Don't treat clicks on an in-progress text label as a new placement.
	if ((e.target as HTMLElement)?.classList?.contains('ob-vid-textinput')) return;
	const p = toLocal(e);

	if (currentTool === 'text') {
		// Prevent the default focus shift so our programmatic focus (deferred below)
		// actually sticks on the new input.
		e.preventDefault();
		placeTextInput(p.x, p.y);
		return;
	}

	drawing = true;
	(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
	const svg = ensureLiveSvg();
	svg.replaceChildren();
	if (currentTool === 'pencil') {
		livePts = [p.x, p.y];
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('class', `ob-vid-livepath ${colorHexAttr()}`);
		svg.appendChild(path);
	} else if (currentTool === 'rect') {
		lineStart = { x: p.x, y: p.y };
		const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
		rect.setAttribute('class', `ob-vid-liverect ${colorHexAttr()}`);
		svg.appendChild(rect);
	} else {
		lineStart = { x: p.x, y: p.y };
		const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
		ln.setAttribute('class', `ob-vid-liveline ${colorHexAttr()}`);
		svg.appendChild(ln);
	}
	e.preventDefault();
}

function onPointerMove(e: PointerEvent) {
	// Drag-to-move the selected element (select tool).
	if (selDragging && selectedId && selLast) {
		const p = toLocal(e);
		const { w, h } = wrapSize();
		translateSelected((p.x - selLast.x) / Math.max(1, w), (p.y - selLast.y) / Math.max(1, h));
		selLast = p;
		renderCommitted();
		e.preventDefault();
		return;
	}

	if (!drawing || !liveSvg) return;
	const p = toLocal(e);
	if (currentTool === 'pencil') {
		const lx = livePts[livePts.length - 2];
		const ly = livePts[livePts.length - 1];
		if (Math.hypot(p.x - lx, p.y - ly) < 2) return;
		livePts.push(p.x, p.y);
		const path = liveSvg.firstChild as SVGPathElement;
		path.setAttribute('d', pixelPath(livePts));
	} else if (lineStart) {
		let end = { x: p.x, y: p.y };
		if (e.shiftKey) end = snapLineTo45(lineStart.x, lineStart.y, p.x, p.y);
		if (currentTool === 'rect') {
			const rx = Math.min(lineStart.x, end.x);
			const ry = Math.min(lineStart.y, end.y);
			let rw = Math.abs(end.x - lineStart.x);
			let rh = Math.abs(end.y - lineStart.y);
			if (e.shiftKey) { const size = Math.max(rw, rh); rw = size; rh = size; }
			const rect = liveSvg.firstChild as SVGRectElement;
			rect.setAttribute('x', String(rx));
			rect.setAttribute('y', String(ry));
			rect.setAttribute('width', String(rw));
			rect.setAttribute('height', String(rh));
		} else {
			const ln = liveSvg.firstChild as SVGLineElement;
			ln.setAttribute('x1', String(lineStart.x));
			ln.setAttribute('y1', String(lineStart.y));
			ln.setAttribute('x2', String(end.x));
			ln.setAttribute('y2', String(end.y));
		}
	}
	e.preventDefault();
}

function onPointerUp(e: PointerEvent) {
	// Finish a select-tool move: record the pre-move state for undo.
	if (selDragging) {
		selDragging = false;
		if (selSnapshot) { undoStack.push(selSnapshot); if (undoStack.length > 50) undoStack.shift(); }
		selSnapshot = null;
		selLast = null;
		return;
	}

	if (!drawing) return;
	drawing = false;
	const { w, h } = wrapSize();
	const nx = (v: number) => v / Math.max(1, w);
	const ny = (v: number) => v / Math.max(1, h);

	if (currentTool === 'pencil' && livePts.length >= 4) {
		pushUndoSnapshot();
		const pts: number[] = [];
		for (let i = 0; i < livePts.length; i += 2) { pts.push(nx(livePts[i]), ny(livePts[i + 1])); }
		markup.strokes.push({ id: genVideoId(), color: currentColor, points: pts, weight: currentStrokeWidth });
		renderCommitted();
	} else if (currentTool === 'rect' && lineStart) {
		const p = toLocal(e);
		let end = { x: p.x, y: p.y };
		const rx = Math.min(lineStart.x, end.x);
		const ry = Math.min(lineStart.y, end.y);
		let rw = Math.abs(end.x - lineStart.x);
		let rh = Math.abs(end.y - lineStart.y);
		if (e.shiftKey) { const size = Math.max(rw, rh); rw = size; rh = size; }
		if (rw > 4 && rh > 4) {
			pushUndoSnapshot();
			if (!markup.rects) markup.rects = [];
			markup.rects.push({
				id: genVideoId(), color: currentColor,
				x: nx(rx), y: ny(ry), w: nx(rw), h: ny(rh),
				weight: currentStrokeWidth
			});
			renderCommitted();
			if (!toolLocked) setTool('select');
		}
	} else if ((currentTool === 'line' || currentTool === 'arrow') && lineStart) {
		const p = toLocal(e);
		let end = { x: p.x, y: p.y };
		if (e.shiftKey) end = snapLineTo45(lineStart.x, lineStart.y, p.x, p.y);
		if (Math.hypot(end.x - lineStart.x, end.y - lineStart.y) > 4) {
			pushUndoSnapshot();
			if (currentTool === 'arrow') {
				if (!markup.arrows) markup.arrows = [];
				markup.arrows.push({
					id: genVideoId(), color: currentColor,
					x1: nx(lineStart.x), y1: ny(lineStart.y), x2: nx(end.x), y2: ny(end.y),
					weight: currentStrokeWidth
				});
			} else {
				markup.lines.push({
					id: genVideoId(), color: currentColor,
					x1: nx(lineStart.x), y1: ny(lineStart.y), x2: nx(end.x), y2: ny(end.y),
					weight: currentStrokeWidth
				});
			}
			renderCommitted();
			if (!toolLocked) setTool('select');
		}
	}
	livePts = [];
	lineStart = null;
	clearLive();
}

function pixelPath(pts: number[]): string {
	if (pts.length < 2) return '';
	let d = `M ${pts[0]} ${pts[1]}`;
	if (pts.length < 6) {
		for (let i = 2; i < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
		return d;
	}
	for (let i = 2; i < pts.length - 2; i += 2) {
		const xc = (pts[i] + pts[i + 2]) / 2;
		const yc = (pts[i + 1] + pts[i + 3]) / 2;
		d += ` Q ${pts[i]} ${pts[i + 1]} ${xc} ${yc}`;
	}
	d += ` L ${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
	return d;
}

// `initial`/`boxOverride` are set when editing an existing label (double-click);
// in that case onDoubleClick already pushed the undo snapshot, so we don't push
// again here.
function placeTextInput(x: number, y: number, initial = '', boxOverride?: number) {
	const { w, h } = wrapSize();
	const editing = initial !== '';
	// A fixed-width box: text wraps to the next line within it (no endless single
	// line). Default font is a couple of points smaller than before.
	const boxPx = boxOverride ?? Math.min(Math.max(160, w * 0.28), w * 0.9);
	const fontPx = Math.max(11, h * 0.034) * lastFontSizeScale;

	// Ensure the textbox doesn't go off-screen initially
	const maxLeft = w - boxPx;
	const safeX = Math.max(0, Math.min(x, maxLeft));

	const ta = document.createElement('textarea');
	ta.className = `ob-vid-textinput ${currentColor}`;
	ta.rows = 1;
	ta.value = initial;
	ta.style.left = `${safeX}px`;
	ta.style.top = `${y}px`;
	ta.style.width = `${boxPx}px`;
	ta.style.fontSize = `${fontPx}px`;
	ta.style.fontFamily = 'system-ui, sans-serif';
	ta.style.fontWeight = '600';
	ta.style.lineHeight = '1.3';
	ta.style.padding = '2px';
	ta.style.margin = '0';
	ta.style.boxSizing = 'border-box';
	ta.style.resize = 'horizontal';
	frameInner!.appendChild(ta);

	const autosize = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; };
	ta.addEventListener('input', autosize);
	autosize();
	// Defer focus so the browser's default pointerdown focus handling doesn't
	// immediately steal it back. Enter/Escape are handled in onKeyDown (Enter =
	// newline here; commit happens on blur / clicking away).
	setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);

	let done = false; // guard against a remove→blur double-commit
	const clearActive = () => {
		if (activeTextCommit === commit) { activeTextCommit = null; }
	};
	const commit = () => {
		if (done) return;
		done = true;
		const text = ta.value.trim();
		const finalBoxPx = ta.offsetWidth;
		if (text) {
			if (!editing) pushUndoSnapshot();
			// Re-read offsetLeft in case user resized from left or container shifted
			markup.texts.push({
				id: genVideoId(), color: currentColor,
				x: ta.offsetLeft / Math.max(1, w), y: ta.offsetTop / Math.max(1, h),
				w: finalBoxPx / Math.max(1, w), size: lastFontSizeScale, text,
			});
			renderCommitted();
		}
		ta.remove();
		clearActive();
		if (!toolLocked && currentTool === 'text') setTool('select');
	};
}

// --- Comment panel -----------------------------------------------------------

function buildPanel(): HTMLElement {
	const p = document.createElement('div');
	p.className = 'ob-vid-panel';

	const head = document.createElement('div');
	head.className = 'ob-vid-panel-head';
	const ts = document.createElement('span');
	ts.className = 'ob-vid-panel-time';
	ts.textContent = formatVideoTime(videoTime);
	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'ob-vid-panel-close';
	close.title = 'Close (Esc)';
	close.textContent = '✕';
	close.addEventListener('click', () => teardown(true));
	head.appendChild(ts);
	head.appendChild(close);

	msgsEl = document.createElement('div');
	msgsEl.className = 'ob-vid-msgs';

	const inputWrap = document.createElement('div');
	inputWrap.className = 'ob-vid-input-wrap';
	inputEl = document.createElement('textarea');
	inputEl.className = 'ob-vid-input';
	inputEl.rows = 1;
	inputEl.placeholder = 'reply here';
	inputEl.addEventListener('input', autosizeInput);
	inputWrap.appendChild(inputEl);

	p.appendChild(head);
	p.appendChild(msgsEl);
	p.appendChild(inputWrap);
	return p;
}

function autosizeInput() {
	if (!inputEl) return;
	inputEl.style.height = 'auto';
	inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`;
}

async function postMessage() {
	if (!inputEl || !item) return;
	const text = inputEl.value.trim();
	if (!text) return;
	item.notes.push(makeVideoNote(text, Date.now()));
	inputEl.value = '';
	autosizeInput();
	renderMessages();
	await persist();
}

function renderMessages() {
	if (!msgsEl || !item) return;
	msgsEl.replaceChildren();
	for (const note of item.notes) {
		const parsed = parseVideoNote(note);
		const bubble = document.createElement('div');
		bubble.className = 'ob-vid-msg';
		const body = document.createElement('div');
		body.className = 'ob-vid-msg-body';
		body.innerHTML = renderNoteHtml(parsed.text);
		bubble.appendChild(body);
		// Collapse long messages after ~3 lines with a show-more toggle.
		requestAnimationFrame(() => {
			if (body.scrollHeight - body.clientHeight > 4) {
				bubble.classList.add('is-collapsible');
				const more = document.createElement('button');
				more.type = 'button';
				more.className = 'ob-vid-msg-more';
				more.textContent = 'Show more';
				more.addEventListener('click', () => {
					const open = bubble.classList.toggle('is-open');
					more.textContent = open ? 'Show less' : 'Show more';
				});
				bubble.appendChild(more);
			}
		});
		msgsEl!.appendChild(bubble);
	}
	msgsEl.scrollTop = msgsEl.scrollHeight; // newest at bottom
}

function focusInput() {
	setTimeout(() => inputEl?.focus({ preventScroll: true }), 50);
}

// --- Persistence -------------------------------------------------------------

async function persist() {
	if (!item) return;
	item.markup = markup.strokes.length || markup.lines.length || markup.texts.length ? markup : undefined;
	// The JPEG goes to IndexedDB (keyed by item id); upsert strips it from the
	// metadata blob. Save the image first so a reader can rehydrate it right after.
	if (item.frame?.dataUrl) await saveFrameImage(item.id, item.frame.dataUrl);
	await upsertVideoItem(watchUrl, videoId, videoTitle, item);
}

// --- Mode transitions --------------------------------------------------------

async function goToComment() {
	if (mode === 'comment' || !root || !item) return;
	// The frame is already persisted by the caller. Tear down the draw overlay
	// (without resuming — the conversation panel owns playback) and hand off to
	// the per-video conversation panel focused on this frame's thread.
	const it = item;
	const vid = video;
	const playing = wasPlaying;
	const wu = watchUrl, vid2 = videoId, vt = videoTitle;
	if (isCommentsActive()) {
		teardown(true, false);
		await appendFrameFromSnapshot(it);
		return;
	}
	teardown(true, false);
	openComments({
		watchUrl: wu, videoId: vid2, videoTitle: vt,
		video: vid, wasPlaying: playing,
		focusItemId: it.id, resumeOnClose: true,
		ensureItem: it,
	});
}

// --- Keyboard ----------------------------------------------------------------

// Some sites (incl. YouTube) toggle play on keyup/keypress too — shield those
// while typing in our boxes so Space doesn't reach the player.
function onKeyUpShield(e: KeyboardEvent) {
	if (!active) return;
	if ((e.altKey || e.metaKey) && e.key === 'Tab') return;
	const t = e.target as HTMLElement;
	if (t?.classList?.contains('ob-vid-textinput') || t?.classList?.contains('ob-vid-input')) {
		e.stopPropagation();
	}
}

function onKeyDown(e: KeyboardEvent) {
	if (!active) return;
	if ((e.altKey || e.metaKey) && e.key === 'Tab') return;
	const t = e.target as HTMLElement;
	const inText = !!t?.classList?.contains('ob-vid-textinput');
	const inChat = !!t?.classList?.contains('ob-vid-input');

	// While typing in our text-label or chat box, shield YouTube's player
	// shortcuts (e.g. Space toggling play) by stopping the event here — this runs
	// at window capture, before YouTube's handlers. Other keys (letters, space,
	// Shift+Enter) fall through so they type normally.
	if (inText || inChat) {
		e.stopPropagation();
		if (inText) {
			// Esc finishes typing: keep the text and return to the select tool.
			if (e.key === 'Escape') { e.preventDefault(); activeTextCommit?.(); setTool('select'); }
			else if (e.ctrlKey || e.metaKey) {
				if (e.key === '[' || e.key === ']') {
					e.preventDefault();
					const delta = e.key === ']' ? 0.1 : -0.1;
					lastFontSizeScale = Math.max(0.5, Math.min(3.0, lastFontSizeScale + delta));
					const { h } = wrapSize();
					const fontPx = Math.max(11, h * 0.034) * lastFontSizeScale;
					t.style.fontSize = `${fontPx}px`;
					// trigger autosize
					t.style.height = 'auto'; 
					t.style.height = `${t.scrollHeight}px`;
				}
			}
			// Enter = newline (let it through).
		} else { // chat box
			if (e.key === 'Escape') {
				e.preventDefault(); e.stopImmediatePropagation();
				const inp = t as HTMLTextAreaElement;
				if (inp.value && inp.value.trim().length > 0) {
					inp.value = ''; inp.style.height = 'auto';
					return;
				}
				if (document.activeElement === inp) { inp.blur(); return; }
				teardown(true);
			}
			else if (e.key === 'Enter' && !e.shiftKey) { 
				if (e.isComposing) return;
				e.preventDefault(); 
				postMessage(); 
			}
		}
		return;
	}

	e.stopPropagation();

	if (mode === 'draw') {
		const k = e.key.toLowerCase();
		const toolMap: Record<string, string> = {
			'1': 'selection', 'v': 'selection',
			'2': 'rectangle', 'r': 'rectangle',
			'3': 'diamond',   'd': 'diamond',
			'4': 'ellipse',   'o': 'ellipse',
			'5': 'arrow',     'a': 'arrow',
			'6': 'line',      'l': 'line',
			'7': 'freedraw',  'p': 'freedraw',
			'8': 'text',      't': 'text',
			'9': 'image',
			'0': 'eraser',    'e': 'eraser',
			'h': 'hand',
		};
		if (!e.ctrlKey && !e.metaKey && !e.altKey && toolMap[k]) {
			e.preventDefault();
			triggerIframeTool(toolMap[k]);
			return;
		}

		// Drawing lives in the pooled iframe; normally it has focus and handles
		// these itself. This fires only when focus is still on the host page —
		// delegate to the iframe so save/comment always go through its export.
		if (e.key === 'Escape') {
			e.preventDefault();
			triggerIframe('TRIGGER_DISCARD');
		} else if (e.key === 'Enter') {
			e.preventDefault();
			triggerIframe('TRIGGER_SAVE');
		} else if (e.key === 'n' || e.key === 'N' || e.key === 'c' || e.key === 'C') {
			e.preventDefault();
			triggerIframe('TRIGGER_COMMENT');
		} else if (k === 's') {
			e.preventDefault();
			triggerIframe('TRIGGER_CYCLE_STROKE' as any);
		}
	} else {
		if (e.key === 'Escape') { e.preventDefault(); teardown(true); }
	}
}

async function saveAndClose() {
	await persist();
	const it = item;
	if (isCommentsActive() && it) {
		teardown(true, false);
		await appendFrameFromSnapshot(it);
		return;
	}
	teardown(true);
}

// --- Teardown ----------------------------------------------------------------

function toast(msg: string) {
	const el = document.createElement('div');
	el.className = 'ob-vid-toast';
	el.textContent = msg;
	mountTarget().appendChild(el);
	setTimeout(() => el.remove(), 2200);
}

// `save` = whether the item (frame + thread) should remain persisted. In draw
// mode, Esc discards (save=false) since nothing was written yet.
function teardown(save: boolean, resume = true) {
	// Defer releasing the Escape lock: if this teardown was triggered BY pressing
	// Escape, unlocking immediately would let that same Escape press (the browser
	// evaluates fullscreen-exit on keyup, after our keydown handler) also exit
	// fullscreen. A short delay keeps the lock through the whole key press so only
	// the overlay closes; a later Escape (lock released) exits fullscreen.
	setTimeout(unlockEscape, 400);
	// Hide (don't destroy) the pooled iframe so it stays warm for the next capture.
	hidePooledIframe();
	pendingInit = false;
	window.removeEventListener('resize', onReposition, true);
	window.removeEventListener('scroll', onReposition, true);
	document.removeEventListener('fullscreenchange', onFullscreenChange, true);
	window.removeEventListener('keydown', onKeyDown, true);
	window.removeEventListener('keyup', onKeyUpShield, true);
	window.removeEventListener('keypress', onKeyUpShield, true);
	activeTextCommit = null;
	selectedId = null;
	selDragging = false;

	if (root) {
		root.classList.add('is-closing');
		const el = root;
		setTimeout(() => el.remove(), 250);
	}
	root = frameWrap = frameInner = committedHolder = panel = msgsEl = null;
	frameImg = null; inputEl = null; liveSvg = null;

	const doResume = resume && wasPlaying;
	const vid = video;
	active = false;
	delete document.body.dataset.obVidAnnotatorActive;
	mode = 'draw';
	item = null;
	markup = emptyMarkup();
	undoStack.length = 0;

	if (!save) {
		// Nothing persisted in draw mode until Enter/C; just resume.
	}
	if (vid && doResume) vid.play().catch(() => {});
}
