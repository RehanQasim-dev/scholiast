import { escapeHtml } from './string-utils';

// The markdown subset a comment body can hold, in one place, so every surface that
// shows or edits a comment agrees on it: the on-page comment box, its WYSIWYG
// editor, and the annotations dashboard.
//
// Stored form is markdown text (that's what syncs to Drive and what the Obsidian
// plugin writes into notes):
//   **bold**            *italic*            [text](url)   bare urls   #tag
//   - item              bullet list
//   - [ ] item          task list (- [x] when done)
//   <!--image:ID-->     pasted image        <!--diagram:ID-->  drawn diagram
//
// Two HTML shapes are produced from it: a *display* shape (read-only, paragraphs
// wrapped in a caller-supplied class) and an *editable* shape for contenteditable.
// serializeCommentEditor turns the editable shape back into the stored markdown.

export interface CommentRenderOptions {
	/** Class for `#tag` pills. Omitted → tags render as plain text. */
	tagClass?: string;
	/** Class put on each paragraph block in display mode. */
	blockClass?: string;
	/** Extra classes for generated `<ul>`s (both bullet and task lists). */
	listClass?: string;
}

// Marks a `<ul>` whose items are checkboxes, and the per-item state. Kept as data
// attributes so the serializer can tell task lists from bullet lists without
// depending on any surface's styling.
export const TASK_LIST_CLASS = 'ob-md-tasks';
export const LIST_CLASS = 'ob-md-list';
export const CHECK_CLASS = 'ob-md-check';

const TAG_RE = /(^|\s)(#[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)/g;
const BULLET_RE = /^\s*[-*]\s+(?!\[[ xX]\]\s)(.*)$/;
const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/;

/**
 * Inline markdown → HTML. Input must already be HTML-escaped; the only live HTML
 * is what this emits. Links are restricted to http(s).
 */
export function renderInlineCommentMarkdown(escaped: string, opts: CommentRenderOptions = {}): string {
	// Markdown links are parked behind placeholders so the bare-url pass below
	// can't re-link the url inside them.
	const mdLinks: string[] = [];
	let html = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => {
		const placeholder = `__MDLINK_${mdLinks.length}__`;
		mdLinks.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`);
		return placeholder;
	});

	html = html.replace(/\bhttps?:\/\/[^\s<)]+/g, (match) => {
		let url = match;
		let suffix = '';
		const trailing = url.match(/[.,;:?!]+$/);
		if (trailing) {
			suffix = trailing[0];
			url = url.slice(0, -suffix.length);
		}
		return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${suffix}`;
	});

	mdLinks.forEach((linkHtml, i) => { html = html.replace(`__MDLINK_${i}__`, linkHtml); });

	html = html
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>');

	if (opts.tagClass) {
		html = html.replace(TAG_RE, `$1<span class="${opts.tagClass}">$2</span>`);
	}
	return html;
}

interface Line {
	kind: 'text' | 'bullet' | 'task';
	text: string;
	checked?: boolean;
}

function parseLines(text: string): Line[] {
	return text.split('\n').map((raw): Line => {
		const task = raw.match(TASK_RE);
		if (task) return { kind: 'task', text: task[2], checked: task[1].toLowerCase() === 'x' };
		const bullet = raw.match(BULLET_RE);
		if (bullet) return { kind: 'bullet', text: bullet[1] };
		return { kind: 'text', text: raw };
	});
}

function listOpenTag(kind: 'bullet' | 'task', opts: CommentRenderOptions): string {
	const classes = [LIST_CLASS, kind === 'task' ? TASK_LIST_CLASS : '', opts.listClass || '']
		.filter(Boolean).join(' ');
	return `<ul class="${classes}">`;
}

function itemHtml(line: Line, opts: CommentRenderOptions): string {
	const inner = renderInlineCommentMarkdown(escapeHtml(line.text), opts);
	if (line.kind !== 'task') return `<li>${inner}</li>`;
	// The box itself is drawn by CSS on the (uneditable) span, so it can be clicked
	// without the caret ever landing inside it.
	return `<li data-checked="${line.checked ? 'true' : 'false'}">`
		+ `<span class="${CHECK_CLASS}" contenteditable="false" aria-hidden="true"></span>${inner}</li>`;
}

/**
 * Read-only HTML for one chunk of comment text (no image markers — callers split
 * those out first, since each surface loads image bytes its own way). Consecutive
 * `- ` / `- [ ] ` lines collapse into one list; everything else becomes a block of
 * `<br>`-joined lines.
 */
export function commentTextToDisplayHtml(text: string, opts: CommentRenderOptions = {}): string {
	const lines = parseLines(text);
	let html = '';
	let listKind: 'bullet' | 'task' | null = null;
	let paragraph: string[] = [];

	const flushParagraph = () => {
		if (!paragraph.length) return;
		const body = paragraph.join('<br>');
		html += opts.blockClass ? `<div class="${opts.blockClass}">${body}</div>` : body;
		paragraph = [];
	};
	const closeList = () => {
		if (listKind) { html += '</ul>'; listKind = null; }
	};

	for (const line of lines) {
		if (line.kind === 'text') {
			// A blank line only separates blocks; it never renders as an empty row.
			closeList();
			if (line.text.trim() === '') { flushParagraph(); continue; }
			paragraph.push(renderInlineCommentMarkdown(escapeHtml(line.text), opts));
			continue;
		}
		flushParagraph();
		if (listKind !== line.kind) {
			closeList();
			html += listOpenTag(line.kind, opts);
			listKind = line.kind;
		}
		html += itemHtml(line, opts);
	}
	flushParagraph();
	closeList();
	return html;
}

/**
 * HTML for a contenteditable editor: same formatting as the display shape, but as
 * real inline/list elements the browser's own editing commands operate on, and with
 * plain lines joined by `<br>` rather than wrapped in block divs.
 */
export function commentTextToEditableHtml(text: string, opts: CommentRenderOptions = {}): string {
	const lines = parseLines(text);
	let html = '';
	let listKind: 'bullet' | 'task' | null = null;
	let needsBreak = false;

	const closeList = () => {
		if (listKind) { html += '</ul>'; listKind = null; needsBreak = false; }
	};

	for (const line of lines) {
		if (line.kind === 'text') {
			closeList();
			if (needsBreak) html += '<br>';
			html += renderInlineCommentMarkdown(escapeHtml(line.text), { ...opts, tagClass: undefined });
			needsBreak = true;
			continue;
		}
		if (listKind !== line.kind) {
			closeList();
			html += listOpenTag(line.kind, opts);
			listKind = line.kind;
		}
		html += itemHtml(line, { ...opts, tagClass: undefined });
	}
	closeList();
	return html;
}

/**
 * Editable DOM → stored markdown. `imageMarker` lets the caller turn its own image
 * elements back into the marker comment they came from.
 */
export function serializeCommentEditor(
	root: HTMLElement,
	imageMarker?: (img: HTMLElement) => string | null,
): string {
	let out = '';
	const newline = () => { if (out.length > 0 && !out.endsWith('\n')) out += '\n'; };

	const walkChildren = (node: Node) => {
		for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
	};

	// Inline emphasis: only wrap when there is actually text inside, so an empty
	// <b> left behind by the browser doesn't emit stray asterisks.
	const wrapped = (element: HTMLElement, marker: string) => {
		const before = out.length;
		walkChildren(element);
		const inner = out.slice(before);
		if (!inner.trim()) return;
		out = out.slice(0, before) + marker + inner + marker;
	};

	const walk = (node: Node) => {
		if (node.nodeType === Node.TEXT_NODE) {
			out += node.textContent;
			return;
		}
		if (node.nodeType !== Node.ELEMENT_NODE) return;
		const element = node as HTMLElement;

		switch (element.tagName) {
			case 'IMG': {
				const marker = imageMarker?.(element);
				if (marker) out += marker;
				return;
			}
			case 'A': {
				const href = element.getAttribute('href') || '';
				const text = element.textContent || '';
				out += href && href !== text ? `[${text}](${href})` : text;
				return;
			}
			case 'BR':
				out += '\n';
				return;
			case 'STRONG':
			case 'B':
				wrapped(element, '**');
				return;
			case 'EM':
			case 'I':
				wrapped(element, '*');
				return;
			case 'UL':
			case 'OL': {
				const tasks = element.classList.contains(TASK_LIST_CLASS);
				const ordered = element.tagName === 'OL';
				let n = 1;
				for (const child of Array.from(element.children)) {
					if (child.tagName !== 'LI') continue;
					newline();
					const li = child as HTMLElement;
					if (tasks || li.dataset.checked !== undefined) {
						out += `- [${li.dataset.checked === 'true' ? 'x' : ' '}] `;
					} else {
						out += ordered ? `${n++}. ` : '- ';
					}
					walkChildren(li);
					newline();
				}
				return;
			}
			case 'SPAN':
				// The checkbox glyph is drawn in CSS and carries no text of its own.
				if (element.classList.contains(CHECK_CLASS)) return;
				walkChildren(element);
				return;
			case 'DIV':
			case 'P':
				newline();
				walkChildren(element);
				newline();
				return;
			default:
				walkChildren(element);
		}
	};

	walkChildren(root);
	return out.replace(/\n+$/, '');
}

/** True when the caret sits inside a list item of `root`. */
function selectionListItem(root: HTMLElement): HTMLLIElement | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) return null;
	let node: Node | null = selection.getRangeAt(0).startContainer;
	while (node && node !== root) {
		if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'LI') {
			return node as HTMLLIElement;
		}
		node = node.parentNode;
	}
	return null;
}

export type CommentFormatCommand = 'bold' | 'italic' | 'bullet' | 'task';

/**
 * Apply a toolbar command to the focused contenteditable editor. Bold/italic and
 * list creation go through the browser's own editing commands so undo history and
 * caret behaviour stay native; task lists are a bullet list tagged afterwards.
 */
export function applyCommentFormat(editor: HTMLElement, command: CommentFormatCommand): void {
	editor.focus({ preventScroll: true });

	if (command === 'bold' || command === 'italic') {
		document.execCommand(command);
		editor.dispatchEvent(new Event('input', { bubbles: true }));
		return;
	}

	const wantTasks = command === 'task';
	const currentItem = selectionListItem(editor);
	const currentList = currentItem?.closest('ul, ol') as HTMLElement | null;
	const isTaskList = !!currentList?.classList.contains(TASK_LIST_CLASS);

	// Same kind again → toggle the list off. Different kind → convert in place.
	if (currentList && isTaskList === wantTasks) {
		document.execCommand('insertUnorderedList');
	} else if (currentList) {
		setListKind(currentList, wantTasks);
		if (currentItem) placeCaretInItem(currentItem);
	} else {
		// After insertUnorderedList, Chrome often reports the selection as the editor
		// root rather than the new item, so the list can't be found by selection
		// alone — hence the before/after diff.
		const before = new Set(Array.from(editor.querySelectorAll('ul')));
		document.execCommand('insertUnorderedList');
		const created = (selectionListItem(editor)?.closest('ul') as HTMLElement | null)
			?? Array.from(editor.querySelectorAll('ul')).find(ul => !before.has(ul))
			?? null;
		if (created) {
			setListKind(created, wantTasks);
			const item = selectionListItem(editor) ?? created.querySelector('li');
			if (item) placeCaretInItem(item as HTMLElement);
		}
	}

	editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Put the caret where typing should continue inside a list item: at the end of its
 * text, or — for a freshly made empty item — immediately *after* the checkbox.
 *
 * A checkbox is the item's first child, and the browser leaves the caret at the
 * item's start, so without this the caret is drawn on top of the box and typed
 * text lands in front of it.
 */
function placeCaretInItem(li: HTMLElement): void {
	const selection = window.getSelection();
	if (!selection) return;
	const box = li.querySelector(`:scope > .${CHECK_CLASS}`);
	const range = document.createRange();
	if ((li.textContent || '').trim().length > 0) {
		range.selectNodeContents(li);
		range.collapse(false);
	} else if (box) {
		range.setStartAfter(box);
		range.collapse(true);
	} else {
		range.setStart(li, 0);
		range.collapse(true);
	}
	selection.removeAllRanges();
	selection.addRange(range);
}

function setListKind(list: HTMLElement, tasks: boolean): void {
	list.classList.add(LIST_CLASS);
	list.classList.toggle(TASK_LIST_CLASS, tasks);
	for (const child of Array.from(list.children)) {
		if (child.tagName !== 'LI') continue;
		const li = child as HTMLElement;
		const box = li.querySelector(`:scope > .${CHECK_CLASS}`);
		if (tasks) {
			if (!li.dataset.checked) li.dataset.checked = 'false';
			if (!box) {
				const span = document.createElement('span');
				span.className = CHECK_CLASS;
				span.contentEditable = 'false';
				span.setAttribute('aria-hidden', 'true');
				li.insertBefore(span, li.firstChild);
			}
		} else {
			delete li.dataset.checked;
			box?.remove();
		}
	}
}

/**
 * Put a checklist back in order after the browser has edited it.
 *
 * Three things the browser gets wrong, in one pass, so both the live comment box
 * and the dashboard behave identically:
 *  1. Splitting an item with Enter clones its attributes but not its
 *     `contenteditable="false"` checkbox, leaving a boxless line.
 *  2. Because the box is the item's first child and the caret sits at the item's
 *     start, typed text can land *in front of* the box.
 *  3. The caret itself can end up before or inside the box, where it is drawn on
 *     top of it.
 *
 * Safe to call on input and right after an Enter (a macrotask later, once the
 * browser has finished its own edit).
 */
export function repairTaskList(editor: HTMLElement): void {
	const lists = editor.querySelectorAll<HTMLElement>(`ul.${TASK_LIST_CLASS}`);
	if (lists.length === 0) return;
	for (let i = 0; i < lists.length; i++) setListKind(lists[i], true);

	// Anything that ended up in front of a box belongs after it.
	for (const li of Array.from(editor.querySelectorAll('li'))) {
		const box = li.querySelector(`:scope > .${CHECK_CLASS}`);
		if (!box) continue;
		let node = li.firstChild;
		while (node && node !== box) {
			const next = node.nextSibling;
			if (box.nextSibling) li.insertBefore(node, box.nextSibling);
			else li.appendChild(node);
			node = next;
		}
		// The caret needs a text position to land in.
		if (!box.nextSibling) li.appendChild(document.createTextNode(''));
	}

	const li = selectionListItem(editor);
	if (!li) return;
	const box = li.querySelector(`:scope > .${CHECK_CLASS}`);
	if (!box) return;

	const selection = window.getSelection();
	const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
	if (!range || !editor.contains(range.startContainer)) return;

	const atOrBeforeBox = range.startContainer === box
		|| box.contains(range.startContainer)
		|| (range.startContainer === li
			&& range.startOffset <= Array.from(li.childNodes).indexOf(box));
	if (!atOrBeforeBox) return;

	// Just past the box, not at the end of the line: the caret was only in an
	// impossible spot, and the writer's place in the text shouldn't move.
	const target = document.createRange();
	const next = box.nextSibling;
	if (next && next.nodeType === Node.TEXT_NODE) target.setStart(next, 0);
	else if (next) target.setStartBefore(next);
	else target.setStartAfter(box);
	target.collapse(true);
	selection!.removeAllRanges();
	selection!.addRange(target);
}

/**
 * Click-to-tick for task items. Call from a click handler on an editor (or any
 * rendered comment); returns true when a checkbox was toggled.
 */
export function toggleTaskFromClick(target: HTMLElement): boolean {
	const box = target.closest(`.${CHECK_CLASS}`) as HTMLElement | null;
	if (!box) return false;
	const li = box.closest('li') as HTMLElement | null;
	if (!li) return false;
	li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
	return true;
}

/**
 * Flip the nth (0-based) task marker in stored markdown. Used when a checkbox is
 * ticked in a *rendered* comment, where there's no editor to serialize — the text
 * itself is edited and saved.
 */
export function toggleTaskInMarkdown(text: string, nth: number): string {
	let seen = 0;
	return text.replace(/^([ \t]*[-*][ \t]+\[)([ xX])(\])/gm, (match, prefix, state, suffix) =>
		seen++ === nth ? `${prefix}${state.toLowerCase() === 'x' ? ' ' : 'x'}${suffix}` : match);
}

/** Which formatting commands are active for the current selection. */
export function activeCommentFormats(editor: HTMLElement): Set<CommentFormatCommand> {
	const active = new Set<CommentFormatCommand>();
	try {
		if (document.queryCommandState('bold')) active.add('bold');
		if (document.queryCommandState('italic')) active.add('italic');
	} catch { /* not supported — leave both off */ }
	const list = selectionListItem(editor)?.closest('ul, ol') as HTMLElement | null;
	if (list) active.add(list.classList.contains(TASK_LIST_CLASS) ? 'task' : 'bullet');
	return active;
}
