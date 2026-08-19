package com.scholiast.android.domain.sync

import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoPage
import com.scholiast.android.domain.sync.merge.PageFileName
import java.io.IOException

/**
 * What the sync worker consumes (Task 18's side of the Task 17 hand-off). Task
 * 17's [SyncEngine] class is the reconciler; this seam is what the worker and
 * tests depend on so the two stay decoupled.
 */
interface SyncRunSource {
    /** Drive is configured/authenticated — a run no-ops otherwise (desktop parity). */
    val connected: Boolean

    /**
     * The whole-library reconcile with live progress: [SyncProgress] DISCOVERING
     * first, then one PAGE update per page (done/total, page title/url). Throws
     * [SyncOfflineException] (an [IOException]) on a total network failure;
     * partial failures throw [SyncRunException]. Suspend callback so a slow
     * consumer can't block the engine.
     */
    suspend fun fullReconcile(onProgress: suspend (SyncProgress) -> Unit): SyncReconcileResult
}

/**
 * The [SyncRunSource] over Task 17's [SyncEngine]. The engine's own `syncAll()`
 * aggregates its pages internally without a progress callback, so this adapter
 * drives the same loop through the engine's public per-page surface
 * ([SyncEngine.syncPage], [SyncEngine.isPageInSync]) — mirroring the desktop's
 * `doFullSync` — and reports one PAGE update per page. The per-page semantics
 * (merge, CAS, retries, blob push/pull) are entirely the engine's.
 */
class SyncRunner(
    private val engine: SyncEngine,
    private val drive: DriveApi,
    private val pageStore: PageStore,
    private val isConnected: () -> Boolean,
    private val clock: () -> Long = System::currentTimeMillis,
) : SyncRunSource {

    override val connected: Boolean get() = isConnected()

    override suspend fun fullReconcile(onProgress: suspend (SyncProgress) -> Unit): SyncReconcileResult {
        onProgress(SyncProgress(SyncPhase.DISCOVERING))

        // Discovery, same change manifest as the engine's syncAll: every local
        // page plus remote-only pages (download once to learn their url).
        val localUrls = pageStore.listAllUrls()
        val localNames = localUrls.map { PageFileName.of(it) }.toSet()
        val remoteFiles = listFolderAll()
        val metaByName = remoteFiles.associateBy { it.name ?: "" }

        val urls = LinkedHashSet(localUrls)
        for (f in remoteFiles) {
            val name = f.name ?: continue
            if (name in localNames) continue
            try {
                val rec = ScholiastJson.decode<VideoPage>(drive.downloadText(f.id))
                if (rec.url.isNotEmpty()) urls.add(rec.url)
            } catch (_: Exception) { /* corrupt remote — leave to the engine */ }
        }

        val total = urls.size
        var done = 0
        var skipped = 0
        val errors = mutableListOf<String>()
        var firstFailure: Throwable? = null

        for (url in urls) {
            onProgress(SyncProgress(SyncPhase.PAGE, done, total, title = pageLabel(url), url = url))
            val meta = metaByName[PageFileName.of(url)]
            if (engine.isPageInSync(url, meta)) {
                skipped++
            } else {
                try {
                    engine.syncPage(url, knownMeta = meta)
                } catch (e: Exception) {
                    errors.add("$url: ${e.message ?: e.toString()}")
                    if (firstFailure == null) firstFailure = e
                }
            }
            done++
            onProgress(SyncProgress(SyncPhase.PAGE, done, total))
        }

        if (errors.isNotEmpty()) {
            // All pages failed → surface the root cause so an IOException maps to
            // OFFLINE + retry; partial failure → ERROR naming the first page.
            if (errors.size == total && firstFailure != null) throw firstFailure
            throw SyncRunException("Sync finished with ${errors.size} of $total pages failing: ${errors.first()}")
        }
        return SyncReconcileResult(changedPages = done - skipped, lastSyncedAt = clock())
    }

    /** The page's recorded title for the progress label (best-effort, cheap). */
    private suspend fun pageLabel(url: String): String? = pageStore.load(url).title

    private suspend fun listFolderAll(): List<DriveFileMeta> {
        val out = mutableListOf<DriveFileMeta>()
        var token: String? = null
        do {
            val page = drive.listFolder(DriveFolder.PAGES, token)
            out.addAll(page.files)
            token = page.nextPageToken
        } while (token != null)
        return out
    }
}

/** Outcome of a successful full reconcile. */
data class SyncReconcileResult(
    /** Pages actually reconciled (excludes in-sync skips). */
    val changedPages: Int,
    /** Wall-clock ms when the run finished (also stored on the status record). */
    val lastSyncedAt: Long,
)

/**
 * Network failure during a reconcile — the worker maps this to OFFLINE + retry.
 * It is an [IOException] so callers can catch it without importing this file.
 */
class SyncOfflineException(message: String, cause: Throwable? = null) : IOException(message, cause)

/** The run finished but some pages failed — the worker records ERROR and retries. */
class SyncRunException(message: String) : Exception(message)

/** Default [SyncRunSource] until Task 16/17 wiring lands: not connected → runs no-op. */
class UnwiredSyncRunner : SyncRunSource {
    override val connected: Boolean = false
    override suspend fun fullReconcile(onProgress: suspend (SyncProgress) -> Unit): SyncReconcileResult =
        error("Sync is not wired yet — SyncGraph.engineFactory must provide a SyncRunner over Task 17's SyncEngine")
}