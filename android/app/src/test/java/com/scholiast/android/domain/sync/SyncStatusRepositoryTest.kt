package com.scholiast.android.domain.sync

import com.scholiast.android.data.db.SyncMetaDao
import com.scholiast.android.data.db.SyncMetaEntity
import com.scholiast.android.data.model.ScholiastJson
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SyncStatusRepository's state machine + persistence rate limiter — the worker's
 * two pure seams (Task 18 acceptance: state transitions, rate-limited coalescing,
 * emission order). Room is faked via [FakeSyncMetaDao]; time is injected via
 * [FakeClock], so no coroutines-test or Room runtime is needed.
 */
class SyncStatusRepositoryTest {

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

    private fun repo(dao: FakeSyncMetaDao, clock: FakeClock, minIntervalMs: Long = 2_000) =
        SyncStatusRepository(dao, { clock.now }, minIntervalMs)

    // --- PersistRateLimiter (pure) ---

    @Test
    fun `rate limiter coalesces writes within the window`() {
        val clock = FakeClock()
        val limiter = PersistRateLimiter(2_000, { clock.now })
        assertTrue(limiter.shouldPersist(force = false)) // first write never blocked
        assertFalse(limiter.shouldPersist(force = false)) // inside window
        clock.advance(1_000)
        assertFalse(limiter.shouldPersist(force = false))
        clock.advance(1_001) // 2001ms since the last write
        assertTrue(limiter.shouldPersist(force = false))
        assertTrue(limiter.shouldPersist(force = true)) // forced always passes
        assertFalse(limiter.shouldPersist(force = false)) // window refreshed
    }

    @Test
    fun `forced writes pass even back-to-back`() {
        val clock = FakeClock()
        val limiter = PersistRateLimiter(2_000, { clock.now })
        assertTrue(limiter.shouldPersist(force = true))
        assertTrue(limiter.shouldPersist(force = true))
        assertTrue(limiter.shouldPersist(force = true))
    }

    // --- persistence round-trip ---

    @Test
    fun `persist writes the record under the sync_status key`() = runBlocking {
        val clock = FakeClock()
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, clock)
        repository.update { it.copy(state = SyncState.OFFLINE, lastError = "no network") }
        assertTrue(repository.persist(force = true))
        val stored = ScholiastJson.decode<SyncStatus>(dao.rows[SyncStatusRepository.STATUS_KEY]!!.value)
        assertEquals(SyncState.OFFLINE, stored.state)
        assertEquals("no network", stored.lastError)
        assertEquals(clock.now, dao.rows[SyncStatusRepository.STATUS_KEY]!!.updatedAt)
    }

    @Test
    fun `non-forced persist within the window is skipped`() = runBlocking {
        val clock = FakeClock()
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, clock)
        assertTrue(repository.persist(force = false)) // first write passes
        assertFalse(repository.persist(force = false)) // windowed
        clock.advance(2_001)
        assertTrue(repository.persist(force = false))
        assertEquals(2, dao.puts.size)
    }

    // --- load(): process-death recovery ---

    @Test
    fun `load with no record defaults to idle disconnected`() = runBlocking {
        val repository = repo(FakeSyncMetaDao(), FakeClock())
        repository.load()
        assertEquals(SyncState.IDLE, repository.status.value.state)
        assertFalse(repository.status.value.connected)
        assertNull(repository.status.value.lastSyncedAt)
    }

    @Test
    fun `load demotes transient states so the UI never shows a stuck syncing`() = runBlocking {
        val dao = FakeSyncMetaDao()
        dao.put(
            SyncMetaEntity(
                SyncStatusRepository.STATUS_KEY,
                ScholiastJson.encode(
                    SyncStatus(
                        state = SyncState.SYNCING,
                        connected = true,
                        progress = SyncProgress(SyncPhase.PAGE, done = 2, total = 5),
                    ),
                ),
                1L,
            ),
        )
        val repository = repo(dao, FakeClock())
        repository.load()
        assertEquals(SyncState.IDLE, repository.status.value.state)
        assertNull(repository.status.value.progress)
        assertTrue(repository.status.value.connected)
    }

    @Test
    fun `load keeps terminal state and lastSyncedAt`() = runBlocking {
        val dao = FakeSyncMetaDao()
        dao.put(
            SyncMetaEntity(
                SyncStatusRepository.STATUS_KEY,
                ScholiastJson.encode(
                    SyncStatus(state = SyncState.ERROR, lastError = "boom", lastSyncedAt = 42L),
                ),
                1L,
            ),
        )
        val repository = repo(dao, FakeClock())
        repository.load()
        assertEquals(SyncState.ERROR, repository.status.value.state)
        assertEquals("boom", repository.status.value.lastError)
        assertEquals(42L, repository.status.value.lastSyncedAt)
    }

    @Test
    fun `load tolerates a corrupt record`() = runBlocking {
        val dao = FakeSyncMetaDao()
        dao.put(SyncMetaEntity(SyncStatusRepository.STATUS_KEY, "not json at all", 1L))
        val repository = repo(dao, FakeClock())
        repository.load()
        assertEquals(SyncState.IDLE, repository.status.value.state)
    }

    // --- live StateFlow behavior ---

    @Test
    fun `reportProgress drives the run state and clears errors`() {
        val repository = repo(FakeSyncMetaDao(), FakeClock())
        repository.update { it.copy(state = SyncState.ERROR, lastError = "old") }
        repository.reportProgress(SyncProgress(SyncPhase.DISCOVERING))
        assertEquals(SyncState.DISCOVERING, repository.status.value.state)
        assertNull(repository.status.value.lastError)
        repository.reportProgress(SyncProgress(SyncPhase.PAGE, done = 1, total = 4))
        assertEquals(SyncState.SYNCING, repository.status.value.state)
        assertEquals(1, repository.status.value.progress!!.done)
    }

    @Test
    fun `isRunning reflects only in-flight states`() {
        val repository = repo(FakeSyncMetaDao(), FakeClock())
        assertFalse(repository.isRunning())
        repository.update { it.copy(state = SyncState.SYNCING) }
        assertTrue(repository.isRunning())
        repository.update { it.copy(state = SyncState.OFFLINE) }
        assertFalse(repository.isRunning())
        repository.update { it.copy(state = SyncState.ERROR) }
        assertFalse(repository.isRunning())
    }

    @Test
    fun `every state change is persisted in order when the limiter allows`() = runBlocking {
        val dao = FakeSyncMetaDao()
        val repository = repo(dao, FakeClock(), minIntervalMs = 0L)

        repository.update { it.copy(state = SyncState.CONNECTING, connected = true) }
        repository.persist()
        repository.reportProgress(SyncProgress(SyncPhase.DISCOVERING))
        repository.persist()
        repository.reportProgress(SyncProgress(SyncPhase.PAGE, done = 0, total = 2))
        repository.persist()
        repository.reportProgress(SyncProgress(SyncPhase.PAGE, done = 1, total = 2))
        repository.persist()
        repository.update { it.copy(state = SyncState.IDLE, lastSyncedAt = 7L, progress = null) }
        repository.persist()

        // StateFlow conflates for suspended collectors, so the ordered record of
        // a run is the persistence trail, not a flow subscription.
        assertEquals(
            listOf(
                SyncState.CONNECTING, SyncState.DISCOVERING,
                SyncState.SYNCING, SyncState.SYNCING, SyncState.IDLE,
            ),
            dao.puts.map { ScholiastJson.decode<SyncStatus>(it.value).state },
        )
        // The live flow always carries the latest value immediately.
        assertEquals(SyncState.IDLE, repository.status.value.state)
        assertNull(repository.status.value.progress) // terminal state clears the run progress
        assertEquals(7L, repository.status.value.lastSyncedAt)
    }
}