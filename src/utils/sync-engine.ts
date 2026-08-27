import browser from './browser-polyfill';
import {
	isConfigured,
	isConnected,
	listFolder,
	findInFolder,
	createTextFile,
	updateTextFile,
	downloadDriveFile,
	uploadBlob,
	updateBlob,
	downloadBlob,
	deleteDriveFile,
	type DriveFileMeta,
} from './google-drive';
import {
	loadFrameImage, saveFrameImage, hasFrameImage,
	loadDiagramImage, saveDiagramImage, hasDiagramImage, deleteDiagramImage,
} from './video/frame-store';
import { getPage, setPage, removePage, getAll, listAllPageUrls } from './page-store';
// The 3-way merge logic is shared verbatim with the Obsidian plugin. The per-page
// reconcile uses `mergePageRecord` (one page at a time); types come from shared.
import {
	mergePageRecord,
	mergePageRecordMulti,
	emptyPageRecord,
	pageFileName,
	type PageRecord,
	type PageDiagram,
} from '../../shared/merge';
import * as github from './github';

// Three-way sync of annotation data to a single JSON file in Google Drive's
// appDataFolder. Runs in the background service worker.
//
// Data synced (all keyed by normalized URL, mirroring chrome.storage.local):
//   - `highlights`: Record<url, { url, title?, highlights: Highlight[] }>
//                   (comments live inline in each highlight's notes[])
//   - `drawings`:   Record<url, { url, strokes: Stroke[] }>
//
// Reconciliation is a 3-way merge between:
//   base   = `sync_snapshot` (the state we last reconciled, in storage.local)
//   local  = current storage.local
//   remote = the Drive file
// Deletions are detected against `base` and recorded as tombstones in the Drive
// file so a delete on one device isn't resurrected by another. Conflicts on the
// same entity are resolved by most-recent edit (updatedAt for highlights/strokes,
// edited|timestamp for comments).

const STATUS_KEY = 'sync_status';
const DIAGRAMS_KEY = 'diagrams';

// Per-page sync bookkeeping in storage.local:
//   snap:<url>     — the last-reconciled PageRecord (3-way merge base)
//   pagemeta:<url> — { fileId, headRevisionId } of the page's Drive file (CAS + change detect)
//   pagemeta:github:<url> — same for GitHub (sha)
const snapKey = (url: string) => `snap:${url}`;
const pageMetaKey = (url: string) => `pagemeta:${url}`;
const githubPageMetaKey = (url: string) => `pagemeta:github:${url}`;

interface PageMeta { fileId: string; headRevisionId?: string }

// --- Local storage shapes (per-page; structurally compatible) ----------------

interface StoredHighlights { url: string; title?: string; highlights: { id: string; notes?: string[]; updatedAt?: number; imageEdit?: { diagramId?: string }; [k: string]: unknown }[] }
interface StoredDrawings { url: string; strokes: { id: string; updatedAt?: number; [k: string]: unknown }[] }
interface VideoFrame { dataUrl?: string; driveId?: string; githubId?: string; [k: string]: unknown }
interface VideoItem { id: string; notes?: string[]; updatedAt?: number; frame?: VideoFrame; [k: string]: unknown }
interface StoredVideo { url: string; videoId?: string; title?: string; items: VideoItem[] }
// `pasted: true` marks an entry created for a pasted image: no editable scene, and
// its PNG bytes never change after creation.
interface DiagramEntry {
	sceneData?: unknown; updatedAt?: number; driveId?: string; sceneDriveId?: string; githubId?: string; sceneGithubId?: string; pasted?: boolean;
	// Normalized url of the page whose comment references this image. Lets a change
	// be routed to its page without scanning every annotation record.
	pageUrl?: string;
}
type DiagramsMap = Record<string, DiagramEntry>;

export interface SyncStatus {
	connected: boolean;
	lastSyncedAt?: number;
	lastError?: string;
	syncing?: boolean;
	// Live progress of the run in flight, for the settings UI. `total` is the number
	// of pages this run will reconcile (0 while still discovering them), `done` how
	// many have finished, and title/url identify the page being worked on right now.
	progress?: SyncProgress;
}

export interface SyncProgress {
	phase: 'discovering' | 'page';
	done: number;
	total: number;
	title?: string;
	url?: string;
}

// --- Page <-> local storage assembly -----------------------------------------

// Page record filename comes from shared/ so the extension + plugin agree on it.
const frameFileName = (id: string) => `frame-${id}.jpg`;
const diagramFileName = (id: string) => `diagram-${id}.png`;

// Image ids referenced by a page's highlight comments. Two kinds share the same
// blob store (and therefore the same Drive sync path): a drawn diagram
// (`<!--diagram:id-->`, one per comment) and pasted images (`<!--image:id-->`,
// any number inside a comment's text).
const IMAGE_REF_RE = /<!--(?:diagram|image):([A-Za-z0-9_-]+)-->/g;
function collectDiagramIds(highlights: StoredHighlights['highlights']): string[] {
	const ids = new Set<string>();
	for (const h of highlights || []) {
		for (const note of h.notes || []) {
			for (const m of note.matchAll(IMAGE_REF_RE)) ids.add(m[1]);
		}
		// An Excalidraw-edited page image is referenced by the highlight itself, not
		// by a comment — it syncs like any other diagram.
		if (h.imageEdit?.diagramId) ids.add(h.imageEdit.diagramId);
	}
	return [...ids];
}

// Build the canonical PageRecord for `url` from the sharded local stores. Frame
// image bytes are stripped (only `frame.driveId` is kept); diagram records carry
// `sceneData` + id (+ driveId) but never the PNG.
async function assembleLocalPage(url: string, diagrams: DiagramsMap): Promise<PageRecord> {
	const rec = emptyPageRecord(url);
	const hl = await getPage<StoredHighlights>('hl', url);
	const dr = await getPage<StoredDrawings>('dr', url);
	const va = await getPage<StoredVideo>('va', url);
	if (hl) { rec.highlights = hl.highlights || []; if (hl.title) rec.title = hl.title; }
	if (dr) rec.drawings = dr.strokes || [];
	if (va) {
		rec.videoItems = (va.items || []).map((it) => {
			if (!it.frame) return it;
			const { dataUrl, ...frameRest } = it.frame;
			return { ...it, frame: frameRest };
		});
		if (va.videoId) rec.videoId = va.videoId;
		if (!rec.title && va.title) rec.title = va.title;
	}
	// Pointers only — the scene + PNG bytes travel as separate Drive files/blobs.
	// An id referenced by a comment but absent from the map is still a real image on
	// this device (e.g. pasted before entries were recorded) — emit a bare pointer so
	// its bytes get uploaded; `pullImages` writes the resulting entry back.
	rec.diagrams = collectDiagramIds(rec.highlights)
		.map((id): PageDiagram => {
			const d = diagrams[id];
			if (!d) return { id };
			return {
				id,
				updatedAt: d.updatedAt,
				...(d.driveId ? { driveId: d.driveId } : {}),
				...(d.sceneDriveId ? { sceneDriveId: d.sceneDriveId } : {}),
			};
		});
	return rec;
}

// --- Status helpers ----------------------------------------------------------

async function setStatus(patch: Partial<SyncStatus>): Promise<void> {
	const cur = ((await browser.storage.local.get(STATUS_KEY))[STATUS_KEY] as SyncStatus) || {
		connected: false,
	};
	await browser.storage.local.set({ [STATUS_KEY]: { ...cur, ...patch } });
}

// Best-effort human label for a page being synced. The title is whatever the
// highlight/video store recorded when the page was annotated; the UI falls back to
// the url when there is none.
async function pageLabel(url: string): Promise<string | undefined> {
	const hl = await getPage<StoredHighlights>('hl', url);
	if (hl?.title) return hl.title;
	const va = await getPage<StoredVideo>('va', url);
	return va?.title;
}

// Progress is a UI nicety, so it must not turn a big reconcile into a storage
// write per page: updates are rate-limited, and the first/last of a run always
// land (`force`) so the panel opens and closes cleanly.
const PROGRESS_MIN_INTERVAL_MS = 400;
let lastProgressAt = 0;
async function reportProgress(progress: SyncProgress, force = false): Promise<void> {
	const now = Date.now();
	if (!force && now - lastProgressAt < PROGRESS_MIN_INTERVAL_MS) return;
	lastProgressAt = now;
	await setStatus({ progress });
}

export async function getStatus(): Promise<SyncStatus> {
	const stored = (await browser.storage.local.get(STATUS_KEY))[STATUS_KEY] as SyncStatus | undefined;
	const driveConnected = await isConnected().catch(()=>false);
	const ghConnected = await github.isConnected().catch(()=>false);
	return { connected: driveConnected || ghConnected, ...(stored || {}) };
}

export async function getStatusDetailed(): Promise<{ drive: SyncStatus; github: SyncStatus }> {
	const stored = (await browser.storage.local.get(STATUS_KEY))[STATUS_KEY] as SyncStatus | undefined;
	const ghStored = (await browser.storage.local.get('github_sync_status'))['github_sync_status'] as SyncStatus | undefined;
	const driveConnected = await isConnected().catch(()=>false);
	const ghConnected = await github.isConnected().catch(()=>false);
	return {
		drive: { connected: driveConnected, ...(stored || {}) },
		github: { connected: ghConnected, ...(ghStored || {}) },
	};
}

// --- Diagrams map + image blob helpers ---------------------------------------

async function loadDiagrams(): Promise<DiagramsMap> {
	return ((await browser.storage.local.get(DIAGRAMS_KEY))[DIAGRAMS_KEY] as DiagramsMap) || {};
}

const b64 = (dataUrl: string) => dataUrl.split(',')[1] || '';

// Push this page's local image bytes to Drive (+ GitHub if connected), stamping the
// resulting blob ids into the in-memory record so the merged record (and thus the
// uploaded page JSON + local snapshot) carries the pointers. No image bytes ever enter the JSON.
async function pushImages(local: PageRecord, base: PageRecord | null, diagrams: DiagramsMap, interactive: boolean): Promise<void> {
	const driveOn = isConfigured() && await isConnected().catch(() => false);
	const ghOn = github.isConfigured() && await github.isConnected().catch(() => false);
	// Frames are immutable once captured: upload only if it has no blob yet.
	for (const it of local.videoItems) {
		const f: any = it.frame;
		if (!f) continue;
		const dataUrl = await loadFrameImage(it.id);
		if (!dataUrl) continue; // image not on this device
		if (driveOn && !f.driveId) {
			try {
				const meta = await uploadBlob('frames', frameFileName(it.id), b64(dataUrl), 'image/jpeg', interactive);
				f.driveId = meta.id;
			} catch { /* retry next sync */ }
		}
		if (ghOn && !f.githubId) {
			try {
				const meta = await github.uploadBlob('frames', frameFileName(it.id), b64(dataUrl), 'image/jpeg', interactive);
				f.githubId = meta.id;
			} catch { /* retry next sync */ }
		}
	}
	// Diagrams are editable: (re)upload PNG + scene when newer than the base.
	const baseById = new Map((base?.diagrams || []).map((d) => [d.id, d]));
	for (const d of local.diagrams) {
		const baseD: any = baseById.get(d.id);
		const edited = !baseD || (d.updatedAt || 0) > (baseD.updatedAt || 0);
		const entry: any = diagrams[d.id];
		if (driveOn && (!d.driveId || edited)) {
			const dataUrl = await loadDiagramImage(d.id);
			if (dataUrl) {
				try {
					const meta: any = d.driveId
						? await updateBlob(d.driveId, b64(dataUrl), 'image/png', interactive)
						: await uploadBlob('diagrams', diagramFileName(d.id), b64(dataUrl), 'image/png', interactive);
					(d as any).driveId = meta.id;
				} catch { /* retry next sync */ }
			}
		}
		if (ghOn && (!(d as any).githubId || edited)) {
			const dataUrl = await loadDiagramImage(d.id);
			if (dataUrl) {
				try {
					const meta: any = (d as any).githubId
						? await github.updateBlob((d as any).githubId, b64(dataUrl), 'image/png', interactive)
						: await github.uploadBlob('diagrams', diagramFileName(d.id), b64(dataUrl), 'image/png', interactive);
					(d as any).githubId = meta.id;
				} catch { /* retry next sync */ }
			}
		}
		if (driveOn && (!(d as any).sceneDriveId || edited) && entry?.sceneData !== undefined) {
			const sceneJson = JSON.stringify(entry.sceneData);
			try {
				const meta: any = (d as any).sceneDriveId
					? await updateTextFile((d as any).sceneDriveId, sceneJson, interactive)
					: await createTextFile('diagrams', `diagram-${d.id}.scene.json`, sceneJson, interactive);
				(d as any).sceneDriveId = meta.id;
			} catch { /* retry next sync */ }
		}
		if (ghOn && (!(d as any).sceneGithubId || edited) && entry?.sceneData !== undefined) {
			const sceneJson = JSON.stringify(entry.sceneData);
			try {
				const meta: any = (d as any).sceneGithubId
					? await github.updateTextFile((d as any).sceneGithubId, sceneJson, interactive)
					: await github.createTextFile('diagrams', `diagram-${d.id}.scene.json`, sceneJson, interactive);
				(d as any).sceneGithubId = meta.id;
			} catch { /* retry next sync */ }
		}
	}
}

// Download any image/scene this device is missing for the merged page (both backends).
async function pullImages(merged: PageRecord, diagrams: DiagramsMap, interactive: boolean): Promise<boolean> {
	let diagramsChanged = false;
	const driveOn = isConfigured() && await isConnected().catch(()=>false);
	const ghOn = github.isConfigured() && await github.isConnected().catch(()=>false);
	for (const it of merged.videoItems) {
		const f: any = it.frame;
		if (!f) continue;
		if (!(await hasFrameImage(it.id))) {
			let dataUrl: string | null = null;
			if (f.driveId && driveOn) {
				try { dataUrl = await downloadBlob(f.driveId, interactive); } catch {}
			}
			if (!dataUrl && f.githubId && ghOn) {
				try { dataUrl = await github.downloadBlob(f.githubId, interactive); } catch {}
			}
			// Fallback: try by deterministic name if id-based lookup failed (old records)
			if (!dataUrl && ghOn) {
				try {
					const meta = await github.findInFolder('frames', frameFileName(it.id), interactive);
					if (meta) dataUrl = await github.downloadBlob(meta.id, interactive);
				} catch {}
			}
			if (dataUrl) try { await saveFrameImage(it.id, dataUrl); } catch {}
		}
	}
	for (const d of merged.diagrams as any[]) {
		const dd: any = d;
		if (dd.driveId && !(await hasDiagramImage(d.id)) && driveOn) {
			try { const dataUrl = await downloadBlob(dd.driveId, interactive); if (dataUrl) await saveDiagramImage(d.id, dataUrl); } catch {}
		}
		if (dd.githubId && !(await hasDiagramImage(d.id)) && ghOn) {
			try { const dataUrl = await github.downloadBlob(dd.githubId, interactive); if (dataUrl) await saveDiagramImage(d.id, dataUrl); } catch {}
		}
		if (!await hasDiagramImage(d.id) && ghOn) {
			// Try by name fallback
			try {
				const meta = await github.findInFolder('diagrams', diagramFileName(d.id), interactive);
				if (meta) { const dataUrl = await github.downloadBlob(meta.id, interactive); if (dataUrl) await saveDiagramImage(d.id, dataUrl); }
			} catch {}
		}
		const entry: any = diagrams[d.id];
		const needDriveScene = dd.sceneDriveId && (!entry || (entry.updatedAt || 0) < (d.updatedAt || 0));
		const needGhScene = dd.sceneGithubId && (!entry || (entry.updatedAt || 0) < (d.updatedAt || 0));
		let sceneData: any = null;
		if (needDriveScene && driveOn) {
			try { sceneData = JSON.parse(await downloadDriveFile(dd.sceneDriveId!, interactive)); } catch {}
		}
		if (!sceneData && needGhScene && ghOn) {
			try { sceneData = JSON.parse(await github.downloadDriveFile(dd.sceneGithubId!, interactive)); } catch {}
		}
		if (sceneData) {
			diagrams[d.id] = { sceneData, updatedAt: d.updatedAt, driveId: dd.driveId, sceneDriveId: dd.sceneDriveId, githubId: dd.githubId, sceneGithubId: dd.sceneGithubId };
			diagramsChanged = true;
		} else if (!entry && !dd.sceneDriveId && !dd.sceneGithubId) {
			diagrams[d.id] = { updatedAt: d.updatedAt, ...(dd.driveId ? { driveId: dd.driveId } : {}), ...(dd.githubId ? { githubId: dd.githubId } : {}), pasted: true };
			diagramsChanged = true;
		} else if (entry) {
			const next: any = { ...entry, updatedAt: d.updatedAt ?? entry.updatedAt, driveId: dd.driveId, sceneDriveId: dd.sceneDriveId, githubId: dd.githubId, sceneGithubId: dd.sceneGithubId };
			if (JSON.stringify(next) !== JSON.stringify(entry)) { diagrams[d.id] = next; diagramsChanged = true; }
		}
	}
	return diagramsChanged;
}

// Write a merged page back to the sharded local stores. Image bytes are untouched
// (they live in IndexedDB); the diagrams map is updated by the caller.
async function writeLocalPage(merged: PageRecord): Promise<void> {
	const url = merged.url;
	if (merged.highlights.length) {
		await setPage<StoredHighlights>('hl', url, { url, ...(merged.title ? { title: merged.title } : {}), highlights: merged.highlights as StoredHighlights['highlights'] });
	} else {
		await removePage('hl', url);
	}
	if (merged.drawings.length) {
		await setPage<StoredDrawings>('dr', url, { url, strokes: merged.drawings as StoredDrawings['strokes'] });
	} else {
		await removePage('dr', url);
	}
	if (merged.videoItems.length) {
		await setPage<StoredVideo>('va', url, { url, ...(merged.videoId ? { videoId: merged.videoId } : {}), ...(merged.title ? { title: merged.title } : {}), items: merged.videoItems as VideoItem[] });
	} else {
		await removePage('va', url);
	}
}

// Drop the blob + scene + map entry for any diagram tombstoned in this merge.
async function cleanupTombstonedDiagrams(merged: PageRecord, diagrams: DiagramsMap, interactive: boolean): Promise<boolean> {
	let changed = false;
	const driveOn = isConfigured() && await isConnected().catch(()=>false);
	const ghOn = github.isConfigured() && await github.isConnected().catch(()=>false);
	for (const id of Object.keys(merged.tombstones.diagrams)) {
		if (diagrams[id]) { delete diagrams[id]; changed = true; }
		await deleteDiagramImage(id).catch(() => {});
		// Best-effort remote cleanup so blobs don't accumulate (by deterministic name).
		for (const name of [diagramFileName(id), `diagram-${id}.scene.json`]) {
			if (driveOn) {
				try {
					const f = await findInFolder('diagrams', name, interactive);
					if (f) await deleteDriveFile(f.id, interactive);
				} catch {}
			}
			if (ghOn) {
				try {
					const f = await github.findInFolder('diagrams', name, interactive);
					if (f) await github.deleteDriveFile(f.id, interactive);
				} catch {}
			}
		}
	}
	return changed;
}

// Strip any stray image bytes before a page record is serialised to Drive.
function stripForUpload(rec: PageRecord): PageRecord {
	return {
		...rec,
		videoItems: rec.videoItems.map((it) => {
			if (!it.frame) return it;
			const { dataUrl, ...frameRest } = it.frame as VideoFrame;
			return { ...it, frame: frameRest };
		}),
	};
}

// --- Reconcile ---------------------------------------------------------------

// All sync operations are serialised so a full reconcile and a targeted push
// never interleave on the same page file.
let chain: Promise<void> = Promise.resolve();
function serialize(op: () => Promise<void>): Promise<void> {
	const next = chain.catch(() => {}).then(op);
	chain = next.catch(() => {});
	return next;
}

/**
 * Full reconcile: every page that exists locally or on Drive/GitHub, each merged
 * independently (no whole-dataset merge). Used by the alarm, startup, and the
 * manual "Sync now" button. Supports both backends live — merges Drive+GitHub+local.
 * @param interactive allow an OAuth consent window (manual "Sync now"/Connect).
 */
export async function sync(interactive = false): Promise<void> {
	const driveOn = isConfigured();
	const ghOn = github.isConfigured();
	if (!driveOn && !ghOn) {
		if (interactive) throw new Error('No sync backend configured (Drive or GitHub)');
		return;
	}
	return serialize(() => doFullSync(interactive));
}

/**
 * Targeted reconcile: only the given pages. Used by the on-change push so a single
 * edit syncs just its page, not the whole library.
 */
export async function syncChanged(urls: string[], interactive = false): Promise<void> {
	const driveOn = isConfigured() && await isConnected().catch(()=>false);
	const ghOn = github.isConfigured() && await github.isConnected().catch(()=>false);
	if ((!driveOn && !ghOn) || !urls.length) return;
	return serialize(async () => {
		await setStatus({ syncing: true, lastError: undefined });
		try {
			let done = 0;
			for (const url of urls) {
				await reportProgress({ phase: 'page', done, total: urls.length, url, title: await pageLabel(url) }, done === 0);
				await syncPage(url, interactive);
				done++;
			}
			await setStatus({
				connected: true, syncing: false, lastSyncedAt: Date.now(),
				lastError: undefined, progress: undefined,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await setStatus({ syncing: false, lastError: message, progress: undefined });
			throw err;
		}
	});
}

async function doFullSync(interactive: boolean): Promise<void> {
	await setStatus({ syncing: true, lastError: undefined });
	try {
		await reportProgress({ phase: 'discovering', done: 0, total: 0 }, true);
		const urls = new Set<string>(await listAllPageUrls());
		const driveOn = isConfigured() && await isConnected().catch(()=>false);
		const ghOn = github.isConfigured() && await github.isConnected().catch(()=>false);
		// Discover remote-only pages from each connected backend
		const driveMetaByName = new Map<string, DriveFileMeta>();
		const ghMetaByName = new Map<string, DriveFileMeta>();
		const localNames = new Set<string>();
		for (const u of urls) localNames.add(await pageFileName(u));
		if (driveOn) {
			try {
				const remoteFiles = await listFolder('pages', interactive);
				for (const f of remoteFiles) {
					driveMetaByName.set(f.name, f);
					if (!localNames.has(f.name)) {
						try {
							const rec = JSON.parse(await downloadDriveFile(f.id, interactive)) as PageRecord;
							if (rec?.url) urls.add(rec.url);
						} catch {}
					}
				}
			} catch {}
		}
		if (ghOn) {
			try {
				const remoteFiles = await github.listFolder('pages', interactive);
				for (const f of remoteFiles as any) {
					ghMetaByName.set(f.name, f as DriveFileMeta);
					if (!localNames.has(f.name)) {
						try {
							const rec = JSON.parse(await github.downloadDriveFile((f as any).id, interactive)) as PageRecord;
							if (rec?.url) urls.add(rec.url);
						} catch {}
					}
				}
			} catch {}
		}
		const diagrams = await loadDiagrams();
		let done = 0;
		let skipped = 0;
		for (const url of urls) {
			const fname = await pageFileName(url);
			const dMeta = driveMetaByName.get(fname) ?? null;
			const gMeta = ghMetaByName.get(fname) ?? null;
			// isPageInSync checks each connected backend; if both are in sync we skip
			let inSync = true;
			if (driveOn) inSync = inSync && await isPageInSync(url, dMeta, diagrams);
			if (ghOn) inSync = inSync && await isPageInSyncGithub(url, gMeta, diagrams);
			if (inSync && (driveOn || ghOn)) { skipped++; continue; }
			// For page that exists only on one backend, the other backend will be null — still needs sync to backfill
			await reportProgress(
				{ phase: 'page', done, total: urls.size - skipped, url, title: await pageLabel(url) },
				done === 0,
			);
			await syncPage(url, interactive, dMeta);
			done++;
		}
		if (skipped) console.debug(`Sync: ${done} page(s) reconciled, ${skipped} already in sync (drive:${driveOn} github:${ghOn})`);
		await setStatus({
			connected: !!(driveOn || ghOn), syncing: false, lastSyncedAt: Date.now(),
			lastError: undefined, progress: undefined,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await setStatus({ syncing: false, lastError: message, progress: undefined });
		throw err;
	}
}

/**
 * Reconcile a single page: 3-way merge (snapshot/base + local + remote Drive
 * file), upload images, upload the merged page JSON (compare-and-swap on the
 * Drive revision), pull any missing images, then write the merge back locally.
 * `knownMeta` (when provided) skips the initial file lookup on the first attempt.
 */
/**
 * Can this page be skipped entirely? True only when all three agree:
 *  - we have a reconciled snapshot and the Drive revision we last wrote,
 *  - the Drive file still carries that same revision (nobody else wrote it),
 *  - and the local record is byte-identical to that snapshot (we didn't either).
 * Any missing piece means "reconcile" — this is an optimisation, never a decision
 * about the data. Costs two small storage reads and no network.
 */
async function isPageInSync(
	url: string,
	remoteMeta: DriveFileMeta | null,
	diagrams: DiagramsMap,
): Promise<boolean> {
	if (!remoteMeta?.headRevisionId) return false;
	const keys = [snapKey(url), pageMetaKey(url)];
	const got = await browser.storage.local.get(keys);
	const snap = got[snapKey(url)] as PageRecord | undefined;
	const meta = got[pageMetaKey(url)] as PageMeta | undefined;
	if (!snap || !meta?.headRevisionId) return false;
	if (meta.fileId !== remoteMeta.id || meta.headRevisionId !== remoteMeta.headRevisionId) return false;

	const local = await assembleLocalPage(url, diagrams);
	return entityFingerprint(local) === entityFingerprint(snap);
}

async function isPageInSyncGithub(
	url: string,
	remoteMeta: DriveFileMeta | null,
	diagrams: DiagramsMap,
): Promise<boolean> {
	if (!remoteMeta?.headRevisionId) return false;
	const keys = [snapKey(url), githubPageMetaKey(url)];
	const got = await browser.storage.local.get(keys);
	const snap = got[snapKey(url)] as PageRecord | undefined;
	const meta = got[githubPageMetaKey(url)] as PageMeta | undefined;
	if (!snap || !meta?.headRevisionId) return false;
	if (meta.fileId !== remoteMeta.id || meta.headRevisionId !== remoteMeta.headRevisionId) return false;
	const local = await assembleLocalPage(url, diagrams);
	return entityFingerprint(local) === entityFingerprint(snap);
}

// The entities a reconcile would actually move, in a stable order. Deliberately
// excludes tombstones and `deletedAt`: those live in the snapshot but are never
// rebuilt by assembleLocalPage, so including them would make every page that ever
// had a deletion look permanently out of sync.
function entityFingerprint(rec: PageRecord): string {
	const byId = <T extends { id?: string }>(items: T[] = []) =>
		[...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
	return JSON.stringify({
		title: rec.title ?? '',
		videoId: rec.videoId ?? '',
		highlights: byId(rec.highlights as { id?: string }[]),
		drawings: byId(rec.drawings as { id?: string }[]),
		videoItems: byId(stripForUpload(rec).videoItems as { id?: string }[]),
		diagrams: byId(rec.diagrams),
	});
}

async function syncPage(url: string, interactive: boolean, knownMeta?: DriveFileMeta | null): Promise<void> {
	const fileName = await pageFileName(url);
	const snap = ((await browser.storage.local.get(snapKey(url)))[snapKey(url)] as PageRecord) || null;

	for (let attempt = 0; attempt < 4; attempt++) {
		const now = Date.now();
		const driveOn = isConfigured() && await isConnected().catch(()=>false);
		const ghOn = github.isConfigured() && await github.isConnected().catch(()=>false);
		// Drive remote
		const fileMeta: DriveFileMeta | null =
			attempt === 0 && knownMeta !== undefined ? knownMeta : (driveOn ? await findInFolder('pages', fileName, interactive) : null);
		let driveRemote: PageRecord | null = null;
		if (driveOn && fileMeta) {
			try { driveRemote = JSON.parse(await downloadDriveFile(fileMeta.id, interactive)) as PageRecord; }
			catch { driveRemote = null; }
		}
		// GitHub remote
		let ghRemote: PageRecord | null = null;
		let ghMeta: DriveFileMeta | null = null;
		if (ghOn) {
			try {
				ghMeta = await github.findInFolder('pages', fileName, interactive);
				if (ghMeta) ghRemote = JSON.parse(await github.downloadDriveFile(ghMeta.id, interactive)) as PageRecord;
			} catch { ghRemote = null; ghMeta = null; }
		}

		const diagrams = await loadDiagrams();
		const local = await assembleLocalPage(url, diagrams);
		const localBefore = JSON.stringify(local);

		await pushImages(local, snap, diagrams, interactive);
		const remotes: (PageRecord | null)[] = [];
		if (driveOn) remotes.push(driveRemote);
		if (ghOn) remotes.push(ghRemote);
		// If neither backend connected, just write local back (should not happen)
		const merged = remotes.length ? mergePageRecordMulti(snap, local, remotes, now) : mergePageRecord(snap, local, null, now);

		// Upload the merged page JSON (image-free) to each connected backend, CAS on its revision.
		const mergedJson = JSON.stringify(stripForUpload(merged));
		let outDriveMeta: DriveFileMeta | null = null;
		let outGhMeta: DriveFileMeta | null = null;
		// Drive
		if (driveOn) {
			const remoteJson = driveRemote ? JSON.stringify(driveRemote) : null;
			if (!fileMeta) {
				outDriveMeta = await createTextFile('pages', fileName, mergedJson, interactive);
			} else if (mergedJson === remoteJson) {
				outDriveMeta = fileMeta;
			} else {
				const fresh = await findInFolder('pages', fileName, interactive);
				if (fresh && fresh.headRevisionId !== fileMeta.headRevisionId && attempt < 3) continue;
				outDriveMeta = await updateTextFile(fileMeta.id, mergedJson, interactive);
			}
		}
		// GitHub
		if (ghOn) {
			const remoteJsonGh = ghRemote ? JSON.stringify(ghRemote) : null;
			if (!ghMeta) {
				outGhMeta = await github.createTextFile('pages', fileName, mergedJson, interactive);
			} else if (mergedJson === remoteJsonGh) {
				outGhMeta = ghMeta;
			} else {
				const freshGh = await github.findInFolder('pages', fileName, interactive);
				if (freshGh && freshGh.headRevisionId !== ghMeta.headRevisionId && attempt < 3) continue;
				outGhMeta = await github.updateTextFile(ghMeta.id, mergedJson, interactive);
			}
		}

		// If a content script edited this page during our network I/O, our merge is
		// stale — redo it rather than clobbering the edit.
		const localNow = JSON.stringify(await assembleLocalPage(url, await loadDiagrams()));
		if (localNow !== localBefore && attempt < 3) continue;

		const pulledDiagrams = await pullImages(merged, diagrams, interactive);
		await writeLocalPage(merged);
		const cleaned = await cleanupTombstonedDiagrams(merged, diagrams, interactive);
		if (pulledDiagrams || cleaned) await browser.storage.local.set({ [DIAGRAMS_KEY]: diagrams });

		const toSet: Record<string, unknown> = { [snapKey(url)]: merged };
		if (outDriveMeta) (toSet as any)[pageMetaKey(url)] = { fileId: outDriveMeta.id, headRevisionId: outDriveMeta.headRevisionId } as PageMeta;
		if (outGhMeta) (toSet as any)[githubPageMetaKey(url)] = { fileId: outGhMeta.id, headRevisionId: outGhMeta.headRevisionId } as PageMeta;
		// If a backend was not connected, keep its old meta (don't delete)
		// If a new backend was just connected and had no prior file, we now have its meta
		await browser.storage.local.set(toSet);
		return;
	}
}

/**
 * Pages that reference any of the given diagram ids in their highlight comments.
 * A diagram edit only touches the global `diagrams` map (not any `hl:` key), so the
 * background uses this to route a diagram change to the page(s) it belongs to.
 */
export async function findPagesForDiagrams(diagramIds: string[]): Promise<string[]> {
	if (!diagramIds.length) return [];
	const want = new Set(diagramIds);
	const out = new Set<string>();

	// Fast path: entries written by the comment editor record the page they belong
	// to, so the common case needs no scan at all. Only ids without that stamp
	// (older entries) fall through to reading the annotation records.
	const diagrams = await loadDiagrams();
	for (const id of [...want]) {
		const pageUrl = diagrams[id]?.pageUrl;
		if (pageUrl) { out.add(pageUrl); want.delete(id); }
	}
	if (want.size === 0) return [...out];

	const all = await getAll<StoredHighlights>('hl');
	for (const url of Object.keys(all)) {
		if (collectDiagramIds(all[url].highlights || []).some((id) => want.has(id))) out.add(url);
	}
	return [...out];
}

/** Clear local sync bookkeeping (called on disconnect). */
export async function resetSyncState(): Promise<void> {
	const all = await browser.storage.local.get(null);
	const keys = Object.keys(all).filter((k) => k === STATUS_KEY || k.startsWith('snap:') || k.startsWith('pagemeta:'));
	if (keys.length) await browser.storage.local.remove(keys);
}
