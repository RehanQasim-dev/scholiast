import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import {
	commentTextToDisplayHtml, commentTextToEditableHtml, serializeCommentEditor,
} from './comment-markdown';

// The module reads Node/Element constants off `globalThis` when walking the DOM, so
// the tests run against linkedom (already a dependency) rather than pulling in jsdom.
const { document, Node } = parseHTML('<html><body></body></html>');
(globalThis as any).Node = Node;

function editorWith(html: string): HTMLElement {
	const div = document.createElement('div');
	div.innerHTML = html;
	return div as unknown as HTMLElement;
}

/** markdown → editable HTML → markdown must be the identity. */
function roundTrip(markdown: string): string {
	return serializeCommentEditor(editorWith(commentTextToEditableHtml(markdown)));
}

describe('comment markdown', () => {
	it('renders inline emphasis and links for display', () => {
		const html = commentTextToDisplayHtml('a **bold** and *soft* [link](https://x.dev)');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>soft</em>');
		expect(html).toContain('<a href="https://x.dev"');
	});

	it('renders bold in the editable shape rather than leaving asterisks', () => {
		const html = commentTextToEditableHtml('**done**');
		expect(html).toBe('<strong>done</strong>');
		expect(html).not.toContain('**');
	});

	it('groups consecutive bullet lines into one list', () => {
		const html = commentTextToDisplayHtml('- one\n- two');
		expect(html.match(/<ul/g)).toHaveLength(1);
		expect(html.match(/<li/g)).toHaveLength(2);
	});

	it('renders task items with their checked state', () => {
		const html = commentTextToDisplayHtml('- [ ] open\n- [x] done');
		expect(html).toContain('ob-md-tasks');
		expect(html).toContain('data-checked="false"');
		expect(html).toContain('data-checked="true"');
	});

	it('keeps bullet and task lists separate', () => {
		const html = commentTextToDisplayHtml('- plain\n- [ ] task');
		expect(html.match(/<ul/g)).toHaveLength(2);
	});

	it('escapes html in comment text', () => {
		expect(commentTextToDisplayHtml('<img src=x onerror=1>')).not.toContain('<img');
	});

	it('round-trips emphasis, lists and tasks', () => {
		for (const markdown of [
			'plain text',
			'**bold** then *italic*',
			'- one\n- two',
			'- [ ] open\n- [x] done',
			'intro\n- a\n- b',
			'[label](https://example.com/x)',
			'#tag stays text',
		]) {
			expect(roundTrip(markdown)).toBe(markdown);
		}
	});

	it('serializes browser-style <b>/<i> and nested markup', () => {
		expect(serializeCommentEditor(editorWith('<b>x</b> <i>y</i>'))).toBe('**x** *y*');
	});

	it('drops emphasis tags the browser left empty', () => {
		expect(serializeCommentEditor(editorWith('hi<b></b>'))).toBe('hi');
	});

	it('serializes an image element through the caller hook', () => {
		const out = serializeCommentEditor(
			editorWith('<img data-image-id="img_1">after'),
			(img) => `<!--image:${img.dataset.imageId}-->`,
		);
		expect(out).toBe('<!--image:img_1-->after');
	});

	it('turns editor line divs into newlines', () => {
		expect(serializeCommentEditor(editorWith('<div>one</div><div>two</div>'))).toBe('one\ntwo');
	});
});

describe('toggleTaskInMarkdown', () => {
	it('flips only the nth task marker', async () => {
		const { toggleTaskInMarkdown } = await import('./comment-markdown');
		const md = '- [ ] a\n- [ ] b\n- [x] c';
		expect(toggleTaskInMarkdown(md, 1)).toBe('- [ ] a\n- [x] b\n- [x] c');
		expect(toggleTaskInMarkdown(md, 2)).toBe('- [ ] a\n- [ ] b\n- [ ] c');
		expect(toggleTaskInMarkdown(md, 9)).toBe(md);
	});
});
