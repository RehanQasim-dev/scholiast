package com.scholiast.android.domain.sync

import com.scholiast.android.data.db.SyncMetaDao
import com.scholiast.android.data.db.SyncMetaEntity
import com.scholiast.android.data.model.ScholiastJson
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The single source of sync status for the whole app: a [StateFlow] of [SyncStatus]
 * written by [SyncWorker] and read by Home/Settings, persisted as JSON under the
 * Room `sync_meta` key [STATUS_KEY] so a process death doesn't lose the terminal
 * state (`lastSyncedAt`/`lastError`).
 *
 * Two surfaces, deliberately decoupled (same split as the desktop, where the
 * settings panel follows `storage.onChanged` live):
 *
 * - **Live** — every [update]/[reportProgress] writes the [StateFlow] immediately;
 *   the chip and the progress bar read it with zero IO.
 * - **Persisted** — [persist] writes the record, rate-limited by [PersistRateLimiter]
 *   so a huge reconcile never becomes a Room write per page. Force-persists land
 *   for run start, the first page (`done == 0`), and every terminal state.
 *
 * The repository owns no coroutine scope: [persist] is suspend and is called from
 * the worker's own context (and from tests directly), keeping the rate-limiter
 * state machine deterministic.
 */
class SyncStatusRepository(
    private val dao: SyncMetaDao,
    private val clock: () -> Long = System::currentTimeMillis,
    minPersistIntervalMs: Long = DEFAULT_MIN_PERSIST_INTERVAL_MS,
) {
    private val _status = MutableStateFlow(SyncStatus())
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    private val rateLimiter = PersistRateLimiter(minPersistIntervalMs, clock)

    /**
     * Load the persisted record once at startup. Transient states from a dead
     * process demote to IDLE so the UI never shows a stuck "Syncing…".
     */
    suspend fun load() {
        val stored = dao.get(STATUS_KEY)
            ?.let { runCatching { ScholiastJson.decode<SyncStatus>(it.value) }.getOrNull() }
        _status.value = (stored ?: SyncStatus()).demoteTransient()
    }

    /** Apply [transform] to the live status. Does not persist. */
    fun update(transform: (SyncStatus) -> SyncStatus) {
        _status.value = transform(_status.value)
    }

    /**
     * Live progress write from the engine's callback: sets the run state to match
     * the phase (discovery sweeps the UI, pages show done/total) and clears any
     * stale error. Does not persist (the worker force-persists when it matters).
     */
    fun reportProgress(progress: SyncProgress) {
        _status.value = _status.value.copy(
            state = if (progress.phase == SyncPhase.DISCOVERING) SyncState.DISCOVERING else SyncState.SYNCING,
            progress = progress,
            lastError = null,
        )
    }

    /**
     * Persist the current status if the rate limit allows. [force] bypasses it
     * (run start, first page, terminal states). Returns true when written.
     */
    suspend fun persist(force: Boolean = false): Boolean {
        if (!rateLimiter.shouldPersist(force)) return false
        dao.put(SyncMetaEntity(STATUS_KEY, ScholiastJson.encode(_status.value), clock()))
        return true
    }

    /** True when a run is already in flight — the worker's dedupe predicate. */
    fun isRunning(): Boolean = _status.value.isRunning

    companion object {
        /** Room `sync_meta` key — same name as the desktop's `sync_status` record. */
        const val STATUS_KEY = "sync_status"

        /**
         * Progress is a UI nicety: it must not turn a big reconcile into a storage
         * write per page (desktop uses 400 ms; on-device Room + the UI reading the
         * StateFlow directly, 2 s is ample and cuts a large run to a handful of writes).
         */
        const val DEFAULT_MIN_PERSIST_INTERVAL_MS = 2_000L
    }
}

/**
 * Pure rate limiter for status persistence: at most one write per
 * [minIntervalMs] unless forced. Testable without coroutines or Room.
 */
class PersistRateLimiter(
    private val minIntervalMs: Long,
    private val clock: () -> Long,
) {
    // Far in the past so the FIRST write is never blocked by an empty window
    // (`now - lastPersistAt` stays positive and well below minIntervalMs).
    private var lastPersistAt = Long.MIN_VALUE / 2

    /**
     * True when a write is due. A forced write always passes and refreshes the
     * window; a non-forced write within [minIntervalMs] of the last one is skipped.
     */
    fun shouldPersist(force: Boolean): Boolean {
        val now = clock()
        if (!force && now - lastPersistAt < minIntervalMs) return false
        lastPersistAt = now
        return true
    }
}