package com.scholiast.android.domain.sync

import kotlinx.serialization.Serializable

/**
 * The persisted `sync_status` record (Room `sync_meta` key [SyncStatusRepository.STATUS_KEY]),
 * mirroring the desktop's `sync_status` in `storage.local`: `{connected, lastSyncedAt?,
 * lastError?, syncing?, progress?}`. The desktop's implicit `syncing` is an explicit
 * [state] here so the worker's state machine (and the UI) can distinguish discovery,
 * per-page work, offline, and failure without re-deriving them.
 *
 * `progress` holds the run in flight (see [SyncProgress]); it is cleared on terminal
 * states so a stale page label never lingers in the UI.
 */
@Serializable
data class SyncStatus(
    val state: SyncState = SyncState.IDLE,
    val connected: Boolean = false,
    /** Wall-clock ms of the last successful full reconcile. */
    val lastSyncedAt: Long? = null,
    /** Human-readable failure reason from the last failed run. */
    val lastError: String? = null,
    val progress: SyncProgress? = null,
) {
    /** True while a run is in flight (the UI shows the progress bar). */
    val isRunning: Boolean
        get() = state == SyncState.CONNECTING ||
            state == SyncState.DISCOVERING ||
            state == SyncState.SYNCING

    /**
     * A record loaded from disk after process death never shows a stuck "Syncing…":
     * transient states demote to IDLE; terminal ones (ERROR/OFFLINE/lastSyncedAt) survive.
     */
    fun demoteTransient(): SyncStatus = when (state) {
        SyncState.CONNECTING, SyncState.DISCOVERING, SyncState.SYNCING -> copy(state = SyncState.IDLE, progress = null)
        else -> this
    }
}

/** Worker state machine: the single source of truth for the UI's chip and card. */
enum class SyncState {
    /** Nothing running, no error. */
    IDLE,

    /** Run starting: checking connectivity / authenticating. */
    CONNECTING,

    /** Listing remote files — no total yet; the UI sweeps an indeterminate bar. */
    DISCOVERING,

    /** Reconciles pages one at a time; done/total valid. */
    SYNCING,

    /** The last run failed (non-network). */
    ERROR,

    /** The last run failed on a network error; the worker will retry. */
    OFFLINE,
}

/** Live progress of the run in flight — mirrors the desktop's `SyncProgress` shape. */
@Serializable
data class SyncProgress(
    val phase: SyncPhase = SyncPhase.DISCOVERING,
    val done: Int = 0,
    val total: Int = 0,
    val title: String? = null,
    val url: String? = null,
)

/** @see SyncPhase in SyncEngine.kt (serialized by name so the record stays readable). */
@Serializable
enum class SyncPhase {
    DISCOVERING,
    PAGE,
}