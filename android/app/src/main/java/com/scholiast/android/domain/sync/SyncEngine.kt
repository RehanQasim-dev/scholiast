package com.scholiast.android.domain.sync

import com.scholiast.android.data.model.PageTombstones
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoPage
import com.scholiast.android.data.normalize.Normalize
import com.scholiast.android.domain.sync.merge.MergePageRecord
import com.scholiast.android.domain.sync.merge.PageFileName
import com.scholiast.android.ui.frame.FrameStore
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The per-page Drive reconcile loop, ported from `src/utils/sync-engine.ts`
 * against the narrow [DriveApi] contract (Task 16's REST client) and the same
 * `pages/page-<urlhash>.json` + `frames/frame-<itemId>.jpg` layout.
 *
 * - [syncChanged]: targeted push — reconcile exactly the given urls,
 *   UNCONDITIONALLY (no in-sync gate). Used for on-change pushes.
 * - [syncAll]: full reconcile — list `pages/` (the change manifest), discover
 *   remote-only pages by downloading them once, skip pages already in sync
 *   ([isPageInSync], zero network), reconcile the rest.
 * - [syncPage]: one page's 3-way merge (snapshot/base + local + remote), frame
 *   blob upload when a driveId is missing, CAS PUT (`If-Match` on
 *   `headRevisionId`), 412 → pull fresh remote → re-merge → re-PUT, pull
 *   missing frame blobs, write back + bookkeeping. Retries ≤ 4; the desktop
 *   returns silently after the last attempt, this engine THROWS
 *   ([PageSyncException]) so Task 18's worker gets a signal to reschedule —
 *   deliberate deviation, see LOG.md.
 *
 * All entries are serialized by an engine-wide [Mutex] (the desktop's `chain`
 * promise) so a full reconcile and a targeted push never interleave on the same
 * page file. Per-page parallelism is Task 18's concern.
 */
class SyncEngine(
    private val drive: DriveApi,
    private val pageStore: PageStore,
    private val frameStore: FrameStore,
    private val now: () -> Long = System::currentTimeMillis,
) {

    private val mutex = Mutex()

    /** Outcome of a run: how many pages reconciled/skipped, per-page errors. */
    data class SyncResult(
        val reconciled: Int,
        val skipped: Int,
        val errors: List<String>,
    ) {
        val ok: Boolean get() = errors.isEmpty()
    }

    // --- Public entries ----------------------------------------------------------

    /**
     * Targeted reconcile: only the given pages, unconditionally (the desktop's
     * `syncChanged`). Normalized + deduplicated; errors are aggregated per page
     * so one bad page doesn't abort the run.
     */
    suspend fun syncChanged(urls: List<String>): SyncResult = mutex.withLock {
        val targets = LinkedHashSet(urls.map { Normalize.normalizeUrl(it) }).toList()
        var reconciled = 0
        val errors = mutableListOf<String>()
        for (url in targets) {
            try {
                syncPage(url, knownMeta = null)
                reconciled++
            } catch (e: Exception) {
                errors.add("$url: ${e.message ?: e.toString()}")
            }
        }
        SyncResult(reconciled = reconciled, skipped = 0, errors = errors)
    }

    /**
     * Full reconcile: every page that exists locally or on Drive, each merged
     * independently (never a whole-dataset merge). The remote `pages/` listing
     * is the change manifest; pages whose Drive revision and local fingerprint
     * are unchanged since the last reconcile are skipped with zero network.
     */
    suspend fun syncAll(): SyncResult = mutex.withLock {
        val localUrls = pageStore.listAllUrls()
        val localNames = localUrls.map { PageFileName.of(it) }.toSet()
        val remoteFiles = listFolderAll(DriveFolder.PAGES)
        val metaByName = remoteFiles.associateBy { it.name ?: "" }

        // Discover remote-only pages: the filename is a hash, so download once
        // to learn the real url (mirrors the desktop `doFullSync`).
        val urls = LinkedHashSet<String>()
        urls.addAll(localUrls)
        for (f in remoteFiles) {
            val name = f.name ?: continue
            if (name in localNames) continue
            try {
                val rec = ScholiastJson.decode<VideoPage>(drive.downloadText(f.id))
                if (rec.url.isNotEmpty()) urls.add(rec.url)
            } catch (_: Exception) { /* skip corrupt */ }
        }

        var reconciled = 0
        var skipped = 0
        val errors = mutableListOf<String>()
        for (url in urls) {
            val meta = metaByName[PageFileName.of(url)]
            if (isPageInSync(url, meta)) {
                skipped++
                continue
            }
            try {
                syncPage(url, knownMeta = meta)
                reconciled++
            } catch (e: Exception) {
                errors.add("$url: ${e.message ?: e.toString()}")
            }
        }
        SyncResult(reconciled = reconciled, skipped = skipped, errors = errors)
    }

    // --- Reconcile ---------------------------------------------------------------

    /**
     * Reconcile a single page: 3-way merge (snapshot/base + local + remote Drive
     * file), upload frames missing a blob id, upload the merged page JSON
     * (compare-and-swap on the Drive revision), pull any missing frames, then
     * write the merge + bookkeeping back locally. `knownMeta` (when provided)
     * skips the initial file lookup on the first attempt. Retries ≤ 4, then
     * throws [PageSyncException].
     */
    suspend fun syncPage(url: String, knownMeta: DriveFileMeta? = null): DriveFileMeta {
        val normalized = Normalize.normalizeUrl(url)
        val fileName = PageFileName.of(normalized)
        val snap = pageStore.load(normalized).snap

        for (attempt in 0 until 4) {
            val t = now()
            val fileMeta: DriveFileMeta? =
                if (attempt == 0 && knownMeta != null) knownMeta
                else drive.findInFolder(DriveFolder.PAGES, fileName)

            var remote: VideoPage? = null
            if (fileMeta != null) {
                try {
                    remote = ScholiastJson.decode<VideoPage>(drive.downloadText(fileMeta.id))
                } catch (_: Exception) {
                    remote = null // corrupt — treat as absent; this reconcile rewrites it
                }
            }

            val page = pageStore.load(normalized)
            // Pre-push assembly is the staleness baseline (the desktop compares
            // before/after pushImages, which its own driveId stamping pollutes —
            // see LOG.md).
            val localBefore = assembleLocalPage(page, snap)
            val local = pushImages(localBefore)
            val merged = MergePageRecord.mergePageRecord(snap, local, remote, t)

            // Upload the merged page JSON (image-free), CAS on the Drive revision.
            val mergedJson = ScholiastJson.encode(stripForUpload(merged))
            val remoteJson = remote?.let { ScholiastJson.encode(it) }
            val outMeta: DriveFileMeta = when {
                fileMeta == null -> drive.createTextFile(DriveFolder.PAGES, fileName, mergedJson)
                mergedJson == remoteJson -> fileMeta // nothing to upload
                else -> {
                    val fresh = drive.findInFolder(DriveFolder.PAGES, fileName)
                    if (fresh != null && fresh.headRevisionId != fileMeta.headRevisionId && attempt < 3) {
                        continue // remote moved — re-merge against the fresh remote
                    }
                    try {
                        drive.updateFile(fileMeta.id, mergedJson, ifMatchRevision = fileMeta.headRevisionId)
                    } catch (e: SyncConflictException) {
                        // 412: the remote moved between find and PUT — re-merge.
                        if (attempt < 3) continue else throw e
                    }
                }
            }

            // If the user edited this page during our network I/O, our merge is
            // stale — redo it rather than clobbering the edit.
            val pageNow = pageStore.load(normalized)
            val localNow = assembleLocalPage(pageNow, snap)
            if (localNow != localBefore && attempt < 3) continue

            pullImages(merged)
            pageStore.saveReconciled(normalized, merged, outMeta)
            return outMeta
        }
        throw PageSyncException(normalized, "Page did not sync after 4 attempts")
    }

    /**
     * Can this page be skipped entirely? True only when all three agree:
     *  - we have a reconciled snapshot and the Drive revision we last wrote,
     *  - the Drive file still carries that same revision (nobody else wrote it),
     *  - and the local record is byte-identical to that snapshot (we didn't
     *    either).
     * Any missing piece means "reconcile" — this is an optimisation, never a
     * decision about the data. Costs two small DB reads and no network.
     */
    suspend fun isPageInSync(url: String, remoteMeta: DriveFileMeta?): Boolean {
        if (remoteMeta?.headRevisionId == null) return false
        val page = pageStore.load(url)
        val snap = page.snap ?: return false
        val metaHead = page.headRevisionId ?: return false
        if (page.fileId != remoteMeta.id || metaHead != remoteMeta.headRevisionId) return false

        val local = assembleLocalPage(page, snap)
        return entityFingerprint(local) == entityFingerprint(snap)
    }

    // --- Local page assembly -----------------------------------------------------

    /**
     * Build the canonical local PageRecord for the snapshot. The app owns only
     * videoItems; highlights/drawings/diagrams are SEEDED from the snap (the
     * merge base) so `l == b` for those categories — the app faithfully passes
     * desktop edits through (remote-new kept, remote-delete tombstoned,
     * tombstone-not-resurrected) while only ever mutating videoItems locally.
     * Without the seeding, an empty local list would TOMBSTONE every desktop
     * highlight on the first sync (the plugin's `foreign` bucket concept).
     */
    private fun assembleLocalPage(page: PageSnapshot, snap: VideoPage?): VideoPage = VideoPage(
        version = 2,
        url = page.url,
        title = page.title ?: snap?.title,
        videoId = page.videoId ?: snap?.videoId,
        highlights = snap?.highlights ?: emptyList(),
        drawings = snap?.drawings ?: emptyList(),
        videoItems = page.items,
        diagrams = snap?.diagrams ?: emptyList(),
        tombstones = PageTombstones(),
    )

    /**
     * The entities a reconcile would actually move, in a stable order, as a
     * canonical JSON string. Deliberately excludes tombstones and `deletedAt`:
     * those live in the snapshot but are never rebuilt by [assembleLocalPage],
     * so including them would make every page that ever had a deletion look
     * permanently out of sync. Mirrors the desktop `entityFingerprint`.
     */
    internal fun entityFingerprint(rec: VideoPage): String {
        val sortedHl = rec.highlights.sortedWith(compareBy { it.id })
        val sortedDr = rec.drawings.sortedWith(compareBy { it.id })
        val sortedVi = stripForUpload(rec).videoItems.sortedWith(compareBy { it.id })
        val sortedDg = rec.diagrams.sortedWith(compareBy { it.id })
        return buildString {
            append("{\"title\":").append(JsonString.quote(rec.title ?: ""))
            append(",\"videoId\":").append(JsonString.quote(rec.videoId ?: ""))
            append(",\"highlights\":").append(JsonString.array(sortedHl.map { ScholiastJson.encode(it) }))
            append(",\"drawings\":").append(JsonString.array(sortedDr.map { ScholiastJson.encode(it) }))
            append(",\"videoItems\":").append(JsonString.array(sortedVi.map { ScholiastJson.encode(it) }))
            append(",\"diagrams\":").append(JsonString.array(sortedDg.map { ScholiastJson.encode(it) }))
            append('}')
        }
    }

    // --- Image blobs -------------------------------------------------------------

    private fun frameFileName(id: String): String = "frame-$id.jpg"

    /**
     * Push this page's local frame bytes to Drive, stamping the resulting blob
     * ids into the returned record so the merged record (and thus the uploaded
     * page JSON + local snapshot) carries the pointers. Frames are immutable
     * once captured: upload only when the item has no Drive blob yet. Failures
     * are swallowed (retried next sync), like the desktop.
     */
    private suspend fun pushImages(local: VideoPage): VideoPage {
        var changed = false
        val items = local.videoItems.map { item ->
            val f = item.frame ?: return@map item
            if (f.driveId != null) return@map item
            val bytes = frameStore.load(item.id) ?: return@map item // not on this device
            try {
                val meta = drive.uploadBlob(DriveFolder.FRAMES, frameFileName(item.id), bytes, "image/jpeg")
                changed = true
                item.copy(frame = f.copy(driveId = meta.id))
            } catch (_: Exception) {
                item // retry next sync
            }
        }
        return if (changed) local.copy(videoItems = items) else local
    }

    /**
     * Download any frame this device is missing for the merged page (it has a
     * driveId but no local JPEG). Failures are swallowed (fetched next sync).
     */
    private suspend fun pullImages(merged: VideoPage) {
        for (item in merged.videoItems) {
            val f = item.frame ?: continue
            val driveId = f.driveId ?: continue
            if (frameStore.has(item.id)) continue
            try {
                frameStore.save(item.id, drive.downloadBlob(driveId))
            } catch (_: Exception) { /* fetch next sync */ }
        }
    }

    /** Strip any stray runtime-only `dataUrl` before a record is serialised. */
    internal fun stripForUpload(rec: VideoPage): VideoPage = rec.copy(
        videoItems = rec.videoItems.map { item ->
            val f = item.frame ?: return@map item
            item.copy(frame = f.copy(dataUrl = null))
        },
    )

    private suspend fun listFolderAll(folder: DriveFolder): List<DriveFileMeta> {
        val out = mutableListOf<DriveFileMeta>()
        var token: String? = null
        do {
            val page = drive.listFolder(folder, token)
            out.addAll(page.files)
            token = page.nextPageToken
        } while (token != null)
        return out
    }
}

/** Minimal JSON string escaping for the entity fingerprint. */
private object JsonString {
    fun quote(s: String): String = buildString {
        append('"')
        for (c in s) {
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (c.code < 0x20) append("\\u%04x".format(c.code)) else append(c)
            }
        }
        append('"')
    }

    fun array(items: List<String>): String = items.joinToString(",", "[", "]")
}