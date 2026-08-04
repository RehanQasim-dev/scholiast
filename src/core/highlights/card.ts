import DOMPurify from 'dompurify';
import { AnyHighlightData } from '../../utils/highlighter';
import { formatVideoTime } from '../../utils/video/video-notes';
import { loadFrameImage } from '../../utils/video/frame-store';
import { renderMarkupSvg } from '../../utils/video/video-markup';
import { VideoItem } from '../../utils/video/video-storage';
import { button, el, icon, markMatches, menuButton, MenuItem, tip } from './ui';
import { formatStamp, fullStamp, plural } from './format';
import { renderStream, state } from './store';
import {
	colorOf, commentCount, drawingOf, unitStamp, videoOf,
} from './data';
import {
	copyQuote, copyUnitsMarkdown, deleteUnit, setUnitColor,
} from './actions';
import { createCommentRow, createReplyRow } from './comment';
import { DrawingSet, HLColor, RenderUnit } from './types';

/**
 * One annotation card: the quote (or frame, transcript, drawing), its own metadata,
 * and its comment thread.
 *
 * There is no box around it. A full-height rail in the highlight's own colour marks
 * where the annotation starts and ends, which leaves the text as the only thing with
 * visual weight and lets cards sit directly on the page background.
 */

const COLOR_NAMES: Record<HLColor, string> = { yellow: 'Yellow', red: 'Red', green: 'Green' };
const COLOR_VALUES: Record<HLColor, string> = {
	yellow: 'var(--sc-hl-yellow)', red: 'var(--sc-hl-red)', green: 'var(--sc-hl-green)',
};

/**
 * Highlight content is page HTML. Only inline formatting is meaningful here, so
 * everything structural — and every `style`/`class` hook that would let the source
 * page's CSS bleed in — is dropped.
 */
const QUOTE_CONFIG: DOMPurify.Config = {
	ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 's', 'code', 'sub', 'sup', 'mark', 'a', 'br', 'span', 'img'],
	ALLOWED_ATTR: ['href', 'src', 'alt'],
	RETURN_DOM_FRAGMENT: true,
};

function renderQuoteContent(html: string, pageUrl: string): DocumentFragment {
	const frag = DOMPurify.sanitize(html || '', QUOTE_CONFIG) as unknown as DocumentFragment;
	const holder = el('div');
	holder.appendChild(frag);

	for (const a of Array.from(holder.querySelectorAll('a'))) {
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
	}
	for (const img of Array.from(holder.querySelectorAll('img'))) {
		// Page images are usually referenced relatively, which resolves against the
		// extension origin here and always breaks. Re-base them on the source page,
		// and fall back to a labelled chip rather than a broken-image glyph.
		const raw = img.getAttribute('src') || '';
		let resolved = '';
		try { resolved = new URL(raw, pageUrl).href; } catch { /* unresolvable */ }
		const alt = img.getAttribute('alt') || 'image';
		const chip = () => {
			const box = el('span', 'sc-quote__image-chip');
			box.appendChild(icon('image'));
			box.appendChild(el('span', '', alt));
			img.replaceWith(box);
		};
		if (!resolved || resolved.startsWith('chrome-extension:') || resolved.startsWith('moz-extension:')) {
			chip();
			continue;
		}
		img.setAttribute('src', resolved);
		img.className = 'sc-quote__image';
		img.loading = 'lazy';
		img.referrerPolicy = 'no-referrer';
		img.addEventListener('error', chip, { once: true });
	}

	const out = document.createDocumentFragment();
	out.append(...Array.from(holder.childNodes));
	return out;
}

function quoteBlock(entry: { data: AnyHighlightData }, pageUrl: string): HTMLElement {
	const block = el('blockquote', 'sc-quote__text');
	block.appendChild(renderQuoteContent(entry.data.content || '', pageUrl));
	if (state.filters.query) markMatches(block, state.filters.query);
	return block;
}

// --- Video media ----------------------------------------------------------

function videoTimeChip(atUrl: string, label: string, overlay = false): HTMLAnchorElement {
	const a = el('a', `sc-timechip${overlay ? ' sc-timechip--overlay' : ''}`);
	a.href = atUrl;
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	tip(a, 'Open the video at this moment');
	a.appendChild(icon('play_arrow'));
	a.appendChild(el('span', '', label));
	return a;
}

function videoMedia(item: VideoItem, pageUrl: string): HTMLElement {
	const atUrl = `${pageUrl}${pageUrl.includes('?') ? '&' : '?'}t=${Math.floor(item.videoTime)}s`;
	const stamp = formatVideoTime(item.videoTime);

	if (item.kind === 'frame' && item.frame) {
		const fig = el('figure', 'sc-frame');
		const img = el('img', 'sc-frame__img');
		img.loading = 'lazy';
		img.alt = `Video frame at ${stamp}`;
		if (item.frame.dataUrl) img.src = item.frame.dataUrl;
		else void loadFrameImage(item.id).then(u => { if (u) img.src = u; });
		fig.appendChild(img);
		if (item.markup) {
			const overlay = el('div', 'sc-frame__markup');
			const svg = renderMarkupSvg(item.markup, item.frame.w, item.frame.h);
			svg.setAttribute('style', 'width:100%;height:100%;display:block;');
			overlay.appendChild(svg);
			fig.appendChild(overlay);
		}
		fig.appendChild(videoTimeChip(atUrl, stamp, true));
		return fig;
	}

	if (item.kind === 'transcript' && item.quote) {
		const wrap = el('div', 'sc-quote');
		const block = el('blockquote', 'sc-quote__text', item.quote);
		wrap.appendChild(block);
		const range = item.timeEnd != null ? `${stamp}–${formatVideoTime(item.timeEnd)}` : stamp;
		wrap.appendChild(videoTimeChip(atUrl, range));
		return wrap;
	}

	const wrap = el('div', 'sc-quote');
	wrap.appendChild(videoTimeChip(atUrl, stamp));
	return wrap;
}

// --- Freehand drawings ----------------------------------------------------

/**
 * Strokes are stored in document coordinates, so a thumbnail can be drawn from
 * their bounding box alone — no access to the page they were drawn on.
 */
function drawingThumb(drawing: DrawingSet): HTMLElement {
	const hexes: Record<string, string> = {
		yellow: 'var(--sc-hl-yellow)', red: 'var(--sc-hl-red)', green: 'var(--sc-hl-green)',
	};
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const s of drawing.strokes) {
		for (let i = 0; i < s.points.length; i += 2) {
			minX = Math.min(minX, s.points[i]);
			maxX = Math.max(maxX, s.points[i]);
			minY = Math.min(minY, s.points[i + 1]);
			maxY = Math.max(maxY, s.points[i + 1]);
		}
	}
	const wrap = el('div', 'sc-drawing');
	if (!Number.isFinite(minX)) return wrap;

	const pad = 16;
	const w = Math.max(1, maxX - minX) + pad * 2;
	const h = Math.max(1, maxY - minY) + pad * 2;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${w} ${h}`);
	svg.setAttribute('class', 'sc-drawing__svg');
	// Cap the aspect so a page-long scribble doesn't become a hairline strip.
	svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
	svg.style.aspectRatio = `${w} / ${Math.min(h, w * 1.1)}`;
	for (const s of drawing.strokes) {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
		const pts: string[] = [];
		for (let i = 0; i < s.points.length; i += 2) pts.push(`${s.points[i]},${s.points[i + 1]}`);
		path.setAttribute('points', pts.join(' '));
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke', hexes[s.color] || 'var(--sc-hl-yellow)');
		path.setAttribute('stroke-width', '2');
		path.setAttribute('stroke-linecap', 'round');
		path.setAttribute('stroke-linejoin', 'round');
		path.setAttribute('vector-effect', 'non-scaling-stroke');
		svg.appendChild(path);
	}
	wrap.appendChild(svg);
	return wrap;
}

/**
 * Where a card's "open" action goes: the page, deep-linked to this annotation via
 * `#sc-hl=<id>` so the content script scrolls to it and flashes it. Video items
 * and drawings have no page highlight to reveal — video cards carry their own
 * `?t=` chip — so those just open the page.
 */
export function sourceUrl(unit: RenderUnit): string {
	const first = unit.entries[0].data;
	const base = unit.pageUrl.split('#')[0];
	if (videoOf(first) || drawingOf(first)) return unit.pageUrl;
	return `${base}#sc-hl=${encodeURIComponent(first.id)}`;
}

// --- The card -------------------------------------------------------------

export interface CardDeps {
	/** Called when the card's selection state should be recomputed by the stream. */
	onSelectionChange: (unitKey: string, additive: boolean) => void;
}

export function createCard(unit: RenderUnit, deps: CardDeps): HTMLElement {
	const first = unit.entries[0].data;
	const video = videoOf(first);
	const drawing = drawingOf(first);
	const color = colorOf(first);
	const stamp = unitStamp(unit);
	const comments = commentCount(unit);
	const selected = state.selection.has(unit.key);

	const card = el('article', 'sc-ann');
	card.dataset.unit = unit.key;
	card.dataset.color = drawing ? 'none' : color;
	card.tabIndex = -1;
	if (drawing) card.classList.add('sc-ann--drawing');
	if (selected) card.classList.add('is-selected');
	if (state.cursor === unit.key) card.classList.add('is-cursor');

	const main = el('div', 'sc-ann__main');

	// Media / quote
	if (drawing) {
		main.appendChild(drawingThumb(drawing));
	} else if (video) {
		main.appendChild(videoMedia(video, unit.pageUrl));
	} else {
		const quote = el('div', 'sc-quote');
		unit.entries.forEach((entry, i) => {
			if (i > 0) quote.appendChild(el('div', 'sc-quote__gap'));
			quote.appendChild(quoteBlock(entry, unit.pageUrl));
		});
		main.appendChild(quote);

		// Long grabs are clamped; the toggle only appears if there is more to see.
		const expanded = state.expandedQuotes.has(unit.key);
		if (!expanded) quote.classList.add('is-clamped');
		const more = el('button', 'sc-quote__more');
		more.type = 'button';
		more.textContent = expanded ? 'Show less' : 'Show more';
		more.addEventListener('click', () => {
			if (state.expandedQuotes.has(unit.key)) state.expandedQuotes.delete(unit.key);
			else state.expandedQuotes.add(unit.key);
			renderStream();
		});
		main.appendChild(more);
	}

	// Meta line: the card's control strip — selection, when, colour, comment count,
	// then the actions. Everything about the annotation, aligned with its text.
	const meta = el('div', 'sc-ann__meta');

	const check = el('button', 'sc-ann__check');
	check.type = 'button';
	check.setAttribute('role', 'checkbox');
	check.setAttribute('aria-checked', String(selected));
	tip(check, selected ? 'Deselect — Shift for a range' : 'Select — Shift for a range');
	check.appendChild(icon('check'));
	check.addEventListener('click', (e) => {
		e.stopPropagation();
		deps.onSelectionChange(unit.key, e.shiftKey);
	});
	meta.appendChild(check);

	if (stamp) {
		const when = el('time', 'sc-stamp', formatStamp(stamp));
		tip(when, fullStamp(stamp));
		meta.appendChild(when);
	}
	if (!drawing) {
		const swatch = el('span', 'sc-ann__swatch');
		swatch.style.setProperty('--sw', COLOR_VALUES[color]);
		tip(swatch, `${COLOR_NAMES[color]} highlight`);
		meta.appendChild(swatch);
	}
	if (drawing) {
		meta.append(el('span', 'sc-dot', '·'), el('span', 'sc-stamp', plural(drawing.strokes.length, 'stroke')));
	}
	if (comments > 0) {
		meta.append(el('span', 'sc-dot', '·'), el('span', 'sc-stamp', plural(comments, 'comment')));
	}
	if (unit.entries.length > 1) {
		meta.append(el('span', 'sc-dot', '·'), el('span', 'sc-stamp', `${unit.entries.length} parts`));
	}

	const actions = el('div', 'sc-ann__actions');
	const open = el('a', 'sc-btn sc-btn--ghost sc-btn--icon');
	// Deep link: the content script reads `#sc-hl=<id>`, scrolls to that highlight
	// and flashes it. Drawings have nothing to scroll to, so they just open the page.
	open.href = sourceUrl(unit);
	open.target = '_blank';
	open.rel = 'noopener noreferrer';
	tip(open, drawing || video ? 'Open the source page' : 'Open the page at this annotation');
	open.appendChild(icon('open_in_new'));
	actions.appendChild(open);
	if (!drawing) {
		actions.appendChild(button({
			iconName: 'content_copy', tooltip: 'Copy quote', onClick: () => copyQuote(unit),
		}));
	}
	actions.appendChild(menuButton(
		button({ iconName: 'more_horiz', tooltip: 'Annotation actions' }),
		() => cardMenu(unit, drawing, video, color),
	));
	meta.appendChild(actions);
	main.appendChild(meta);

	// Thread
	if (!drawing) {
		const thread = el('div', 'sc-thread');
		let rendered = 0;
		for (const entry of unit.entries) {
			const entryVideo = videoOf(entry.data);
			(entry.data.notes ?? []).forEach((note, noteIndex) => {
				const row = createCommentRow({
					unit, highlightId: entry.data.id, noteIndex, note, video: entryVideo,
				});
				if (row) { thread.appendChild(row); rendered++; }
			});
		}
		// While a comment in this card is being edited, the reply box would compete
		// for attention (and for Enter).
		const editingHere = state.editingComment?.startsWith(`${unit.pageUrl}::`)
			&& unit.entries.some(e => state.editingComment!.startsWith(`${unit.pageUrl}::${e.data.id}::`));
		if (!editingHere) thread.appendChild(createReplyRow(unit, rendered > 0));
		main.appendChild(thread);
	}

	card.appendChild(main);
	return card;
}

function cardMenu(
	unit: RenderUnit, drawing: DrawingSet | null, video: VideoItem | null, color: HLColor,
): MenuItem[] {
	const items: MenuItem[] = [];
	if (!drawing) {
		items.push(
			{ type: 'item', label: 'Copy quote', iconName: 'content_copy', onSelect: () => copyQuote(unit) },
			{
				type: 'item', label: 'Copy as Markdown', iconName: 'description',
				onSelect: () => copyUnitsMarkdown([unit], 'Markdown'),
			},
		);
		const recolourable = !video || video.kind === 'transcript';
		if (recolourable) {
			items.push({ type: 'sep' }, {
				type: 'swatches', label: 'Colour',
				options: (['yellow', 'green', 'red'] as HLColor[]).map(c => ({
					value: c, name: COLOR_NAMES[c], active: c === color,
				})),
				onSelect: (value) => { void setUnitColor(unit, value as HLColor); },
			});
		}
	}
	items.push({ type: 'sep' }, {
		type: 'item',
		label: drawing ? 'Delete drawing' : unit.entries.length > 1 ? 'Delete all parts' : 'Delete annotation',
		iconName: 'delete', danger: true,
		onSelect: () => { void deleteUnit(unit); },
	});
	return items;
}
