import dayjs from 'dayjs';
import { StoredData, collapseGroupsForExport } from '../../utils/highlighter';
import { getPage, removePage, setPage } from '../../utils/page-store';
import { removeVideoItem, updateVideoItemNotes, upsertVideoItem, VideoAnnotationData, VideoItem } from '../../utils/video/video-storage';
import { formatVideoTime, makeVideoNote } from '../../utils/video/video-notes';
import { detectBrowser } from '../../utils/browser-detection';
import { announce, confirmDialog, copyText, el, toast } from './ui';
import { state } from './store';
import { commentBody, commentTimes, pageLabel, plural } from './format';
import { drawingOf, entryText, findPage, siteName, statsFor, videoOf, visiblePages } from './data';
import { DrawingStroke, HLColor, RenderUnit, VisiblePage } from './types';

/**
 * Every mutation the dashboard can make, plus export.
 *
 * Deletes are optimistic and undoable rather than gated behind a confirm dialog:
 * the whole page record is snapshotted first, so "Undo" in the toast restores
 * exactly what was there. Only library- and domain-wide deletes — the ones that
 * can't be meaningfully reviewed afterwards — still ask first.
 */

interface PageSnapshot {
	url: string;
	hl: StoredData | null;
	va: VideoAnnotationData | null;
	dr: { url: string; strokes: DrawingStroke[] } | null;
}

async function snapshot(url: string): Promise<PageSnapshot> {
	const [hl, va, dr] = await Promise.all([
		getPage<StoredData>('hl', url),
		getPage<VideoAnnotationData>('va', url),
		getPage<{ url: string; strokes: DrawingStroke[] }>('dr', url),
	]);
	return { url, hl, va, dr };
}

async function restore(snaps: PageSnapshot[]): Promise<void> {
	for (const snap of snaps) {
		if (snap.hl) await setPage('hl', snap.url, snap.hl); else await removePage('hl', snap.url);
		if (snap.va) await setPage('va', snap.url, snap.va); else await removePage('va', snap.url);
		if (snap.dr) await setPage('dr', snap.url, snap.dr); else await removePage('dr', snap.url);
	}
}

function offerUndo(message: string, snaps: PageSnapshot[]): void {
	announce(message);
	toast({
		message,
		actionLabel: 'Undo',
		onAction: () => { void restore(snaps).then(() => announce('Restored')); },
	});
}

// --- Highlight mutations --------------------------------------------------

async function removeHighlight(url: string, id: string): Promise<void> {
	const stored = await getPage<StoredData>('hl', url);
	if (!stored) return;
	stored.highlights = stored.highlights.filter(h => h.id !== id);
	if (stored.highlights.length === 0) await removePage('hl', url);
	else await setPage<StoredData>('hl', url, stored);
}

/** Delete one card: a highlight (or a whole group), a video item, or a drawing set. */
export async function deleteUnit(unit: RenderUnit): Promise<void> {
	const snap = await snapshot(unit.pageUrl);
	const first = unit.entries[0].data;
	if (drawingOf(first)) {
		await removePage('dr', unit.pageUrl);
		offerUndo('Drawing deleted', [snap]);
		return;
	}
	if (videoOf(first)) {
		await removeVideoItem(unit.pageUrl, first.id);
		offerUndo('Annotation deleted', [snap]);
		return;
	}
	for (const entry of unit.entries) await removeHighlight(unit.pageUrl, entry.data.id);
	offerUndo(unit.entries.length > 1 ? 'Annotation group deleted' : 'Annotation deleted', [snap]);
}

export async function deleteUnits(units: RenderUnit[]): Promise<void> {
	if (units.length === 0) return;
	const urls = [...new Set(units.map(u => u.pageUrl))];
	const snaps = await Promise.all(urls.map(snapshot));
	for (const unit of units) {
		const first = unit.entries[0].data;
		if (drawingOf(first)) await removePage('dr', unit.pageUrl);
		else if (videoOf(first)) await removeVideoItem(unit.pageUrl, first.id);
		else for (const entry of unit.entries) await removeHighlight(unit.pageUrl, entry.data.id);
	}
	offerUndo(`${plural(units.length, 'annotation')} deleted`, snaps);
}

/** Recolour a highlight, or a transcript video item, everywhere it appears. */
export async function setUnitColor(unit: RenderUnit, color: HLColor): Promise<void> {
	const video = videoOf(unit.entries[0].data);
	if (video) {
		await upsertVideoItem(unit.pageUrl, undefined, undefined, { ...video, color });
		return;
	}
	const stored = await getPage<StoredData>('hl', unit.pageUrl);
	if (!stored) return;
	const ids = new Set(unit.entries.map(e => e.data.id));
	for (const h of stored.highlights) {
		if (!ids.has(h.id)) continue;
		h.color = color;
		h.updatedAt = Date.now();
	}
	await setPage<StoredData>('hl', unit.pageUrl, stored);
}

// --- Comment mutations ----------------------------------------------------

export async function addComment(unit: RenderUnit, text: string): Promise<void> {
	const first = unit.entries[0].data;
	const video = videoOf(first);
	if (video) {
		await updateVideoItemNotes(unit.pageUrl, video.id, [...video.notes, makeVideoNote(text, Date.now())]);
		return;
	}
	const stored = await getPage<StoredData>('hl', unit.pageUrl);
	if (!stored) return;
	const h = stored.highlights.find(x => x.id === first.id);
	if (!h) return;
	h.notes = h.notes || [];
	h.notes.push(`${text}<!--timestamp:${Date.now()}-->`);
	h.updatedAt = Date.now();
	await setPage<StoredData>('hl', unit.pageUrl, stored);
	announce('Comment added');
}

export async function editComment(
	pageUrl: string, highlightId: string, index: number, text: string, video: VideoItem | null,
): Promise<void> {
	if (video) {
		const created = commentTimes(video.notes[index] || '').created || Date.now();
		const notes = video.notes.slice();
		notes[index] = `<!--timestamp:${created}--><!--edited:${Date.now()}-->\n\n${text}`;
		await updateVideoItemNotes(pageUrl, video.id, notes);
		return;
	}
	const stored = await getPage<StoredData>('hl', pageUrl);
	if (!stored) return;
	const h = stored.highlights.find(x => x.id === highlightId);
	if (!h?.notes?.[index]) return;
	const created = commentTimes(h.notes[index]).created || Date.now();
	h.notes[index] = `${text}<!--timestamp:${created}--><!--edited:${Date.now()}-->`;
	h.updatedAt = Date.now();
	await setPage<StoredData>('hl', pageUrl, stored);
}

export async function deleteComment(
	pageUrl: string, highlightId: string, index: number, video: VideoItem | null,
): Promise<void> {
	const snap = await snapshot(pageUrl);
	if (video) {
		const notes = video.notes.slice();
		notes.splice(index, 1);
		// A comment-only item with no comments left has nothing to show.
		if (notes.length === 0 && video.kind === 'note') await removeVideoItem(pageUrl, video.id);
		else await updateVideoItemNotes(pageUrl, video.id, notes);
	} else {
		const stored = await getPage<StoredData>('hl', pageUrl);
		if (!stored) return;
		const h = stored.highlights.find(x => x.id === highlightId);
		if (!h?.notes) return;
		h.notes.splice(index, 1);
		h.updatedAt = Date.now();
		await setPage<StoredData>('hl', pageUrl, stored);
	}
	offerUndo('Comment deleted', [snap]);
}

// --- Copy -----------------------------------------------------------------

function unitQuote(unit: RenderUnit): string {
	return unit.entries.map(e => entryText(e.data)).filter(Boolean).join('\n\n');
}

export function copyQuote(unit: RenderUnit): void {
	void copyText(unitQuote(unit), 'Quote');
}

/** One annotation as Obsidian-friendly markdown: blockquote plus its comments. */
export function unitMarkdown(unit: RenderUnit): string {
	const lines: string[] = [];
	const video = videoOf(unit.entries[0].data);
	const drawing = drawingOf(unit.entries[0].data);
	if (drawing) {
		lines.push(`- *Freehand drawing — ${plural(drawing.strokes.length, 'stroke')}*`);
	} else {
		const quote = unitQuote(unit);
		const stamp = video ? `[${formatVideoTime(video.videoTime)}] ` : '';
		if (quote) lines.push(quote.split('\n').map(l => `> ${stamp}${l}`).join('\n'));
		else if (video) lines.push(`> [${formatVideoTime(video.videoTime)}]`);
	}
	for (const entry of unit.entries) {
		for (const note of entry.data.notes ?? []) {
			const body = commentBody(note);
			if (!body) continue;
			const { created } = commentTimes(note);
			const indented = body.split('\n').map((l, i) => (i === 0 ? `- ${l}` : `  ${l}`)).join('\n');
			lines.push(created ? `${indented}\n  <!-- ${dayjs(created).format('YYYY-MM-DD HH:mm')} -->` : indented);
		}
	}
	return lines.join('\n\n');
}

export function copyUnitsMarkdown(units: RenderUnit[], what = 'Markdown'): void {
	void copyText(units.map(unitMarkdown).join('\n\n'), what);
}

// --- Export ---------------------------------------------------------------

function scopeLabel(): string {
	const nav = state.nav;
	if (nav.type === 'all') return 'all sources';
	if (nav.type === 'domain') return siteName(nav.domain);
	const page = findPage(nav.url);
	return pageLabel(page?.title, page?.path || '', nav.domain, siteName(nav.domain));
}

function scopeSlug(): string {
	return scopeLabel().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'annotations';
}

async function download(blob: Blob, fileName: string): Promise<void> {
	const blobUrl = URL.createObjectURL(blob);
	const browserType = await detectBrowser();
	if (browserType === 'safari' || browserType === 'mobile-safari') {
		if (navigator.share) {
			try {
				await navigator.share({
					files: [new File([blob], fileName, { type: blob.type })],
					title: 'Exported annotations',
				});
			} catch { window.open(blobUrl); }
		} else window.open(blobUrl);
	} else {
		const a = el('a');
		a.href = blobUrl;
		a.download = fileName;
		document.body.appendChild(a);
		a.click();
		a.remove();
	}
	URL.revokeObjectURL(blobUrl);
}

export async function exportJson(pages = visiblePages()): Promise<void> {
	if (pages.length === 0) return;
	const exportPages: Record<string, unknown> = {};
	for (const { page, units } of pages) {
		const highlights = collapseGroupsForExport(
			units.flatMap(u => u.entries).map(e => e.data).filter(d => !drawingOf(d) && !videoOf(d)));
		const drawings = units.map(u => drawingOf(u.entries[0].data)).find(Boolean)?.strokes;
		const videoItems = units.map(u => videoOf(u.entries[0].data)).filter(Boolean);
		exportPages[page.url] = {
			url: page.url,
			title: page.title,
			...(highlights.length ? { highlights } : {}),
			...(drawings?.length ? { drawings } : {}),
			...(videoItems.length ? { videoItems } : {}),
		};
	}
	const payload = {
		version: 2,
		app: 'Scholiast',
		scope: scopeLabel(),
		exportedAt: new Date().toISOString(),
		pages: exportPages,
	};
	await download(
		new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
		`scholiast-${scopeSlug()}-${dayjs().format('YYYYMMDDHHmm')}.json`,
	);
	announce('Exported JSON');
}

export async function exportMarkdown(pages = visiblePages()): Promise<void> {
	if (pages.length === 0) return;
	const stats = statsFor(pages);
	const out: string[] = [
		`# Annotations — ${scopeLabel()}`,
		`*${plural(stats.annotations, 'annotation')}, ${plural(stats.comments, 'comment')} · exported ${dayjs().format('D MMM YYYY, HH:mm')}*`,
	];
	for (const { page, units, domain } of pages) {
		if (units.length === 0) continue;
		const title = pageLabel(page.title, page.path, domain, siteName(domain));
		out.push(`## ${title}\n[${page.url}](${page.url})`);
		for (const unit of units) out.push(unitMarkdown(unit));
	}
	await download(
		new Blob([out.join('\n\n') + '\n'], { type: 'text/markdown' }),
		`scholiast-${scopeSlug()}-${dayjs().format('YYYYMMDDHHmm')}.md`,
	);
	announce('Exported Markdown');
}

// --- Scope delete ---------------------------------------------------------

/**
 * Delete everything currently in view, after a dialog that names the cost.
 *
 * It deletes the *units in view*, not the pages holding them: with a filter active
 * the two are different, and wiping whole pages would delete annotations the dialog
 * never counted. Pages left with nothing are dropped by the record-level deletes.
 */
export async function deleteScope(): Promise<void> {
	const pages = visiblePages();
	if (pages.length === 0) return;
	const units = unitsOfPages(pages);
	const stats = statsFor(pages);
	const nav = state.nav;
	const what = `${plural(stats.annotations + stats.videos, 'annotation')} across ${plural(pages.length, 'page')}`;

	const ok = await confirmDialog({
		title: nav.type === 'all' ? 'Delete your whole library?' : `Delete ${scopeLabel()}?`,
		body: `This removes ${what}${stats.comments ? `, including ${plural(stats.comments, 'comment')},` : ''} from this device.`,
		confirmLabel: 'Delete',
		danger: true,
		requireWord: nav.type === 'all' ? 'delete' : undefined,
	});
	if (!ok) return;

	await deleteUnits(units);
	if (nav.type === 'page') state.nav = { type: 'domain', domain: nav.domain };
	else if (nav.type === 'domain' && !state.groups.some(g => g.domain === nav.domain)) {
		state.nav = { type: 'all' };
	}
}

/** Delete one page's records, from a group header menu. */
export async function deletePage(url: string): Promise<void> {
	const snap = await snapshot(url);
	await removePage('hl', url);
	await removePage('va', url);
	await removePage('dr', url);
	offerUndo('Page annotations deleted', [snap]);
}

function unitsOfPages(pages: VisiblePage[]): RenderUnit[] {
	return pages.flatMap(p => p.units);
}

/** Units currently selected, in display order. */
export function selectedUnits(): RenderUnit[] {
	return unitsOfPages(visiblePages()).filter(u => state.selection.has(u.key));
}
