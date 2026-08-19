import DOMPurify from 'dompurify';
import {
	activeCommentFormats, applyCommentFormat, commentTextToEditableHtml, refreshTagPills,
	repairTaskList, serializeCommentEditor, toggleTaskFromClick, type CommentFormatCommand,
} from '../../utils/comment-markdown';
import { el, icon, tip, TAG_PILL_CLASS } from './ui';

/**
 * The comment editor — the same WYSIWYG contenteditable over the same markdown
 * subset as the live page's comment box, so a comment reads and edits identically
 * on both surfaces.
 *
 * It deliberately shares `.sc-md` and the comment's type metrics with the display
 * row: entering edit mode must not resize or reflow the text you are about to edit.
 */

const FORMAT_BUTTONS: { command: CommentFormatCommand; label: string; glyph: string }[] = [
	{ command: 'bullet', label: 'Bullet list', glyph: 'format_list_bulleted' },
	{ command: 'task', label: 'Checklist', glyph: 'checklist' },
	{ command: 'bold', label: 'Bold — Ctrl+B', glyph: 'format_bold' },
	{ command: 'italic', label: 'Italic — Ctrl+I', glyph: 'format_italic' },
];

export interface EditorOpts {
	value?: string;
	placeholder?: string;
	autofocus?: boolean;
	submitLabel?: string;
	onSubmit: (text: string) => void | Promise<void>;
	onCancel?: () => void;
}

export function createEditor(opts: EditorOpts): HTMLElement {
	const wrap = el('div', 'sc-editor');

	const field = el('div', 'sc-editor__field sc-md');
	field.contentEditable = 'true';
	field.setAttribute('role', 'textbox');
	field.setAttribute('aria-multiline', 'true');
	field.setAttribute('aria-label', opts.placeholder || 'Comment');
	field.dataset.placeholder = opts.placeholder || '';
	if (opts.value) {
		field.replaceChildren(DOMPurify.sanitize(
			commentTextToEditableHtml(opts.value, { tagClass: TAG_PILL_CLASS }),
			{ RETURN_DOM_FRAGMENT: true }));
	}

	const bar = el('div', 'sc-editor__bar');
	const formats = el('div', 'sc-editor__formats');
	const formatButtons = FORMAT_BUTTONS.map(({ command, label, glyph }) => {
		const b = el('button', 'sc-fmt');
		b.type = 'button';
		b.dataset.format = command;
		tip(b, label);
		b.appendChild(icon(glyph));
		// mousedown's default would blur the field, and the commands act on the
		// live selection.
		b.addEventListener('mousedown', e => e.preventDefault());
		b.addEventListener('click', (e) => {
			e.preventDefault();
			applyCommentFormat(field, command);
			syncFormats();
		});
		formats.appendChild(b);
		return b;
	});

	const hint = el('span', 'sc-editor__hint');
	hint.append(el('kbd', '', 'Enter'), document.createTextNode(' to save'));
	if (opts.onCancel) hint.append(document.createTextNode(' · '), el('kbd', '', 'Esc'), document.createTextNode(' to cancel'));
	// In a list, Enter makes the next item — say so, where it matters.
	const listHint = el('span', 'sc-editor__hint sc-editor__hint--list');
	listHint.append(el('kbd', '', 'Ctrl'), document.createTextNode('+'), el('kbd', '', 'Enter'), document.createTextNode(' to save'));

	const send = el('button', 'sc-send');
	send.type = 'button';
	tip(send, opts.submitLabel || 'Save comment');
	send.appendChild(icon('arrow_upward'));

	bar.append(formats, hint, listHint, send);

	const value = () => serializeCommentEditor(field).trim();
	const syncSend = () => {
		const has = value().length > 0;
		send.disabled = !has;
		wrap.classList.toggle('is-empty', !has);
		field.classList.toggle('is-empty', !has);
	};
	const syncFormats = () => {
		const active = activeCommentFormats(field);
		for (const b of formatButtons) {
			b.classList.toggle('is-on', active.has(b.dataset.format as CommentFormatCommand));
		}
		// Inside a list, Enter makes the next item, so the hint has to say so.
		wrap.classList.toggle('is-in-list', active.has('bullet') || active.has('task'));
	};
	const submit = async () => {
		const text = value();
		if (!text) { opts.onCancel?.(); return; }
		field.replaceChildren();
		syncSend();
		await opts.onSubmit(text);
	};

	// Tags render as pills while writing, exactly as they do in the saved comment.
	// The pass runs on caret moves too — leaving a half-typed tag is what finishes it.
	const syncTags = () => refreshTagPills(field, TAG_PILL_CLASS);
	field.addEventListener('input', () => { syncTags(); syncSend(); syncFormats(); });
	field.addEventListener('keyup', () => { syncTags(); syncFormats(); });
	field.addEventListener('mouseup', syncFormats);
	field.addEventListener('click', (e) => {
		if (toggleTaskFromClick(e.target as HTMLElement)) syncSend();
	});
	field.addEventListener('keydown', (e) => {
		if ((e.ctrlKey || e.metaKey) && ['b', 'i'].includes(e.key.toLowerCase())) {
			e.preventDefault();
			applyCommentFormat(field, e.key.toLowerCase() === 'b' ? 'bold' : 'italic');
			syncFormats();
			return;
		}
		// Ctrl/Cmd+Enter always saves — the same key the live page's comment box uses,
		// and the only way out of a list, where plain Enter belongs to the list.
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void submit();
			return;
		}
		// Enter saves; Shift+Enter is a newline. Inside a list Enter belongs to the
		// list — that's what makes typing bullets natural.
		const inList = !!(window.getSelection()?.anchorNode as Element | null)?.parentElement?.closest('li');
		if (e.key === 'Enter' && !e.shiftKey && !inList) { e.preventDefault(); void submit(); }
		else if (e.key === 'Enter' && inList) {
			// Let the browser split the item, then put the checkbox and caret right.
			window.setTimeout(() => repairTaskList(field), 0);
		}
		else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); opts.onCancel?.(); }
	});
	send.addEventListener('click', () => void submit());

	wrap.append(field, bar);
	queueMicrotask(() => {
		syncSend();
		syncFormats();
		if (opts.autofocus) focusEditor(wrap);
	});
	return wrap;
}

/**
 * Put the caret in an editor without moving the page.
 *
 * Collapsing a selection into a contenteditable makes Chrome scroll the caret into
 * view, which yanked the stream around when a reply box opened. The scroll position
 * is restored afterwards, and only nudged back if the field really is out of sight.
 */
export function focusEditor(wrap: HTMLElement): void {
	const field = wrap.classList.contains('sc-editor__field')
		? wrap
		: wrap.querySelector<HTMLElement>('.sc-editor__field');
	if (!field || !field.isConnected) return;

	const host = document.getElementById('hl-stream');
	const before = host?.scrollTop ?? 0;

	field.focus({ preventScroll: true });
	const range = document.createRange();
	range.selectNodeContents(field);
	range.collapse(false);
	const selection = window.getSelection();
	selection?.removeAllRanges();
	selection?.addRange(range);

	if (!host || host.scrollTop === before) return;
	host.scrollTop = before;
	const box = field.getBoundingClientRect();
	const port = host.getBoundingClientRect();
	if (box.bottom > port.bottom - 12 || box.top < port.top + 12) {
		field.scrollIntoView({ block: 'nearest' });
	}
}
