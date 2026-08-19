package com.scholiast.android.domain.voice.local

import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Model file downloader: streams to `modelsDir/<name>.part`, verifies SHA-256 against the
 * model's pinned checksum, then atomically renames into place. Cancellation of the calling
 * coroutine aborts the download and deletes the partial file.
 *
 * The direct-download URL pattern is `Models.DOWNLOAD_BASE_URL + ggmlFile`
 * (verified from FUTO's `ImportResourceActivity.kt`); as of 2026-08-19 the live site 404s the
 * pinned `*_acft_q8_0.bin` names (see [Models]), so a failed download reports
 * [ModelDownloadResult.Failure] and Settings can fall back to manual import
 * ([ModelFileFile]).
 */
class ModelDownloader(
    private val client: OkHttpClient = defaultClient(),
) {

    /** Progress callback: bytes downloaded so far, total bytes if the server reported them. */
    fun interface Progress {
        fun onProgress(downloadedBytes: Long, totalBytes: Long?)
    }

    sealed interface ModelDownloadResult {
        data class Success(val file: File, val sizeBytes: Long, val checksumVerified: Boolean) : ModelDownloadResult
        sealed interface Failure : ModelDownloadResult {
            data class Network(val message: String, val cause: Exception?) : Failure
            data class ChecksumMismatch(val expected: String, val actual: String) : Failure
            data object Cancelled : Failure
            data object NotFound : Failure
        }
    }

    /** Download [model] into [modelsDir]. Checksum-verified when [model] is a [ModelDownloadable] with a non-blank checksum. */
    suspend fun download(
        model: ModelLoader,
        modelsDir: File,
        progress: Progress = Progress { _, _ -> }
    ): ModelDownloadResult = withContext(Dispatchers.IO) {
        val store = ModelStore(modelsDir)
        val fileName = model.fileName()
        val url = Models.downloadUrlFor(model)
        if (url.isBlank()) {
            return@withContext ModelDownloadResult.Failure.Network("Nothing to download for ${model.name}", null)
        }

        val expectedChecksum = (model as? ModelDownloadable)?.checksum.orEmpty()
        val target = store.modelFile(fileName)
        val partial = store.downloadTarget(fileName)

        val outcome = try {
            val response = client.newCall(Request.Builder().url(url).build()).execute()
            response.use { resp ->
                when {
                    !resp.isSuccessful ->
                        if (resp.code == 404) ModelDownloadResult.Failure.NotFound
                        else ModelDownloadResult.Failure.Network("Server responded ${resp.code}", null)

                    resp.body == null -> ModelDownloadResult.Failure.Network("Empty response body", null)

                    else -> {
                        val body = resp.body!!
                        val total = body.contentLength().takeIf { it >= 0 }
                        val digest = MessageDigest.getInstance("SHA-256")
                        var downloaded = 0L

                        partial.parentFile?.mkdirs()
                        partial.outputStream().use { out ->
                            val buffer = ByteArray(64 * 1024)
                            val source = body.source()
                            while (true) {
                                if (!coroutineContext.isActive) {
                                    throw CancellationException("Model download cancelled")
                                }
                                val n = source.read(buffer, 0, buffer.size)
                                if (n < 0) break
                                out.write(buffer, 0, n)
                                digest.update(buffer, 0, n)
                                downloaded += n
                                progress.onProgress(downloaded, total)
                            }
                        }

                        val actual = digest.digest().joinToString("") { "%02x".format(it) }
                        val verified = actual.equals(expectedChecksum, ignoreCase = true)
                        when {
                            expectedChecksum.isNotBlank() && !verified ->
                                ModelDownloadResult.Failure.ChecksumMismatch(expectedChecksum, actual)

                            !partial.renameTo(target) ->
                                ModelDownloadResult.Failure.Network("Could not move downloaded file into place", null)

                            else -> ModelDownloadResult.Success(target, downloaded, verified)
                        }
                    }
                }
            }
        } catch (e: CancellationException) {
            partial.delete()
            throw e
        } catch (e: Exception) {
            partial.delete()
            ModelDownloadResult.Failure.Network(e.message ?: "Download failed", e)
        }

        outcome
    }

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .followRedirects(true)
            .build()
    }
}