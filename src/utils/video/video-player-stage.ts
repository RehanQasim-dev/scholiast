import { getPlayerContainer } from './youtube-detect';

// Shared "stage" that makes room for a side panel by scaling the *live* YouTube
// player down to the left (a CSS transform — purely visual, so YouTube's own
// layout/resize logic doesn't fight it), leaving the player fully interactive
// (play/pause, seek, controls). The panel docks in the freed space on the right
// and the rest is dimmed.
//
// Ref-counted: the transcript and comment panels can both be engaged during a
// switch without double-scaling; the player is restored only when the last one
// disengages. Each panel mounts its own "host" element (the panel container);
// the stage positions every host and keeps them aligned on resize / fullscreen
// changes.
//
// Fullscreen note: when YouTube's fullscreen element IS the scaled player, a host
// mounted inside it would inherit the scale, so we counter-scale it; when the
// fullscreen element is an ancestor, the host sits outside the scaled subtree and
// needs no counter-scale.

const PANEL_MIN = 224, PANEL_MAX = 640;

let player: HTMLElement | null = null;
let dim: HTMLElement | null = null;
let saved: { transform: string; transformOrigin: string; transition: string; zIndex: string; position: string } | null = null;
let refCount = 0;
let fs = false;
let counterScale = false;
let scaleVal = 1;
let panelW = 360;
let base = { left: 0, top: 0, width: 0, height: 0 };
let savedHtmlOverflow = '';
const hosts = new Set<HTMLElement>();
let scriptInjected = false;

let customWidth: number | null = null;
try {
	const w = sessionStorage.getItem('ob-vid-panel-width');
	if (w) customWidth = parseInt(w, 10);
} catch (e) {}

let lastPanelEsc = 0;
let lastPlayerForRestore: HTMLElement | null = null;
export function markPanelEsc(): void { lastPanelEsc = Date.now(); }

export function setCustomPanelWidth(w: number) {
	customWidth = w;
	try { sessionStorage.setItem('ob-vid-panel-width', w.toString()); } catch(e) {}
	relayoutAll();
}

function injectPatchScript() {
	if (scriptInjected) return;
	scriptInjected = true;
	// Load as an external web-accessible resource (not inline): YouTube's CSP
	// blocks inline scripts injected by content scripts, which would silently
	// leave the patch uninstalled and the scrubber misaligned. Extension-origin
	// web-accessible scripts are exempt from the page CSP.
	const s = document.createElement('script');
	s.id = 'ob-vps-patch';
	s.src = browser.runtime.getURL('vps-scrubber-patch.js');
	(document.head || document.documentElement).appendChild(s);
}

function fsElement(): HTMLElement | null {
	return (document.fullscreenElement as HTMLElement | null);
}

function measureBase() {
	if (!player) return;
	fs = !!fsElement();
	if (fs) {
		base = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
	} else {
		// Measure without our transform so the rect is the player's true box.
		// Disable the transition first, otherwise clearing the transform animates
		// and getBoundingClientRect reads a mid-shrink (smaller) size — which would
		// feed back into an ever-shrinking scale on repeated relayouts.
		const prevTransform = player.style.transform;
		const prevTransition = player.style.transition;
		player.style.transition = 'none';
		player.style.transform = 'none';
		const r = player.getBoundingClientRect();
		player.style.transform = prevTransform;
		player.style.transition = prevTransition;
		base = { left: r.left, top: r.top, width: r.width, height: r.height };
	}
	// 20% narrower than legacy 0.34/420: saves video space while keeping readability
	panelW = customWidth || Math.min(Math.max(224, Math.round(window.innerWidth * 0.272)), 336);
	panelW = Math.max(PANEL_MIN, Math.min(panelW, PANEL_MAX));
	// Allow the panel to consume up to 70% of the video width if the user explicitly drags it that large
	panelW = Math.min(panelW, base.width * 0.7);
	scaleVal = Math.max(0.2, (base.width - panelW) / base.width);
}

// Vertical offset that centers the shrunk player within its original box.
function centerDy() {
	return base.height * (1 - scaleVal) / 2;
}

function applyScale() {
	if (!player) return;
	player.style.transformOrigin = 'top left';
	player.style.transition = 'transform 0.3s ease';
	// Shrink toward top-left, then drop down so it's vertically centered.
	player.style.transform = `translateY(${centerDy()}px) scale(${scaleVal})`;
	document.body.dataset.obVpsScale = scaleVal.toString();
	document.body.dataset.obVpsLeft = base.left.toString();
	document.body.dataset.obVpsTop = base.top.toString();
	document.body.dataset.obVpsDy = centerDy().toString();
}

// Dim only the ORIGINAL player box (not the rest of the page): the bands above
// and below the vertically-centered resized player, plus behind the panel. The
// dim element is sized to the original player rect with a clip-path hole over the
// resized player. pointer-events:none keeps the live player clickable. (A plain
// opaque element can't sit behind the player — it's nested too deep to ever paint
// above a body-level layer — so we cut a hole instead of raising the player.)
function layoutDim() {
	if (!dim) return;
	dim.style.left = `${base.left}px`;
	dim.style.top = `${base.top}px`;
	dim.style.width = `${base.width}px`;
	dim.style.height = `${base.height}px`;
	// Hole = resized player rect, relative to this element's own box.
	const hx1 = 0;
	const hy1 = centerDy();
	const hx2 = base.width * scaleVal;
	const hy2 = hy1 + base.height * scaleVal;
	dim.style.clipPath =
		'polygon(evenodd,' +
		' 0px 0px, 100% 0px, 100% 100%, 0px 100%, 0px 0px,' +
		` ${hx1}px ${hy1}px, ${hx1}px ${hy2}px, ${hx2}px ${hy2}px, ${hx2}px ${hy1}px, ${hx1}px ${hy1}px)`;
}

function hostMountTarget(): HTMLElement {
	return fs ? (fsElement() || document.body) : document.body;
}

// While in fullscreen, capture Escape so it closes the panel instead of the
// browser force-exiting fullscreen. Ref-counted via engage/disengage so a
// transcript↔comment switch doesn't release the lock the open panel still needs.
// Per https://developer.chrome.com/blog/better-full-screen-mode the lock must
// be requested while JS-initiated fullscreen is active, ideally in a
// fullscreenchange handler. Content scripts run in an isolated world where
// navigator.keyboard is often undefined, so we inject a transient <script> that
// runs in the page (main world) where the API exists.
function lockEscape() {
	if (!fs) return;
	// Try main world via inline script (no race with external patch loading)
	try {
		const s = document.createElement('script');
		s.textContent = `try{ navigator.keyboard && navigator.keyboard.lock && navigator.keyboard.lock(['Escape']).catch(()=>{}) }catch(e){}`;
		(document.head || document.documentElement).appendChild(s);
		s.remove();
	} catch {}
	// Also try isolated world (works in some browsers) and dispatch to patch
	try { window.dispatchEvent(new CustomEvent('__obVpsLock')); } catch {}
	try { document.dispatchEvent(new CustomEvent('__obVpsLock')); } catch {}
	const kb = (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard;
	if (kb?.lock) { try { kb.lock(['Escape'])?.catch(() => {}); } catch { /* ignore */ } }
}
function unlockEscape() {
	try {
		const s = document.createElement('script');
		s.textContent = `try{ navigator.keyboard && navigator.keyboard.unlock && navigator.keyboard.unlock() }catch(e){}`;
		(document.head || document.documentElement).appendChild(s);
		s.remove();
	} catch {}
	try { window.dispatchEvent(new CustomEvent('__obVpsUnlock')); } catch {}
	try { document.dispatchEvent(new CustomEvent('__obVpsUnlock')); } catch {}
	const kb = (navigator as unknown as { keyboard?: { unlock?: () => void } }).keyboard;
	if (kb?.unlock) { try { kb.unlock(); } catch { /* ignore */ } }
}

export function engagePlayerStage(): void {
	if (refCount === 0) {
		player = getPlayerContainer();
		if (!player) return;
		lastPlayerForRestore = player;
		saved = {
			transform: player.style.transform,
			transformOrigin: player.style.transformOrigin,
			transition: player.style.transition,
			zIndex: player.style.zIndex,
			position: player.style.position,
		};
		measureBase();
		counterScale = fs && fsElement() === player;
		applyScale();
		if (!fs) {
			// In fullscreen the area around the shrunk player is already the browser's
			// black backdrop, so a dim is only needed in windowed mode.
			dim = document.createElement('div');
			dim.className = 'ob-vps-dim';
			document.body.appendChild(dim);
			layoutDim();
		}
		// Lock page scrolling for the session: the player is in the page flow, so
		// scrolling would drift it out of the dim hole and re-measuring on every
		// scroll event caused a full↔resized stutter. The player + panel stay pinned
		// as a focused unit; the transcript panel scrolls internally.
		savedHtmlOverflow = document.documentElement.style.overflow;
		document.documentElement.style.overflow = 'hidden';
		injectPatchScript();
		lockEscape();
		window.addEventListener('resize', relayoutAll, true);
		document.addEventListener('fullscreenchange', onFsChange, true);
	}
	refCount++;
}

export function mountHost(host: HTMLElement): void {
	host.classList.add('ob-vps-host');
	
	const resizer = document.createElement('div');
	resizer.className = 'ob-vps-resizer';
	let startX = 0;
	let startW = 0;
	
	const onMove = (e: MouseEvent) => {
		const dx = startX - e.clientX; 
		setCustomPanelWidth(Math.min(Math.max(PANEL_MIN, startW + dx), PANEL_MAX));
	};
	const onUp = () => {
		document.removeEventListener('mousemove', onMove, true);
		document.removeEventListener('mouseup', onUp, true);
		document.body.style.cursor = '';
	};
	resizer.addEventListener('mousedown', (e) => {
		startX = e.clientX;
		startW = panelW;
		document.addEventListener('mousemove', onMove, true);
		document.addEventListener('mouseup', onUp, true);
		document.body.style.cursor = 'col-resize';
		e.preventDefault();
	});
	host.appendChild(resizer);

	hosts.add(host);
	hostMountTarget().appendChild(host);
	layoutHost(host);
}

export function unmountHost(host: HTMLElement): void {
	hosts.delete(host);
	host.remove();
}

export function disengagePlayerStage(): void {
	refCount = Math.max(0, refCount - 1);
	if (refCount === 0) {
		if (player && saved) {
			player.style.transform = saved.transform;
			player.style.transformOrigin = saved.transformOrigin;
			player.style.transition = saved.transition;
		}
		dim?.remove();
		dim = null;
		// Keep lastPlayerForRestore for fallback re-enter after Esc
		if (player) lastPlayerForRestore = player;
		player = null;
		saved = null;
		hosts.clear();
		delete document.body.dataset.obVpsScale;
		delete document.body.dataset.obVpsLeft;
		delete document.body.dataset.obVpsTop;
		delete document.body.dataset.obVpsDy;
		document.documentElement.style.overflow = savedHtmlOverflow;
		// Delay the unlock: if this disengage was triggered by an Escape press,
		// unlocking immediately would let that same press also exit fullscreen.
		setTimeout(unlockEscape, 400);
		window.removeEventListener('resize', relayoutAll, true);
		document.removeEventListener('fullscreenchange', onFsChange, true);
	}
}

function layoutHost(host: HTMLElement) {
	host.style.zIndex = '2147483646';
	// The panel spans the FULL original player height; the player is centered
	// within that height beside it.
	if (fs && counterScale) {
		// Host lives inside the scaled player → counter-scale to render 1:1.
		host.style.position = 'absolute';
		host.style.transformOrigin = 'top left';
		host.style.transform = `scale(${1 / scaleVal})`;
		host.style.left = `${base.width}px`;      // ×scaleVal on screen = base.width·scale
		host.style.top = '0px';
		host.style.width = `${panelW}px`;
		host.style.height = `${base.height}px`;
	} else {
		host.style.position = 'fixed';
		host.style.transform = 'none';
		host.style.left = `${base.left + base.width * scaleVal}px`;
		host.style.top = `${base.top}px`;
		host.style.width = `${panelW}px`;
		host.style.height = `${base.height}px`;
	}
}

function relayoutAll() {
	if (!player) return;
	measureBase();
	counterScale = fs && fsElement() === player;
	applyScale();
	layoutDim();
	hosts.forEach(layoutHost);
}

function onFsChange() {
	const wasFs = fs;
	const nowFs = !!fsElement();
	// Fallback: if fullscreen exited right after a panel Esc, the browser
	// ignored keyboard.lock and exited anyway. Re-enter so first Esc only
	// closes the panel and stays fullscreen; second Esc then exits normally.
	if (wasFs && !nowFs && Date.now() - lastPanelEsc < 700) {
		const restoreTarget = lastPlayerForRestore || document.querySelector('#movie_player') as HTMLElement | null;
		if (restoreTarget && restoreTarget.requestFullscreen) {
			// Still within transient activation, so this succeeds
			restoreTarget.requestFullscreen().catch(() => {});
		}
		// Even if re-enter fails, don't let a half-torn host linger windowed
	}
	if (!player && !wasFs) return;
	if (!player) {
		fs = nowFs;
		if (fs) lockEscape(); else unlockEscape();
		return;
	}
	fs = nowFs;
	const target = hostMountTarget();
	// Re-home hosts into the (new) correct parent. Moving a node resets the
	// scrollTop of any scroll container inside it, so snapshot and restore it
	// (after relayout, so a changed panel height doesn't clamp the value).
	const tops = new Map<HTMLElement, number>();
	hosts.forEach(h => {
		h.querySelectorAll<HTMLElement>('.ob-vt-list, .ob-vid-msgs').forEach(el => tops.set(el, el.scrollTop));
		if (h.parentElement !== target) target.appendChild(h);
	});
	if (fs) lockEscape(); else unlockEscape();
	relayoutAll();
	// Restore scroll only after the re-homed panel has laid out in its new context
	// (scrollHeight is 0 immediately after the move, which would clamp scrollTop).
	const restore = () => tops.forEach((top, el) => { el.scrollTop = top; });
	requestAnimationFrame(() => { restore(); requestAnimationFrame(restore); });
	setTimeout(restore, 80);
}
