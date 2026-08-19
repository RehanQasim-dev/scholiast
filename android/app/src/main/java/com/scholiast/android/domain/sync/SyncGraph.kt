package com.scholiast.android.domain.sync

import android.content.Context
import com.scholiast.android.BuildConfig
import com.scholiast.android.data.db.AppDatabase
import com.scholiast.android.domain.sync.drive.AndroidKeyStoreSecretStorage
import com.scholiast.android.domain.sync.drive.DriveOAuth
import com.scholiast.android.domain.sync.drive.KeystoreTokenStore
import com.scholiast.android.domain.sync.drive.OAuthConfig
import com.scholiast.android.domain.sync.drive.OkHttpDriveApi
import com.scholiast.android.domain.sync.drive.SharedPrefsPendingAuthStore
import com.scholiast.android.domain.sync.drive.SyncEngineDriveApi
import com.scholiast.android.ui.frame.FrameStore
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.sync.Mutex
import okhttp3.OkHttpClient

/**
 * The app's tiny service locator (there is no DI framework in this codebase).
 * The worker and the UI must share ONE [SyncStatusRepository] instance so the
 * StateFlow they observe is the same one the worker writes; the sync source is
 * swapped by [wire] (and by tests).
 *
 * - [repository] — cached; first call reads Room.
 * - [engineFactory] — produces a [SyncRunner] over Task 17's [SyncEngine] once
 *   [wire] has run; before that, [UnwiredSyncRunner] makes runs no-op cleanly
 *   (`connected == false`).
 * - [appScope] — process-lifetime scope for the UI bridge's `stateIn`.
 * - [runLock] — held for the duration of a run; the worker checks it first so a
 *   foreground run dedupes against a periodic run already in flight.
 */
object SyncGraph {
    @Volatile
    private var cachedRepository: SyncStatusRepository? = null

    @Volatile
    var engineFactory: (Context) -> SyncRunSource = { UnwiredSyncRunner() }

    /**
     * Build the real sync chain once: Keystore-backed tokens → PKCE OAuth →
     * OkHttp Drive REST → the engine adapter → the reconciler. Idempotent.
     * Called from MainActivity at startup.
     */
    fun wire(context: Context) {
        if (engineFactory(context) !is UnwiredSyncRunner) return
        val appContext = context.applicationContext
        val storage = AndroidKeyStoreSecretStorage(appContext)
        val http = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
        val oauth = DriveOAuth(
            config = OAuthConfig(
                nativeClientId = BuildConfig.OAUTH_CLIENT_ID
                    .ifBlank { OAuthConfig.PLACEHOLDER_CLIENT_ID },
                nativeClientSecret = BuildConfig.OAUTH_CLIENT_SECRET
                    .ifBlank { OAuthConfig.PLACEHOLDER_CLIENT_SECRET },
            ),
            tokenStore = KeystoreTokenStore(storage),
            pendingStore = SharedPrefsPendingAuthStore(appContext),
            httpClient = http,
        )
        val driveApi = OkHttpDriveApi(oauth, http)
        val engineDrive = SyncEngineDriveApi(driveApi)
        val dao = AppDatabase.getInstance(appContext).videoPageDao()
        val pageStore = RoomPageStore(dao)
        val engine = SyncEngine(
            drive = engineDrive,
            pageStore = pageStore,
            frameStore = FrameStore.inFilesDir(appContext.filesDir),
        )
        engineFactory = {
            SyncRunner(
                engine = engine,
                drive = engineDrive,
                pageStore = pageStore,
                isConnected = { storage.get(KeystoreTokenStore.KEY) != null },
            )
        }
    }

    /** Process-lifetime scope; the app has no per-screen DI. */
    val appScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** Held for the duration of a sync run (dedupe + serialization across workers). */
    val runLock: Mutex = Mutex()

    fun repository(context: Context): SyncStatusRepository =
        cachedRepository ?: synchronized(this) {
            cachedRepository ?: SyncStatusRepository(
                dao = AppDatabase.getInstance(context).syncMetaDao(),
            ).also { cachedRepository = it }
        }

    fun clearCacheForTests() {
        cachedRepository = null
    }
}