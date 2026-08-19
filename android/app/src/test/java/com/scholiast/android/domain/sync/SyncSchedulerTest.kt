package com.scholiast.android.domain.sync

import androidx.work.BackoffPolicy
import androidx.work.NetworkType
import com.scholiast.android.data.db.SyncMetaDao
import com.scholiast.android.data.db.SyncMetaEntity
import com.scholiast.android.data.model.ScholiastJson
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Worker scheduling + the run state machine (Task 18 acceptance: idle →
 * discovering → pages → success/error → idle, offline retry, rate-limited
 * emission order, scheduling constraints). The WorkManager runtime itself is
 * not exercised — the pure seams are: [SyncWorker.runSync] against a fake
 * source/repository, the request builders' constraints, and the run lock that
 * gates a second run.
 */
class SyncSchedulerTest {

    private class FakeClock(var now: Long = 1_000_000L) {
        fun advance(ms: Long) {
            now += ms
        }
    }

    private class FakeSyncMetaDao : SyncMetaDao {
        val rows = mutableMapOf<String, SyncMetaEntity>()
        val puts = mutableListOf<SyncMetaEntity>()

        override suspend fun put(meta: SyncMetaEntity) {
            puts.add(meta)
            rows[meta.key] = meta
        }

        override suspend fun get(key: String): SyncMetaEntity? = rows[key]
        override suspend fun getAll(): List<SyncMetaEntity> = rows.values.toList()
        override suspend fun delete(key: String) {
            rows.remove(key)
        }

        override suspend fun deleteAll() {
            rows.clear()
        }
    }

    /** A scripted source: replays [progress] into the callback, or throws [failure]. */
    private class FakeEngine(
        override var connected: Boolean = true,
        val progress: List<SyncProgress> = listOf(
            SyncProgress(SyncPhase.DISCOVERING),
            SyncProgress(SyncPhase.PAGE, done = 0, total = 3, title = "Lecture one", url = "https://youtube.com/watch?v=aaa"),
            SyncProgress(SyncPhase.PAGE, done = 1, total = 3, title = "Lecture two", url = "https://youtube.com/watch?v=bbb"),
            SyncProgress(SyncPhase.PAGE, done = 2, total = 3, title = "Lecture three", url = "https://youtube.com/watch?v=ccc"),
        ),
        var failure: Throwable? = null,
        private val clock: FakeClock = FakeClock(),
    ) : SyncRunSource {
        val emitted = mutableListOf<SyncProgress>()
        var reconcileCalls = 0

        override suspend fun fullReconcile(onProgress: suspend (SyncProgress) -> Unit): SyncReconcileResult {
            reconcileCalls++
            failure?.let { throw it }
            for (p in progress) {
                emitted.add(p)
                onProgress(p)
            }
            return SyncReconcileResult(changedPages = progress.count { it.phase == SyncPhase.PAGE }, lastSyncedAt = clock.now)
        }
    }

    private fun repo(dao: FakeSyncMetaDao, clock: FakeClock, minIntervalMs: Long = 2_000) =
        SyncStatusRepository(dao, { clock.now }, minIntervalMs)

    private fun storedStatus(dao: FakeSyncMetaDao): SyncStatus =
        ScholiastJson.decode<SyncStatus>(dao.rows[SyncStatusRepository.STATUS_KEY]!!.value)

    // --- scheduling constraints (request builders, no WorkManager runtime) ---

    @Test
    fun `periodic request is network-constrained, backed off, at the 15-minute floor`() {
        val request = SyncScheduler.periodicRequest()
        assertEquals(NetworkType.CONNECTED, request.workSpec.constraints.requiredNetworkType)
        assertEquals(BackoffPolicy.EXPONENTIAL, request.workSpec.backoffPolicy)
        assertEquals(30_000L, request.workSpec.backoffDelayDuration)
        assertEquals(
            TimeUnit.MINUTES.toMillis(SyncScheduler.periodicIntervalMinutes()),
            request.workSpec.intervalDuration,
        )
        assertTrue(request.workSpec.isPeriodic)
    }

    @Test
    fun `one-time request is network-constrained with backoff`() {
        val request = SyncScheduler.oneTimeRequest()
        assertEquals(NetworkType.CONNECTED, request.workSpec.constraints.requiredNetworkType)
        assertEquals(BackoffPolicy.EXPONENTIAL, request.workSpec.backoffPolicy)
        assertFalse(request.workSpec.isPeriodic)
    }

    @Test
    fun `work names are unique and stable for dedupe`() {
        val names = SyncScheduler.workNames()
        assertEquals(names.distinct(), names)
        assertTrue(names.contains("sync_periodic"))
        assertTrue(names.contains("sync_now"))
        assertTrue(names.contains("sync_foreground"))
    }

    // --- the run state machine (SyncWorker.runSync) ---

    @Test
    fun `run persists the three forced writes - connecting, first page, terminal`() = runBlocking {
        val clock = FakeClock()
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, clock, minIntervalMs = 0L)
        val engine = FakeEngine(clock = clock)

        SyncWorker.runSync(engine, repository)

        // Progress is ephemeral by design: only the forced writes land (run
        // start, the first page so the count appears, and the terminal state),
        // regardless of the limiter window.
        assertEquals(
            listOf(SyncState.CONNECTING, SyncState.SYNCING, SyncState.IDLE),
            dao.puts.map { ScholiastJson.decode<SyncStatus>(it.value).state },
        )
        // The connecting record carries the connected flag...
        assertTrue(dao.puts.first().value.contains("\"connected\":true"))
        // ...the first-page record carries the run's count (done 0 of 3)...
        val firstPage = ScholiastJson.decode<SyncStatus>(dao.puts[1].value)
        assertEquals(0, firstPage.progress!!.done)
        assertEquals(3, firstPage.progress!!.total)
        // ...and the terminal record carries lastSyncedAt and no progress.
        val terminal = ScholiastJson.decode<SyncStatus>(dao.puts.last().value)
        assertEquals(clock.now, terminal.lastSyncedAt)
        assertNull(terminal.progress)
        // The live flow has settled on the terminal state.
        assertEquals(SyncState.IDLE, repository.status.value.state)
        // The source saw the full order (discovery first, then pages 0..2).
        assertEquals(4, engine.emitted.size)
        assertEquals(SyncPhase.DISCOVERING, engine.emitted[0].phase)
        assertEquals(listOf(0, 1, 2), engine.emitted.drop(1).map { it.done })
    }

    @Test
    fun `per-page progress is persisted rate-limited but first page and terminal always land`() = runBlocking {
        val clock = FakeClock()
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, clock)
        val engine = FakeEngine(clock = clock)

        SyncWorker.runSync(engine, repository)

        // 4 source stages → exactly 3 persisted writes: connecting (forced),
        // first page done==0 (forced), terminal idle (forced). Discovery and
        // pages 1-2 are throttled.
        assertEquals(3, dao.puts.size)
        val stored = storedStatus(dao)
        assertEquals(SyncState.IDLE, stored.state)
        assertEquals(clock.now, stored.lastSyncedAt)
        assertNull(stored.progress)
    }

    @Test
    fun `offline failure records OFFLINE and propagates for retry`() = runBlocking {
        val clock = FakeClock()
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, clock)
        val engine = FakeEngine(failure = SyncOfflineException("no network"), clock = clock)

        val thrown = assertThrows(SyncOfflineException::class.java) {
            runBlocking { SyncWorker.runSync(engine, repository) }
        }
        assertEquals("no network", thrown.message)
        assertEquals(SyncState.OFFLINE, repository.status.value.state)
        assertEquals("no network", repository.status.value.lastError)
        // Terminal state is persisted even though the run failed.
        assertEquals(SyncState.OFFLINE, storedStatus(dao).state)
    }

    @Test
    fun `generic failure records ERROR and propagates for retry`() = runBlocking {
        val clock = FakeClock()
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, clock)
        val engine = FakeEngine(failure = RuntimeException("drive auth expired"), clock = clock)

        assertThrows(RuntimeException::class.java) {
            runBlocking { SyncWorker.runSync(engine, repository) }
        }
        assertEquals(SyncState.ERROR, repository.status.value.state)
        assertEquals("drive auth expired", repository.status.value.lastError)
        assertEquals(SyncState.ERROR, storedStatus(dao).state)
    }

    @Test
    fun `partial page failure records ERROR naming the first failing page`() = runBlocking {
        val clock = FakeClock()
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, clock)
        val engine = FakeEngine(failure = SyncRunException("Sync finished with 1 of 3 pages failing: https://x: boom"), clock = clock)

        assertThrows(SyncRunException::class.java) {
            runBlocking { SyncWorker.runSync(engine, repository) }
        }
        assertEquals(SyncState.ERROR, repository.status.value.state)
        assertTrue(repository.status.value.lastError!!.contains("https://x"))
        assertEquals(SyncState.ERROR, storedStatus(dao).state)
    }

    @Test
    fun `run with a disconnected source is a no-op`() = runBlocking {
        val clock = FakeClock()
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, clock)
        val engine = FakeEngine(connected = false, clock = clock)

        SyncWorker.runSync(engine, repository)

        assertEquals(0, engine.reconcileCalls)
        assertEquals(SyncState.IDLE, repository.status.value.state)
        assertFalse(repository.status.value.connected)
        assertNull(repository.status.value.lastSyncedAt)
        assertEquals(SyncState.IDLE, storedStatus(dao).state)
    }

    @Test
    fun `a run in flight is visible on the run lock - the dedupe predicate`() = runBlocking {
        val clock = FakeClock()
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, clock)
        val engine = FakeEngine(clock = clock)

        assertFalse(SyncGraph.runLock.isLocked)
        val run = async(Dispatchers.IO) {
            SyncGraph.runLock.withLock { SyncWorker.runSync(engine, repository) }
        }
        while (!SyncGraph.runLock.isLocked) yield() // wait for the first run to acquire
        assertTrue(SyncGraph.runLock.isLocked) // doWork would dedupe here
        run.await()
        assertFalse(SyncGraph.runLock.isLocked)
        assertEquals(1, engine.reconcileCalls)
    }
}