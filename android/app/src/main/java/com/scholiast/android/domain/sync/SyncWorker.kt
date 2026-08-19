package com.scholiast.android.domain.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.sync.withLock

/**
 * The WorkManager worker wrapping the sync source (Task 18 schedules; the
 * [SyncRunSource] — SyncRunner over Task 17's engine — reconciles). Owns only
 * the status state machine and the retry decision:
 *
 * - Run start → CONNECTING (force-persist); if the source isn't connected, back
 *   to IDLE and done (desktop: `if (!isConfigured()) return`).
 * - Discovery → DISCOVERING (indeterminate UI); per-page progress → SYNCING with
 *   done/total/title/url; the FIRST page force-persists so the count appears even
 *   if the run then throttles writes (desktop's `done === 0` force).
 * - Success → IDLE + `lastSyncedAt` (force-persist, progress cleared).
 * - [SyncOfflineException] (an [IOException]) → OFFLINE + force-persist, and
 *   `Result.retry()` — the CONNECTED constraint + exponential backoff reschedule
 *   it; the local queue persists so nothing is lost (plan §5.10).
 * - Any other failure (including partial page failures via [SyncRunException])
 *   → ERROR + force-persist + `Result.retry()`.
 *
 * The state machine itself lives in [runSync] (top-level pure suspend) so JVM
 * tests drive it without WorkManager or Android.
 */
class SyncWorker(
    appContext: Context,
    params: WorkerParameters,
    private val source: SyncRunSource = SyncGraph.engineFactory(appContext),
    private val repository: SyncStatusRepository = SyncGraph.repository(appContext),
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        // Dedupe: a run is already in flight (periodic + foreground fired together,
        // or the user hit Sync now mid-run). The engine also serializes internally;
        // this avoids even queuing the second run.
        if (SyncGraph.runLock.isLocked) return Result.success()
        return try {
            SyncGraph.runLock.withLock {
                runSync(source, repository)
            }
            Result.success()
        } catch (e: Exception) {
            // OFFLINE and ERROR were already recorded by runSync; both reschedule
            // (backoff + network constraint) — the local queue persists, nothing lost.
            Result.retry()
        }
    }

    companion object {
        /**
         * The whole run state machine. Public so JVM tests (and any future caller
         * that wants to sync without WorkManager) can drive it with a fake source
         * and repository; the worker's [doWork] adds only the lock and retry mapping.
         */
        suspend fun runSync(source: SyncRunSource, repository: SyncStatusRepository) {
            repository.update { it.copy(state = SyncState.CONNECTING, connected = source.connected, lastError = null) }
            repository.persist(force = true)

            if (!source.connected) {
                repository.update { it.copy(state = SyncState.IDLE) }
                repository.persist(force = true)
                return
            }

            try {
                val result = source.fullReconcile { progress ->
                    repository.reportProgress(progress)
                    // First page of a run always lands: the count appears even when
                    // subsequent per-page writes are throttled (desktop parity).
                    if (progress.phase == SyncPhase.PAGE && progress.done == 0) {
                        repository.persist(force = true)
                    }
                }
                repository.update {
                    it.copy(
                        state = SyncState.IDLE,
                        lastSyncedAt = result.lastSyncedAt,
                        lastError = null,
                        progress = null,
                    )
                }
                repository.persist(force = true)
            } catch (e: SyncOfflineException) {
                repository.update { it.copy(state = SyncState.OFFLINE, lastError = e.message) }
                repository.persist(force = true)
                throw e
            } catch (e: Exception) {
                repository.update { it.copy(state = SyncState.ERROR, lastError = e.message) }
                repository.persist(force = true)
                throw e
            }
        }
    }
}