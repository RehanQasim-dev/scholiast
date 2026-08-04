import browser from '../../utils/browser-polyfill';
import DOMPurify from 'dompurify';
import { commentTextToDisplayHtml, toggleTaskInMarkdown } from '../../utils/comment-markdown';
import { loadDiagramImage } from '../../utils/video/frame-store';
import { VideoItem } from '../../utils/video/video-storage';
import { button, el, icon, markMatches, menuButton, tip } from './ui';
import { commentBody, commentTimes, formatStamp, fullStamp } from './format';
import { state, renderStream } from './store';
import { addComment, deleteComment, editComment } from './actions';
import { createEditor, focusEditor } from './editor';
import { RenderUnit } from './types';

/**
 * A comment thread. Every comment's own metadata (when it was written, whether it
 * was edited) sits directly under its text rather than in a far-right column, so
 * the eye never has to cross the card to date what it just read.
 */

// `#tag` pills, matching the live comment box's inline tag look.
const TAG_PILL_CLASS = 'sc-tag-pill';

/** A comment body: the shared markdown subset, plus pasted images from the blob store. */
function renderBody(text: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	for (const part of text.split(/(<!--image:[A-Za-z0-9_-]+-->)/g)) {
		if (!part) continue;
		const imageId = part.match(/^<!--image:([A-Za-z0-9_-]+)-->$/)?.[1];
		if (imageId) {
			const img = el('img', 'sc-md-image');
			img.alt = 'Pasted image';
			img.loading = 'lazy';
			void loadDiagramImage(imageId).then(src => { if (src) img.src = src; });
			frag.appendChild(img);
			continue;
		}
		const holder = el('div', 'sc-md');
		// The renderer emits only its own tags, but the text came from a synced
		// record, so it goes through DOMPurify like every other body here.
		holder.replaceChildren(DOMPurify.sanitize(
			// blockClass wraps each paragraph, so a blank line in a comment reads as a
			// paragraph break instead of the two lines running together.
			commentTextToDisplayHtml(part, { tagClass: TAG_PILL_CLASS, blockClass: 'sc-md-p' }),
			{ RETURN_DOM_FRAGMENT: true },
		));
		frag.appendChild(holder);
	}
	return frag;
}

function metaRow(created: number, edited: number): HTMLElement {
	const meta = el('div', 'sc-comment__meta');
	const when = el('time', 'sc-stamp', formatStamp(created));
	if (created) tip(when, fullStamp(created));
	meta.appendChild(when);
	if (edited) {
		const mark = el('span', 'sc-stamp sc-stamp--muted', 'edited');
		tip(mark, `Edited ${fullStamp(edited)}`);
		meta.append(el('span', 'sc-dot', '·'), mark);
	}
	return meta;
}

export interface CommentContext {
	unit: RenderUnit;
	highlightId: string;
	noteIndex: number;
	note: string;
	video: VideoItem | null;
}

export function createCommentRow(ctx: CommentContext): HTMLElement | null {
	const { unit, highlightId, noteIndex, note, video } = ctx;
	const body = commentBody(note);
	if (!body) return null;

	const key = `${unit.pageUrl}::${highlightId}::${noteIndex}`;
	const row = el('div', 'sc-comment');
	row.dataset.comment = key;

	if (state.editingComment === key) {
		row.classList.add('is-editing');
		row.appendChild(createEditor({
			value: body,
			placeholder: 'Edit comment…',
			autofocus: true,
			submitLabel: 'Save',
			onSubmit: async (text) => {
				state.editingComment = null;
				if (text && text !== body) await editComment(unit.pageUrl, highlightId, noteIndex, text, video);
				else renderStream();
			},
			onCancel: () => { state.editingComment = null; renderStream(); },
		}));
		return row;
	}

	const { created, edited } = commentTimes(note);
	const diagramId = body.match(/^<!--diagram:([A-Za-z0-9_-]+)-->$/)?.[1] ?? null;

	if (diagramId) {
		const img = el('img', 'sc-diagram');
		img.alt = 'Diagram';
		tip(img, 'Open in the diagram editor');
		void loadDiagramImage(diagramId).then(src => { if (src) img.src = src; });
		img.addEventListener('click', () => {
			void browser.runtime.sendMessage({ action: 'openPopupWithDiagram', id: diagramId });
		});
		row.appendChild(img);
	} else {
		const text = el('div', 'sc-comment__body');
		text.appendChild(renderBody(body));
		if (state.filters.query) markMatches(text, state.filters.query);
		text.addEventListener('click', (e) => {
			const box = (e.target as HTMLElement).closest('.ob-md-check');
			if (!box) return;
			const nth = Array.from(text.querySelectorAll('.ob-md-check')).indexOf(box);
			if (nth < 0) return;
			void editComment(unit.pageUrl, highlightId, noteIndex, toggleTaskInMarkdown(body, nth), video);
		});
		row.appendChild(text);
	}

	const meta = metaRow(created, edited);
	const actions = el('div', 'sc-comment__actions');
	if (!diagramId) {
		actions.appendChild(button({
			iconName: 'edit', tooltip: 'Edit comment',
			onClick: () => { state.editingComment = key; renderStream(); },
		}));
	}
	actions.appendChild(menuButton(
		button({ iconName: 'more_horiz', tooltip: 'Comment actions' }),
		() => [
			...(diagramId ? [] : [{
				type: 'item' as const, label: 'Edit', iconName: 'edit',
				onSelect: () => { state.editingComment = key; renderStream(); },
			}]),
			{ type: 'sep' as const },
			{
				type: 'item' as const, label: diagramId ? 'Delete diagram' : 'Delete comment',
				iconName: 'delete', danger: true,
				onSelect: () => { void deleteComment(unit.pageUrl, highlightId, noteIndex, video); },
			},
		],
	));
	meta.appendChild(actions);
	row.appendChild(meta);
	return row;
}

/**
 * The always-present affordance that ends every thread.
 *
 * Opening and closing the editor swaps this row's contents *in place* rather than
 * re-rendering the card. Re-rendering destroyed the button mid-click, which is what
 * made opening a reply box unpredictable — sometimes focused, sometimes just a
 * flash, sometimes a scroll jump.
 */
export function createReplyRow(unit: RenderUnit, hasComments: boolean): HTMLElement {
	const holder = el('div', 'sc-reply');

	const showEditor = (autofocus: boolean) => {
		state.replyOpen.add(unit.key);
		const editor = createEditor({
			placeholder: hasComments ? 'Reply…' : 'Add a comment…',
			autofocus,
			onSubmit: async (text) => {
				// Stay open: threads are usually written a few thoughts at a time.
				await addComment(unit, text);
			},
			onCancel: () => {
				state.replyOpen.delete(unit.key);
				showButton();
			},
		});
		holder.replaceChildren(editor);
		if (autofocus) focusEditor(editor);
	};

	const showButton = () => {
		const open = el('button', 'sc-reply__open');
		open.type = 'button';
		open.appendChild(icon('add_comment'));
		open.appendChild(el('span', '', hasComments ? 'Reply' : 'Add a comment'));
		open.addEventListener('click', () => showEditor(true));
		holder.replaceChildren(open);
	};

	if (state.replyOpen.has(unit.key)) showEditor(true);
	else showButton();
	return holder;
}
