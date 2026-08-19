package com.scholiast.android.ui.settings

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scholiast.android.BuildConfig
import com.scholiast.android.data.db.AppDatabase
import com.scholiast.android.domain.sync.SyncGraph
import com.scholiast.android.domain.sync.SyncScheduler
import com.scholiast.android.domain.sync.SyncState
import com.scholiast.android.domain.sync.SyncStatus
import com.scholiast.android.domain.sync.SyncStatusRepository
import com.scholiast.android.domain.sync.drive.AndroidKeyStoreSecretStorage
import com.scholiast.android.domain.sync.drive.CustomTabAuth
import com.scholiast.android.domain.sync.drive.DriveOAuth
import com.scholiast.android.domain.sync.drive.KeystoreTokenStore
import com.scholiast.android.domain.sync.drive.OAuthConfig
import com.scholiast.android.domain.sync.drive.OkHttpDriveApi
import com.scholiast.android.domain.sync.drive.SharedPrefsPendingAuthStore
import com.scholiast.android.domain.transcribe.Service
import com.scholiast.android.domain.transcribe.TranscriberSource
import com.scholiast.android.domain.voice.local.ModelLoader
import com.scholiast.android.domain.voice.local.Models
import com.scholiast.android.domain.voice.local.ModelStore
import com.scholiast.android.ui.frame.FrameStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** UI state for the Settings window (Task 19). */
data class SettingsUiState(
    val loaded: Boolean = false,
    val groqKeySet: Boolean = false,
    val geminiKeySet: Boolean = false,
    val gemmaKeySet: Boolean = false,
    val groqModel: String = "",
    val geminiModel: String = "",
    val gemmaModel: String = "",
    val addCommentPrompt: String = "",
    val editCommentPrompt: String = "",
    val speechLanguage: String? = null,
    val preferredTranscriber: TranscriberSource = TranscriberSource.LOCAL,
    val seekStepSeconds: Int = 15,
    val defaultPlaybackSpeed: Float = 1f,
    val dynamicTheme: Boolean = true,
    val driveConnected: Boolean = false,
    val driveConfigured: Boolean = false,
    val syncing: Boolean = false,
    val syncState: SyncState = SyncState.IDLE,
    val syncDetail: String = "",
    val lastSyncError: String? = null,
    val busy: Boolean = false,
    val message: String? = null,
)

/**
 * Settings window state + actions (Task 19). Owns: speech keys/models/prompts,
 * local STT model download, Drive connect/disconnect + sync, data wipes, and
 * playback/appearance prefs. All persistence goes through [AppSettings]
 * (DataStore + Keystore); Drive goes through the same OAuth chain Task 16
 * built; wipes are real deletions with confirm-at-the-UI-level.
 */
class SettingsViewModel(
    private val app: Context,
    private val settings: AppSettings,
    private val repository: SyncStatusRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    private val oauth = DriveOAuth(
        config = OAuthConfig(
            nativeClientId = BuildConfig.OAUTH_CLIENT_ID.ifBlank { OAuthConfig.PLACEHOLDER_CLIENT_ID },
            nativeClientSecret = BuildConfig.OAUTH_CLIENT_SECRET.ifBlank { OAuthConfig.PLACEHOLDER_CLIENT_SECRET },
        ),
        tokenStore = KeystoreTokenStore(AndroidKeyStoreSecretStorage(app)),
        pendingStore = SharedPrefsPendingAuthStore(app),
        httpClient = OkHttpClientProvider.client,
    )
    private val driveApi = OkHttpDriveApi(oauth, OkHttpClientProvider.client)
    private val tokenStore = KeystoreTokenStore(AndroidKeyStoreSecretStorage(app))
    private val frameStore = FrameStore.inFilesDir(app.filesDir)
    private val modelStoreDir: java.io.File = app.filesDir.resolve("stt_models")
    private val modelStore = ModelStore(modelStoreDir)

    init {
        viewModelScope.launch {
            (settings as? SettingsPrefs)?.load()
            refreshSettings()
            refreshDrive()
            viewModelScope.launch {
                repository.status.collect { status ->
                    _uiState.update {
                        it.copy(
                            syncing = status.state == SyncState.CONNECTING ||
                                status.state == SyncState.DISCOVERING ||
                                status.state == SyncState.SYNCING,
                            syncState = status.state,
                            syncDetail = status.progress?.title ?: "",
                            lastSyncError = status.lastError,
                        )
                    }
                }
            }
        }
    }

    fun refreshSettings() {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    loaded = true,
                    groqKeySet = settings.apiKey(Service.GROQ) != null,
                    geminiKeySet = settings.apiKey(Service.GEMINI) != null,
                    gemmaKeySet = settings.apiKey(Service.GEMMA) != null,
                    groqModel = settings.groqModel(),
                    geminiModel = settings.geminiModel(),
                    gemmaModel = settings.gemmaModel(),
                    addCommentPrompt = settings.addCommentPrompt(),
                    editCommentPrompt = settings.editCommentPrompt(),
                    speechLanguage = settings.speechLanguage(),
                    preferredTranscriber = settings.preferredTranscriber(),
                    seekStepSeconds = settings.seekStepSeconds(),
                    defaultPlaybackSpeed = settings.defaultPlaybackSpeed(),
                    dynamicTheme = settings.dynamicTheme(),
                )
            }
        }
    }

    fun refreshDrive() {
        viewModelScope.launch {
            val configured = oauth.isConfigured()
            val connected = tokenStore.load() != null
            _uiState.update { it.copy(driveConfigured = configured, driveConnected = connected) }
        }
    }

    // ── Speech keys ────────────────────────────────────────────────────────

    fun setGroqKey(key: String?) = saveKey(Service.GROQ, key)
    fun setGeminiKey(key: String?) = saveKey(Service.GEMINI, key)
    fun setGemmaKey(key: String?) = saveKey(Service.GEMMA, key)

    private fun saveKey(service: Service, key: String?) {
        viewModelScope.launch {
            settings.setKey(service, key)
            refreshSettings()
        }
    }

    fun setGroqModel(model: String) = save { settings.setGroqModel(model) }
    fun setGeminiModel(model: String) = save { settings.setGeminiModel(model) }
    fun setGemmaModel(model: String) = save { settings.setGemmaModel(model) }
    fun setAddCommentPrompt(p: String) = save { settings.setAddCommentPrompt(p) }
    fun setEditCommentPrompt(p: String) = save { settings.setEditCommentPrompt(p) }
    fun setSpeechLanguage(lang: String?) = save { settings.setSpeechLanguage(lang) }
    fun setPreferredTranscriber(source: TranscriberSource) = save { settings.setPreferredTranscriber(source) }
    fun setSeekStepSeconds(seconds: Int) = save { settings.setSeekStepSeconds(seconds) }
    fun setDefaultPlaybackSpeed(speed: Float) = save { settings.setDefaultPlaybackSpeed(speed) }
    fun setDynamicTheme(dynamic: Boolean) = save { settings.setDynamicTheme(dynamic) }

    private fun save(block: suspend () -> Unit) {
        viewModelScope.launch { block() }
        refreshSettings()
    }

    // ── Drive ─────────────────────────────────────────────────────────────

    fun connectDrive() {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, message = null) }
            try {
                val pending = oauth.beginAuth()
                CustomTabAuth.launch(app, oauth.buildAuthUrl(pending.verifier, pending.state))
                val redirect = oauth.awaitRedirect(pending.state, OAUTH_REDIRECT_TIMEOUT_MS)
                oauth.complete(redirect, pending)
                _uiState.update { it.copy(busy = false, message = "Connected to Google Drive") }
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, message = e.message ?: "Drive connect failed") }
            }
            refreshDrive()
        }
    }

    fun disconnectDrive() {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, message = null) }
            try {
                oauth.disconnect()
                _uiState.update { it.copy(busy = false, message = "Disconnected from Google Drive") }
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, message = e.message ?: "Disconnect failed") }
            }
            refreshDrive()
        }
    }

    fun syncNow() {
        SyncScheduler.enqueueSyncNow(app)
    }

    fun wipeDriveData() {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, message = null) }
            try {
                val deleted = driveApi.wipeAppData()
                repository.update { SyncStatus() }
                repository.persist(force = true)
                _uiState.update { it.copy(busy = false, message = "Deleted $deleted Drive files") }
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, message = e.message ?: "Drive wipe failed") }
            }
        }
    }

    fun wipeLocalData() {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, message = null) }
            withContext(Dispatchers.IO) {
                val db = AppDatabase.getInstance(app)
                db.videoPageDao().deleteAll()
                db.ocrTextDao().deleteAll()
                db.syncMetaDao().deleteAll()
                frameStore.clearAll()
                modelStore.deleteAll()
            }
            _uiState.update { it.copy(busy = false, message = "All local annotation data deleted") }
        }
    }

    // ── Local STT models ──────────────────────────────────────────────────

    fun installedModels(): List<String> = modelStore.installedFileNames()

    /** Open the FUTO voice-input-models page in the browser (Download button). */
    fun openModelsPage() {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(Models.MODELS_PAGE_URL))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { app.startActivity(intent) }
    }

    /**
     * Import a model file the user picked from the FUTO page (SAF picker):
     * copies the chosen .bin into stt_models under the model's file name.
     */
    fun importModel(model: ModelLoader, uri: Uri) {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, message = null) }
            try {
                val target = modelStore.modelFile(model.fileName())
                withContext(Dispatchers.IO) {
                    app.contentResolver.openInputStream(uri)?.use { input ->
                        target.outputStream().use { output -> input.copyTo(output) }
                    } ?: error("Cannot read the picked file")
                }
                _uiState.update { it.copy(busy = false, message = "${model.name} imported") }
            } catch (e: Exception) {
                _uiState.update { it.copy(busy = false, message = "Import failed: ${e.message}") }
            }
        }
    }

    fun deleteModel(fileName: String) {
        viewModelScope.launch {
            modelStore.delete(fileName)
            _uiState.update { it.copy(message = "$fileName deleted") }
        }
    }

    fun versionName(): String = BuildConfig.VERSION_NAME

    companion object {
        private const val OAUTH_REDIRECT_TIMEOUT_MS = 5 * 60_000L

        fun factory(app: Context): ViewModelProvider.Factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                val settings = SettingsPrefs(app)
                return SettingsViewModel(
                    app = app,
                    settings = settings,
                    repository = SyncGraph.repository(app),
                ) as T
            }
        }
    }
}

/** Small OkHttp builder so Settings and the engine share one client config. */
private object OkHttpClientProvider {
    val client: okhttp3.OkHttpClient = okhttp3.OkHttpClient.Builder()
        .connectTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .build()
}