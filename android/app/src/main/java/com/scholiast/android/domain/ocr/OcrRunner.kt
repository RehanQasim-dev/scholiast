package com.scholiast.android.domain.ocr

import com.scholiast.android.domain.transcribe.TranscriptionError
import com.scholiast.android.domain.transcribe.TranscriptionError.NETWORK
import com.scholiast.android.domain.transcribe.TranscriptionError.RATE_LIMITED
import com.scholiast.android.domain.transcribe.TranscriptionError.SERVER
import com.scholiast.android.ui.frame.OcrHook
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** Severity for [OcrRunner]'s injected logger. */
enum class OcrLogLevel { INFO, WARN }

/**
 * Task 15's implementation of Task 14's [OcrHook] (plan §5.7.3): after a frame
 * item saves, run Gemma OCR on its JPEG asynchronously and store the text.
 *
 * ## Never blocks the frame save
 * Task 14's `FrameCaptureViewModel.save` calls the hook inline, BEFORE it sets
 * the `Saved` state and resumes playback — so a synchronous OCR (a large vision
 * model can take tens of seconds) would hold the UI and the video pause. This
 * runner therefore **launches** the work into an injected [CoroutineScope]
 * (default: SupervisorJob + [Dispatchers.IO] — the app-wide "low priority"
 * pool) and returns `null` immediately. [detached] = false runs inline
 * (tests; future flows that want the result synchronously).
 *
 * ## Quota awareness & retry policy
 * - No Gemma key → [GemmaClient] returns [OcrResult.Skipped] → silent no-op.
 * - Offline ([isOnline]) → logged skip; the item keeps `ocrText = null`
 *   (flashcards can re-run OCR on demand, Task 20).
 * - Transient failures ([NETWORK], [SERVER], [RATE_LIMITED]) → **one retry**,
 *   then log-and-drop — OCR must never loop or fail the save.
 * - Non-transient failures (401/400/…) → log-and-drop immediately.
 *
 * Everything runs in try/catch-free typed results; nothing escapes the
 * detached coroutine (a thrown bug would otherwise crash on the SupervisorJob).
 *
 * ## No Android dependency
 * Logging goes through the injected [log] function (default: no-op) so the
 * class stays pure JVM. The app wiring (Task 19) passes `android.util.Log`
 * — e.g. `{ level, msg -> if (level == WARN) Log.w(TAG, msg) else Log.i(TAG, msg) }`.
 */
class OcrRunner(
    private val client: GemmaClient,
    private val storage: OcrStorage,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
    private val isOnline: suspend () -> Boolean = { true },
    private val detached: Boolean = true,
    private val log: (OcrLogLevel, String) -> Unit = { _, _ -> },
) : OcrHook {

    override suspend fun run(itemId: String, imageFile: File): String? {
        if (!detached) return runInternal(itemId, imageFile)
        scope.launch { runInternal(itemId, imageFile) }
        return null
    }

    private suspend fun runInternal(itemId: String, imageFile: File): String? {
        if (!isOnline()) {
            log(OcrLogLevel.INFO, "OCR skipped for $itemId: offline")
            return null
        }

        val first = client.ocr(imageFile)
        val finalResult = when (first) {
            is OcrResult.Success -> first
            is OcrResult.Skipped -> {
                log(OcrLogLevel.INFO, "OCR skipped for $itemId: ${first.reason}")
                return null
            }
            is OcrResult.Failure -> {
                if (first.error !in TRANSIENT) {
                    log(OcrLogLevel.WARN, "OCR not retried for $itemId (${first.error}): ${first.message}")
                    return null
                }
                log(
                    OcrLogLevel.WARN,
                    "OCR transient failure for $itemId (${first.error}), retrying once: ${first.message}",
                )
                client.ocr(imageFile)
            }
        }

        return when (finalResult) {
            is OcrResult.Success -> {
                val stored = storage.store(itemId, finalResult.text)
                if (!stored) {
                    log(OcrLogLevel.WARN, "OCR text not stored for $itemId (item deleted meanwhile?)")
                    return null
                }
                log(OcrLogLevel.INFO, "OCR stored ${finalResult.text.length} chars for $itemId")
                finalResult.text
            }
            is OcrResult.Skipped -> {
                log(OcrLogLevel.INFO, "OCR skipped on retry for $itemId: ${finalResult.reason}")
                null
            }
            is OcrResult.Failure -> {
                log(OcrLogLevel.WARN, "OCR retry failed for $itemId (${finalResult.error}): ${finalResult.message}")
                null
            }
        }
    }

    companion object {
        /** Failures worth one retry: the request never reached the model or the
         *  provider was temporarily unable. 401/400/UNKNOWN are not retried. */
        private val TRANSIENT = setOf(NETWORK, SERVER, RATE_LIMITED)
    }
}