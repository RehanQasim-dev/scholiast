// Storage contract for captured page sources — the full readable page as
// Markdown, so the Obsidian note can carry the page *content* (the immutable
// "source"), not just the annotations. The Obsidian plugin renders this body in
// reading view and re-anchors highlights against it.
//
// One key per page (`src:<normalizedUrl>`), for the same reason annotations are
// sharded (see page-store.ts): a source is the biggest record this extension
// stores — tens of KB of markdown — and chrome.storage.local rewrites a whole key
// on every `set`. Held in one map, capturing page N re-serialised the markdown of
// all N-1 pages before it, and reading one source deserialised the entire library.
//
// This module is deliberately lightweight (no Defuddle import) so the background
// sync can read sources without pulling the markdown pipeline into its bundle.
// The actual capture lives in `page-source-capture.ts` (content-side only).

import browser from './browser-polyfill';
import { normalizeUrl } from './url-utils';

export const PAGE_SOURCE_PREFIX = 'src:';

export interface PageSource {
	url: string;
	title: string;
	markdown: string;
	capturedAt: number;
}

export const pageSourceKey = (url: string) => PAGE_SOURCE_PREFIX + normalizeUrl(url);

/** The stored source for `url`, if any (read-only; safe in the background). */
export async function getPageSource(url: string): Promise<PageSource | undefined> {
	const key = pageSourceKey(url);
	const got = await browser.storage.local.get(key);
	return got[key] as PageSource | undefined;
}

/** Whether `url` already has a captured source, without reading its markdown. */
export async function hasPageSource(url: string): Promise<boolean> {
	return !!(await getPageSource(url))?.markdown;
}

export async function setPageSource(source: PageSource): Promise<void> {
	await browser.storage.local.set({ [pageSourceKey(source.url)]: source });
}

/** Remove the stored source for `url`. */
export async function deletePageSource(url: string): Promise<void> {
	await browser.storage.local.remove(pageSourceKey(url));
}
