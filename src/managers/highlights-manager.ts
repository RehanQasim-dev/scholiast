import { detectBrowser } from '../utils/browser-detection';
import { AnyHighlightData, StoredData, collapseGroupsForExport } from '../utils/highlighter';
import { getAll, getPage, setPage } from '../utils/page-store';
import { VideoAnnotationData, VideoItem } from '../utils/video/video-storage';
import browser from '../utils/browser-polyfill';
import dayjs from 'dayjs';
import { getMessage } from '../utils/i18n';

export interface PencilStroke {
	id: string;
	color: string;
	width: number;
	points: number[];
	updatedAt?: number;
}

export interface ScholiastPageExport {
	url: string;
	title?: string;
	highlights?: AnyHighlightData[];
	drawings?: PencilStroke[];
	videoItems?: VideoItem[];
}

export interface ScholiastAnnotationExport {
	version: 2;
	app: 'Scholiast';
	exportedAt: string;
	pages: Record<string, ScholiastPageExport>;
	diagrams?: Record<string, any>;
	tagIndex?: string[];
}

export async function exportHighlights(): Promise<void> {
	try {
		const hlMap = await getAll<StoredData>('hl');
		const drMap = await getAll<{ url: string; strokes: PencilStroke[] }>('dr');
		const vaMap = await getAll<VideoAnnotationData>('va');
		const { diagrams, tag_index } = await browser.storage.local.get(['diagrams', 'tag_index']);

		const allUrls = Array.from(new Set([
			...Object.keys(hlMap),
			...Object.keys(drMap),
			...Object.keys(vaMap),
		]));

		const pages: Record<string, ScholiastPageExport> = {};

		for (const url of allUrls) {
			const hlData = hlMap[url];
			const drData = drMap[url];
			const vaData = vaMap[url];

			pages[url] = {
				url,
				title: hlData?.title || vaData?.title || undefined,
				...(hlData?.highlights?.length ? { highlights: collapseGroupsForExport(hlData.highlights) } : {}),
				...(drData?.strokes?.length ? { drawings: drData.strokes } : {}),
				...(vaData?.items?.length ? { videoItems: vaData.items } : {}),
			};
		}

		const exportPayload: ScholiastAnnotationExport = {
			version: 2,
			app: 'Scholiast',
			exportedAt: new Date().toISOString(),
			pages,
			...(diagrams && Object.keys(diagrams).length > 0 ? { diagrams } : {}),
			...(Array.isArray(tag_index) && tag_index.length > 0 ? { tagIndex: tag_index } : {}),
		};

		const jsonContent = JSON.stringify(exportPayload, null, 2);
		const blob = new Blob([jsonContent], { type: 'application/json' });
		const url = URL.createObjectURL(blob);

		const browserType = await detectBrowser();
		const timestamp = dayjs().format('YYYYMMDDHHmm');
		const fileName = `scholiast-annotations-backup-${timestamp}.json`;

		if (browserType === 'safari' || browserType === 'mobile-safari') {
			if (navigator.share) {
				try {
					await navigator.share({
						files: [new File([blob], fileName, { type: 'application/json' })],
						title: 'Exported Annotations Backup',
						text: 'Exported highlights, drawings, and notes from Scholiast.'
					});
				} catch {
					window.open(url);
				}
			} else {
				window.open(url);
			}
		} else {
			const a = document.createElement('a');
			a.href = url;
			a.download = fileName;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		}

		URL.revokeObjectURL(url);
	} catch (error) {
		console.error('Error exporting highlights:', error);
		alert(getMessage('failedToExportHighlights') || 'Failed to export annotations.');
	}
}

export async function importHighlights(fileInput?: HTMLInputElement): Promise<void> {
	const handleFile = async (file: File) => {
		try {
			const text = await file.text();
			const imported = JSON.parse(text);

			let pagesToImport: ScholiastPageExport[] = [];
			let diagramsToImport: Record<string, any> | undefined;
			let tagIndexToImport: string[] | undefined;

			if (imported && typeof imported === 'object' && imported.pages) {
				if (Array.isArray(imported.pages)) {
					pagesToImport = imported.pages;
				} else if (typeof imported.pages === 'object') {
					pagesToImport = Object.values(imported.pages);
				}
				diagramsToImport = imported.diagrams;
				tagIndexToImport = imported.tagIndex;
			} else if (Array.isArray(imported)) {
				pagesToImport = imported.map((item: any) => ({
					url: item.url,
					title: item.title,
					highlights: item.highlights,
					drawings: item.drawings,
					videoItems: item.videoItems || item.items,
				}));
			} else {
				throw new Error('Unrecognized annotation export format.');
			}

			if (pagesToImport.length === 0) {
				alert('No annotations found in the selected file.');
				return;
			}

			let updatedCount = 0;

			for (const page of pagesToImport) {
				if (!page.url) continue;

				if (page.highlights && page.highlights.length > 0) {
					const existing = (await getPage<StoredData>('hl', page.url)) || { url: page.url, highlights: [] };
					const existingIds = new Set(existing.highlights.map(h => h.id));
					const mergedHighlights = [...existing.highlights];
					for (const h of page.highlights) {
						if (!existingIds.has(h.id)) {
							mergedHighlights.push(h);
							existingIds.add(h.id);
						}
					}
					await setPage('hl', page.url, {
						url: page.url,
						title: page.title || existing.title || '',
						highlights: mergedHighlights,
					});
				}

				if (page.drawings && page.drawings.length > 0) {
					const existing = (await getPage<{ url: string; strokes: PencilStroke[] }>('dr', page.url)) || { url: page.url, strokes: [] };
					const existingIds = new Set(existing.strokes.map(s => s.id));
					const mergedStrokes = [...existing.strokes];
					for (const s of page.drawings) {
						if (!existingIds.has(s.id)) {
							mergedStrokes.push(s);
							existingIds.add(s.id);
						}
					}
					await setPage('dr', page.url, { url: page.url, strokes: mergedStrokes });
				}

				if (page.videoItems && page.videoItems.length > 0) {
					const existing = (await getPage<VideoAnnotationData>('va', page.url)) || { url: page.url, items: [] };
					const existingIds = new Set(existing.items.map(i => i.id));
					const mergedItems = [...existing.items];
					for (const item of page.videoItems) {
						if (!existingIds.has(item.id)) {
							mergedItems.push(item);
							existingIds.add(item.id);
						}
					}
					await setPage('va', page.url, {
						url: page.url,
						title: page.title || existing.title,
						items: mergedItems,
					});
				}

				updatedCount++;
			}

			if (diagramsToImport && typeof diagramsToImport === 'object') {
				const { diagrams: existingDiagrams } = await browser.storage.local.get('diagrams');
				const mergedDiagrams = { ...(existingDiagrams || {}), ...diagramsToImport };
				await browser.storage.local.set({ diagrams: mergedDiagrams });
			}

			if (tagIndexToImport && Array.isArray(tagIndexToImport)) {
				const { tag_index: existingTags } = await browser.storage.local.get('tag_index');
				const mergedTags = Array.from(new Set([...(existingTags || []), ...tagIndexToImport]));
				await browser.storage.local.set({ tag_index: mergedTags });
			}

			alert(`Successfully imported annotations for ${updatedCount} page${updatedCount === 1 ? '' : 's'}!`);
		} catch (error) {
			console.error('Error importing annotations:', error);
			alert('Failed to import annotations. Please check the file and try again.');
		}
	};

	const input = fileInput || document.createElement('input');
	input.type = 'file';
	input.accept = '.json';
	input.onchange = (e: Event) => {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) handleFile(file);
	};
	input.click();
}
