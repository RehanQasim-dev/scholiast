package com.scholiast.android.ui.sync

import com.scholiast.android.domain.sync.SyncGraph
import com.scholiast.android.domain.sync.SyncState
import com.scholiast.android.domain.sync.SyncStatusRepository
import com.scholiast.android.ui.home.SyncStatus
import com.scholiast.android.ui.home.SyncStatusHolder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * The repository-backed implementation of Task 04's [SyncStatusHolder] seam:
 * maps the worker's [SyncStatusRepository] state into the sealed [SyncStatus]
 * contract Home's chip renders.
 *
 * [set] is a no-op — the worker owns all writes (Task 04's in-memory stub let
 * the UI set status; with a real repository that would fight the worker).
 *
 * Mapping (Home's four states):
 * - not connected → [SyncStatus.Disconnected]
 * - any in-flight state → [SyncStatus.Syncing]
 * - ERROR/OFFLINE → [SyncStatus.Error] (message = lastError)
 * - idle with a lastSyncedAt → [SyncStatus.Synced]; connected-but-never-synced
 *   falls back to [SyncStatus.Disconnected] until the first run lands.
 *
 * Note: Home's chip shows "Syncing…" without the `3/14` count — the richer
 * [SyncStatusChip] here carries the count for Settings (Task 19).
 */
class RepositorySyncStatusHolder(
    repository: SyncStatusRepository,
    scope: CoroutineScope = SyncGraph.appScope,
) : SyncStatusHolder {

    override val status: StateFlow<SyncStatus> = repository.status
        .map { it.toUiStatus() }
        .stateIn(scope, SharingStarted.Eagerly, SyncStatus.Disconnected)

    override fun set(status: SyncStatus) {
        // No-op by design: the sync worker is the only writer of sync status.
    }
}

private fun com.scholiast.android.domain.sync.SyncStatus.toUiStatus(): SyncStatus = when {
    !connected -> SyncStatus.Disconnected
    isRunning -> SyncStatus.Syncing
    state == SyncState.ERROR || state == SyncState.OFFLINE ->
        SyncStatus.Error(lastError ?: if (state == SyncState.OFFLINE) "Offline" else "Sync failed")
    lastSyncedAt != null -> SyncStatus.Synced(lastSyncedAt)
    else -> SyncStatus.Disconnected
}