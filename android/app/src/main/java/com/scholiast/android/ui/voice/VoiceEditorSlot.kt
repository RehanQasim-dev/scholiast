package com.scholiast.android.ui.voice

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.scholiast.android.domain.transcribe.AudioSource
import com.scholiast.android.domain.transcribe.SpeechDependencies
import com.scholiast.android.domain.transcribe.TranscriptionResult
import com.scholiast.android.ui.notes.editor.EditorViewModel
import com.scholiast.android.ui.notes.editor.EditorVoiceSlot
import kotlinx.coroutines.launch

/**
 * The voice-pipeline wiring (Task 10/11 hand-off, now live):
 *
 * Owns the [VoiceRecorderViewModel] for a hosting screen (survives rotation),
 * and routes its samples through [SpeechDependencies]' [com.scholiast.android.domain.transcribe.TranscriberRegistry]:
 * the chosen transcriber (settings preference → Gemini/Groq key → local engine)
 * runs on the recorded floats, and the transcribed text is inserted into the
 * open comment editor via its [EditorViewModel]. The local engine runs the
 * **active STT model** from Settings (`SpeechDependencies.activeLocalModel`).
 *
 * Usage from a screen hosting [com.scholiast.android.ui.notes.editor.CommentEditorSheet]:
 * ```
 * val voice = rememberVoiceEditorSlot()
 * CommentEditorSheet(..., voice = voice.slot, onEditorViewModel = { voice.editorViewModel = it })
 * ```
 * The sheet never sees the recorder or the registry — only [EditorVoiceSlot].
 */
@Composable
fun rememberVoiceEditorSlot(): VoiceEditorSlotUi {
    val context = androidx.compose.ui.platform.LocalContext.current
    val appContext = context.applicationContext
    val scope = rememberCoroutineScope()

    // Owned here so a configuration change keeps the in-flight recording.
    val recorderVm = remember { VoiceRecorderViewModel(appContext as android.app.Application) }
    val state by recorderVm.state.collectAsStateWithLifecycle()
    var editorViewModel by remember { mutableStateOf<EditorViewModel?>(null) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> recorderVm.onPermissionResult(granted) }

    LaunchedEffect(recorderVm) {
        recorderVm.events.collect { event ->
            when (event) {
                VoiceEvent.RequestPermission -> permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                VoiceEvent.OpenAppSettings -> {
                    runCatching {
                        appContext.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                .setData(Uri.fromParts("package", appContext.packageName, null)),
                        )
                    }
                }
                VoiceEvent.AutoStopLimitReached -> Unit
                VoiceEvent.ShowPermissionDenied -> Unit
            }
        }
    }

    // Samples out → transcribe → insert into the open editor.
    LaunchedEffect(recorderVm) {
        recorderVm.onSamplesReady = { samples ->
            scope.launch(kotlinx.coroutines.Dispatchers.Default) {
                try {
                    val registry = SpeechDependencies.registry(appContext)
                    val transcriber = registry.forAddComment()
                    val text = transcriber?.let { t ->
                        val language = SpeechDependencies.settings(appContext).speechLanguage()
                        val result = t.transcribe(AudioSource.FloatSamples(samples), language)
                        (result as? TranscriptionResult.Success)?.text
                    }
                    if (!text.isNullOrBlank()) {
                        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                            editorViewModel?.insertText(text)
                        }
                    }
                } catch (e: Throwable) {
                    android.util.Log.e("VoiceEditorSlot", "Voice transcription failed", e)
                } finally {
                    kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {
                        recorderVm.onTranscriptionDone()
                    }
                }
            }
        }
        recorderVm.onPauseRequested = { /* video pause is the host's job */ }
        recorderVm.onResumeRequested = { /* video resume is the host's job */ }
    }

    val permissionGranted = ContextCompat.checkSelfPermission(
        appContext, Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED

    return remember(recorderVm, state, permissionGranted, editorViewModel) {
        VoiceEditorSlotUi(
            slot = EditorVoiceSlot(
                state = state,
                onToggle = { recorderVm.toggle() },
                onCancel = { recorderVm.cancelRecording() },
                onOpenSettings = {
                    if (permissionGranted) {
                        // Mic in Error state → open the app's settings screen.
                        runCatching {
                            appContext.startActivity(
                                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                    .setData(Uri.fromParts("package", appContext.packageName, null)),
                            )
                        }
                    } else {
                        permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                    }
                },
            ),
            editorViewModel = editorViewModel,
        )
    }
}

/** The bridge's public surface: the [EditorVoiceSlot] for the sheet + the
 *  [EditorViewModel] holder the sheet fills via `onEditorViewModel`. */
class VoiceEditorSlotUi(
    val slot: EditorVoiceSlot,
    var editorViewModel: EditorViewModel?,
)