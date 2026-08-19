package com.scholiast.android.domain.sync

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * WorkManager setup for the sync worker (plan §5.8.2 "Scheduling"): a periodic
 * network-constrained full reconcile, a one-off "Sync now", and a one-time run on
 * app foreground. All three use [SyncWorker] and unique names so only one periodic
 * chain and one manual/foreground chain exist.
 *
 * WorkManager's minimum periodic interval is 15 minutes (that's the platform
 * floor, not our choice) — a shorter period is clamped by WorkManager itself.
 * Offline runs return `Result.retry()`: the CONNECTED constraint + exponential
 * backoff reschedule them; the local queue persists, so nothing is lost (§5.10).
 */
object SyncScheduler {

    private const val PERIODIC_WORK_NAME = "sync_periodic"
    private const val SYNC_NOW_WORK_NAME = "sync_now"
    private const val FOREGROUND_WORK_NAME = "sync_foreground"

    /** The periodic cadence — the platform minimum (see class doc). */
    private const val PERIODIC_INTERVAL_MINUTES = 15L

    private const val BACKOFF_INITIAL_SECONDS = 30L

    private val networkConstraint: Constraints
        get() = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

    private fun <B : androidx.work.WorkRequest.Builder<B, W>, W : androidx.work.WorkRequest> B.withBackoff(): B =
        setBackoffCriteria(BackoffPolicy.EXPONENTIAL, BACKOFF_INITIAL_SECONDS, TimeUnit.SECONDS)

    /**
     * Idempotent: schedules (or keeps) the 15-minute full reconcile. Call once at
     * app startup — `KEEP` never duplicates the chain across launches.
     */
    fun schedulePeriodic(context: Context) {
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            PERIODIC_WORK_NAME,
            ExistingPeriodicWorkPolicy.KEEP,
            periodicRequest(),
        )
    }

    /** Settings' **Sync now**: replaces any pending manual run; a running one continues. */
    fun enqueueSyncNow(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            SYNC_NOW_WORK_NAME,
            ExistingWorkPolicy.REPLACE,
            oneTimeRequest(),
        )
    }

    /**
     * App-foreground sync: one-time, deduped against a run already in flight by
     * [SyncWorker.doWork]'s run-lock. `APPEND_OR_REPLACE` queues behind a running
     * chain but never piles up repeated foreground events.
     */
    fun enqueueOnAppForeground(context: Context) {
        WorkManager.getInstance(context).enqueueUniqueWork(
            FOREGROUND_WORK_NAME,
            ExistingWorkPolicy.APPEND_OR_REPLACE,
            oneTimeRequest(),
        )
    }

    // Request builders are exposed so JVM tests can pin the scheduling constraints
    // (network type, backoff, interval) without a WorkManager runtime.
    internal fun periodicRequest(): androidx.work.PeriodicWorkRequest =
        PeriodicWorkRequestBuilder<SyncWorker>(PERIODIC_INTERVAL_MINUTES, TimeUnit.MINUTES)
            .setConstraints(networkConstraint)
            .withBackoff()
            .build()

    internal fun oneTimeRequest(): OneTimeWorkRequest =
        OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(networkConstraint)
            .withBackoff()
            .build()

    /** Test seam: the exact unique names, so tests pin the dedupe identity. */
    fun workNames(): List<String> = listOf(PERIODIC_WORK_NAME, SYNC_NOW_WORK_NAME, FOREGROUND_WORK_NAME)

    /** Test seam: the periodic interval in minutes (platform floor). */
    fun periodicIntervalMinutes(): Long = PERIODIC_INTERVAL_MINUTES
}