import {
	VideoItem, loadVideoData, upsertVideoItem, genVideoId, removeVideoItem
} from './video-storage';
import { renderMarkupSvg } from './video-markup';
import { makeVideoNote, parseVideoNote, renderNoteHtml, formatVideoTime } from './video-notes';
import { getVideoElement } from './youtube-detect';
import { loadFrameImage } from './frame-store';
import { engagePlayerStage, mountHost, unmountHost, disengagePlayerStage } from './video-player-stage';

// Per-video "conversation" comment panel: a right-docked overlay listing every
// annotation for the video (frame / note / transcript) as grouped thread cards
// — one card = one item's anchor + all its replies — with the focused thread
// expanded and its reply box active. Shared by the frame/note flows
// (video-annotator) and the transcript panel. Reuses the .ob-vid-* slate styles.
//
// Opened either standalone (resumeOnClose: resumes the video on Esc) or nested
// inside the transcript panel (onClose returns there; the panel keeps the video
// paused).

export interface OpenCommentsOpts {
	watchUrl: string;
	videoId: string;
	videoTitle: string;
	video: HTMLVideoElement | null;
	wasPlaying: boolean;
	focusItemId?: string;
	resumeOnClose: boolean;
	onClose?: () => void;
	// A freshly-created item (e.g. a new note/frame) not yet persisted; included
	// in the list and written on first reply.
	ensureItem?: VideoItem;
	// During a panel switch (transcript ↔ comment) the player is already scaled and
	// stays put; switchMode just drops the open fade-in so only the panel changes.
	switchMode?: boolean;
}

let active = false;
let opts: OpenCommentsOpts | null = null;
let items: VideoItem[] = [];

let focusId: string | null = null;
let editingNoteKey: { itemId: string, index: number } | null = null;


let root: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let openedFullscreen = false;

// Close the panel programmatically (e.g. to switch to another panel).
export function closeComments(): void {
	if (active) teardown();
}

export function isCommentsActive(): boolean {
	return active;
}

export async function openComments(o: OpenCommentsOpts): Promise<void> {
	if (active) return;
	opts = o;
	active = true;
	openedFullscreen = !!document.fullscreenElement;

	if (o.video) o.video.pause();

	// Show the panel right away (scale the player, dock the panel, focus the reply
	// box) so pressing N reacts instantly. Seed the list with what we already know
	// — a freshly created note/frame, focused — then fill in the rest once storage
	// resolves. Loading data first would gate the whole visual reaction on disk I/O.
	items = o.ensureItem ? [o.ensureItem] : [];
	focusId = o.focusItemId || (items.length ? items[0].id : null);
	build();

	const data = await loadVideoData(o.watchUrl);
	if (!active || opts !== o) return; // closed / superseded while loading
	const loaded = data ? data.items.slice() : [];
	if (o.ensureItem && !loaded.some(i => i.id === o.ensureItem!.id)) {
		loaded.push(o.ensureItem);
	}
	loaded.sort((a, b) => a.videoTime - b.videoTime);
	items = loaded;
	if (!o.focusItemId && !focusId) focusId = null;
	renderConversation();
}

export function addCommentOnlyNote(): void {
	if (!active || !opts || !opts.video) return;
	opts.video.pause();
	const note: VideoItem = { id: genVideoId(), kind: 'note', videoTime: opts.video.currentTime, notes: [] };
	items.push(note);
	items.sort((a, b) => a.videoTime - b.videoTime);
	focusId = note.id;
	renderConversation();
}

// --- Layout ------------------------------------------------------------------
// The live player is scaled to the left by the shared player stage; this panel
// just fills the host the stage docks on the right.

function build() {
	engagePlayerStage();
	root = document.createElement('div');
	root.className = 'ob-vidc-host' + (opts?.switchMode ? ' ob-vid-noanim' : '');

	const head = document.createElement('div');
	head.className = 'ob-vid-panel-head';
	const title = document.createElement('span');
	title.className = 'ob-vid-panel-time';
	title.textContent = 'Comments';
	const close = document.createElement('button');
	close.type = 'button';
	close.className = 'ob-vid-panel-close';
	close.title = 'Close (Esc)';
	close.textContent = '✕';
	close.addEventListener('click', () => teardown());
	head.appendChild(title);
	head.appendChild(close);

	listEl = document.createElement('div');
	listEl.className = 'ob-vid-msgs ob-vidc-conv';

	root.appendChild(head);
	root.appendChild(listEl);
	mountHost(root);

	renderConversation();

	window.addEventListener('keydown', onKeyDown, true);
	window.addEventListener('keyup', onKeyUpShield, true);
	window.addEventListener('keypress', onKeyUpShield, true);
	window.addEventListener('mousedown', onMouseDownOutside, true);
}

function onMouseDownOutside(e: MouseEvent) {
	if (!active) return;
	const target = e.target as HTMLElement | null;
	const thread = target?.closest('.ob-vidc-thread');

	if (!thread) {
		const staleFocusId = focusId;
		if (staleFocusId === null) return;

		// Defer to mouseup to avoid interrupting drags
		window.addEventListener('mouseup', () => {
			setTimeout(() => {
				if (focusId !== staleFocusId) return; // focus changed mid-drag
				if (inputEl && inputEl.value.trim().length > 0) return; // draft stays open
				focusId = null;
	editingNoteKey = null;
				renderConversation();
			}, 0);
		}, { once: true, capture: true });
	}
}

// --- Rendering ---------------------------------------------------------------

function anchorHeader(item: VideoItem): HTMLElement {
	const head = document.createElement('div');
	head.className = 'ob-vidc-anchor';
	const stamp = item.timeEnd != null 
		? `${formatVideoTime(item.videoTime)}–${formatVideoTime(item.timeEnd)}`
		: formatVideoTime(item.videoTime);

	if (item.kind === 'frame' && item.frame) {
		const thumb = document.createElement('div');
		thumb.className = 'ob-vidc-thumb';
		thumb.style.backgroundImage = `url(${item.frame.dataUrl})`;
		head.appendChild(thumb);
	} else if (item.kind === 'transcript' && item.quote) {
		const q = document.createElement('div');
		q.className = 'ob-vidc-quote';
		q.textContent = item.quote;
		if (item.color) q.style.borderLeftColor = `var(--ob-hl-${item.color})`;
		head.appendChild(q);
	}

	const chip = document.createElement('span');
	chip.className = 'ob-vidc-stamp';
	chip.textContent = stamp;
	head.appendChild(chip);
	return head;
}
function renderConversation() {
	if (!listEl) return;
	// Preserve an in-progress reply across a re-render: openComments rebuilds the
	// list once storage finishes loading, which would otherwise wipe whatever the
	// user already started typing into the focused thread's box.
	const prevText = inputEl?.value || '';
	const hadFocus = document.activeElement === inputEl;
	const selStart = inputEl?.selectionStart ?? null;
	const selEnd = inputEl?.selectionEnd ?? null;

	// Clean up abandoned empty notes when focus shifts away from them
	items = items.filter(i => i.id === focusId || !(i.kind === 'note' && i.notes.length === 0));

	listEl.replaceChildren();
	if (items.length === 0) {
		const empty = document.createElement('div');
		empty.className = 'ob-vidc-empty';
		empty.textContent = 'No comments yet.';
		listEl.appendChild(empty);
		return;
	}

	for (const item of items) {
		const card = document.createElement('div');
		card.className = 'ob-vidc-thread' + (item.id === focusId ? ' is-focused' : '');
		card.dataset.itemId = item.id;
		card.addEventListener('click', (e) => {
			if (item.id === focusId) return;
			// Ignore clicks that originate in the (focused) input row.
			if ((e.target as HTMLElement).closest('.ob-vidc-replywrap')) return;
			focusId = item.id;
			renderConversation();
		});

		const anchorHead = anchorHeader(item);
		card.appendChild(anchorHead);

		const msgs = document.createElement('div');
		msgs.className = 'ob-vidc-msgs';
		for (let index = 0; index < item.notes.length; index++) {
			const note = item.notes[index];
			const parsed = parseVideoNote(note);
			const bubble = document.createElement('div');
			bubble.className = 'ob-vid-msg';
			
			let head: HTMLElement;
			if (index === 0) {
				head = anchorHead;
			} else {
				head = document.createElement('div');
				head.className = 'ob-vid-msg-header';
			}
			
			const actionsContainer = document.createElement('div');
			actionsContainer.style.display = 'flex';
			actionsContainer.style.alignItems = 'center';
			actionsContainer.style.marginLeft = 'auto';
			
			if (parsed.timestamp) {
				const timeEl = document.createElement('span');
				timeEl.className = 'ob-vid-msg-time';
				timeEl.textContent = clockTime(parsed.timestamp);
				actionsContainer.appendChild(timeEl);
			}
			
			const actions = document.createElement('div');
			actions.className = 'obsidian-comment-actions-inline';
			
			const editBtn = document.createElement('button');
			editBtn.className = 'obsidian-comment-edit';
			editBtn.title = 'Edit comment';
			editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
			editBtn.addEventListener('click', (ev) => {
				ev.stopPropagation();
				editingNoteKey = { itemId: item.id, index };
				renderConversation();
			});
			actions.appendChild(editBtn);

			const delBtn = document.createElement('button');
			delBtn.className = 'obsidian-comment-delete';
			delBtn.title = 'Delete comment';
			delBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
			delBtn.addEventListener('click', async (ev) => {
				ev.stopPropagation();
				item.notes.splice(index, 1);
				if (item.notes.length === 0 && item.kind === 'note') {
					items = items.filter(i => i.id !== item.id);
					if (opts) await removeVideoItem(opts.watchUrl, item.id);
				} else {
					if (opts) await upsertVideoItem(opts.watchUrl, opts.videoId, opts.videoTitle, item);
				}
				renderConversation();
			});
			actions.appendChild(delBtn);

			if (index === 0) {
				const threadDelBtn = document.createElement('button');
				threadDelBtn.className = 'obsidian-comment-thread-delete';
				threadDelBtn.title = 'Delete comment thread';
				threadDelBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
				threadDelBtn.addEventListener('click', async (ev) => {
					ev.stopPropagation();
					items = items.filter(i => i.id !== item.id);
					if (opts) await removeVideoItem(opts.watchUrl, item.id);
					renderConversation();
				});
				actions.appendChild(threadDelBtn);
			}
			
			actionsContainer.appendChild(actions);
			
			if (index === 0) {
				const chip = head.querySelector('.ob-vidc-stamp');
				if (chip && chip.parentNode) {
					const row = document.createElement('div');
					row.style.display = 'flex';
					row.style.alignItems = 'center';
					row.style.width = '100%';
					chip.parentNode.insertBefore(row, chip);
					row.appendChild(chip);
					row.appendChild(actionsContainer);
				} else {
					head.appendChild(actionsContainer);
				}
			} else {
				head.appendChild(actionsContainer);
				bubble.appendChild(head);
			}

			const isEditing = editingNoteKey && editingNoteKey.itemId === item.id && editingNoteKey.index === index;
			
			if (isEditing) {
				const wrap = document.createElement('div');
				wrap.className = 'ob-vid-inline-input-wrap';
				const editTa = document.createElement('textarea');
				editTa.className = 'ob-vid-input edit-comment-textarea';
				editTa.value = parsed.text;
				
				const resize = () => {
					editTa.style.height = 'auto';
					editTa.style.height = `${Math.min(editTa.scrollHeight, 140)}px`;
				};
				editTa.addEventListener('input', resize);
				
				editTa.addEventListener('keydown', async (ev) => {
					ev.stopPropagation();
					if (ev.key === 'Escape') {
						ev.preventDefault();
						editingNoteKey = null;
						renderConversation();
					} else if (ev.key === 'Enter' && !ev.shiftKey) {
						if (ev.isComposing) return;
						ev.preventDefault();
						const text = editTa.value.trim();
						if (text) {
							// Update note with edited timestamp
							const ts = parsed.timestamp || Date.now();
							item.notes[index] = `<!--timestamp:${ts}--><!--edited:${Date.now()}-->\n\n${text}`;
							if (opts) await upsertVideoItem(opts.watchUrl, opts.videoId, opts.videoTitle, item);
						}
						editingNoteKey = null;
						renderConversation();
					}
				});
				
				wrap.appendChild(editTa);
				bubble.appendChild(wrap);
				
				setTimeout(() => {
					editTa.focus({ preventScroll: true });
					editTa.selectionStart = editTa.value.length;
					editTa.selectionEnd = editTa.value.length;
					resize();
				}, 60);
			} else {
				const body = document.createElement('div');
				body.className = 'ob-vid-msg-body';
				body.innerHTML = renderNoteHtml(parsed.text);
				bubble.appendChild(body);
	
				requestAnimationFrame(() => {
					if (body.scrollHeight - body.clientHeight > 4) {
						const more = document.createElement('button');
						more.type = 'button';
						more.className = 'ob-vid-msg-more';
						more.textContent = 'Show more';
						more.addEventListener('click', (ev) => {
							ev.stopPropagation();
							const open = bubble.classList.toggle('is-open');
							more.textContent = open ? 'Show less' : 'Show more';
						});
						bubble.appendChild(more);
					}
				});
			}

			msgs.appendChild(bubble);
		}
		card.appendChild(msgs);

		// The focused thread carries the reply box, with the anchor quote pinned
		// above it (WhatsApp-style) for transcript items.
		if (item.id === focusId) {
			// The thread's quote already sits in the anchor header at the top of this
			// same card, so we don't repeat it above the input.
			const wrap = document.createElement('div');
			wrap.className = 'ob-vid-input-wrap ob-vidc-replywrap';
			inputEl = document.createElement('textarea');
			inputEl.className = 'ob-vid-input';
			inputEl.rows = 1;
			inputEl.placeholder = 'reply here';
			inputEl.addEventListener('input', autosizeInput);
			wrap.appendChild(inputEl);
			card.appendChild(wrap);
		}

		listEl.appendChild(card);
	}

	// Restore any preserved in-progress reply text before measuring/scrolling.
	if (inputEl && prevText) {
		inputEl.value = prevText;
		autosizeInput();
	}

	// Bring the focused thread's reply box into view and focus it, so you can type
	// immediately without scrolling.
	const focused = listEl.querySelector('.ob-vidc-thread.is-focused') as HTMLElement | null;
	setTimeout(() => {
		if (inputEl) {
			inputEl.scrollIntoView({ block: 'center' });
			inputEl.focus({ preventScroll: true });
			// Put the caret back where it was if the user was mid-reply.
			if (hadFocus && selStart != null && selEnd != null) {
				try { inputEl.setSelectionRange(selStart, selEnd); } catch { /* ignore */ }
			}
		} else if (focused) {
			focused.scrollIntoView({ block: 'nearest' });
		}
	}, 60);
}

// Wall-clock time a comment was written, e.g. "1:02 PM".
function clockTime(ts: number): string {
	try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
	catch { return ''; }
}

function autosizeInput() {
	if (!inputEl) return;
	inputEl.style.height = 'auto';
	inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`;
}

async function postMessage() {
	if (!inputEl || !opts) return;
	const text = inputEl.value.trim();
	if (!text) return;
	const item = items.find(i => i.id === focusId);
	if (!item) return;
	item.notes.push(makeVideoNote(text, Date.now()));
	inputEl.value = '';
	autosizeInput();
	await upsertVideoItem(opts.watchUrl, opts.videoId, opts.videoTitle, item);
	renderConversation();
}

function seekTo(seconds: number) {
	const v = opts?.video || getVideoElement();
	if (v) { try { v.currentTime = Math.max(0, seconds); } catch { /* ignore */ } }
}

// --- Keyboard ----------------------------------------------------------------

function onKeyUpShield(e: KeyboardEvent) {
	if (!active) return;
	if ((e.target as HTMLElement)?.classList?.contains('ob-vid-input')) e.stopPropagation();
}

function onKeyDown(e: KeyboardEvent) {
	if (!active) return;
	const target = e.target as HTMLElement;
	const inChat = !!target?.classList?.contains('ob-vid-input');
	if (inChat) {
		// Typing: shield everything from YouTube's shortcuts (Space, etc.).
		e.stopPropagation();
		if (target.classList.contains('edit-comment-textarea')) {
			// Edit textarea handles its own Escape and Enter
			return;
		}
		if (e.key === 'Escape') { e.preventDefault(); teardown(); }
		else if (e.key === 'Enter' && !e.shiftKey) { 
			if (e.isComposing) return;
			e.preventDefault(); 
			postMessage(); 
		}
		return;
	}
	// Not typing: only claim Escape; let every other key reach YouTube (Space →
	// play/pause, etc.) so its shortcuts keep working behind the panel.
	if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); teardown(); }
}

// --- Teardown ----------------------------------------------------------------

function teardown() {
	const o = opts;
	window.removeEventListener('keydown', onKeyDown, true);
	window.removeEventListener('keyup', onKeyUpShield, true);
	window.removeEventListener('keypress', onKeyUpShield, true);
	window.removeEventListener('mousedown', onMouseDownOutside, true);

	if (root) unmountHost(root);
	disengagePlayerStage();
	root = listEl = inputEl = null;
	active = false;
	items = [];
	focusId = null;
	editingNoteKey = null;
	opts = null;

	if (o?.resumeOnClose && o.wasPlaying && o.video) o.video.play().catch(() => {});
	o?.onClose?.();
}
