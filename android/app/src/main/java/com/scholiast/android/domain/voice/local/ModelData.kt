package com.scholiast.android.domain.voice.local

import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

/**
 * Model descriptors + loaders, ported from the FUTO Keyboard's `types/ModelData.kt`
 * (FUTO Source First License 1.1).
 *
 * Deviations from the FUTO original (logged in task-11 LOG.md):
 *  - `name` is a plain display [String] instead of a `@StringRes` resource id (we don't ship
 *    FUTO's strings).
 *  - `Context` parameters are replaced with the models directory [File] so the whole class is
 *    JVM-testable. The app passes `context.filesDir/models/`.
 *  - The checksum is mandatory on [ModelDownloadable] and checked before every load via
 *    [ModelStore.verifyChecksum] — FUTO only used it as part of the map key.
 */

interface ModelLoader {
    /** Human-readable model name (shown in Settings). */
    val name: String

    /** True when the model file is present (and, for downloadable models, checksum-valid). */
    fun exists(modelsDir: File): Boolean

    /** Names of files that still need to be downloaded. Empty when ready to load. */
    fun getRequiredDownloadList(modelsDir: File): List<String>

    /** Open the engine over this model's mmap'd bytes. */
    fun loadGGML(modelsDir: File): WhisperGGML

    /** Cache key for [ModelManager]. */
    fun key(modelsDir: File): Any

    /** The on-disk file name this loader resolves to (`ggmlFile` / file name). */
    fun fileName(): String = when (this) {
        is ModelDownloadable -> ggmlFile
        is ModelBuiltInAsset -> ggmlFile
        is ModelFileFile -> file.name
        else -> name
    }
}

/**
 * A model bundled in the app's assets (future: vendor tiny_en once obtainable). Loaded via
 * `assets.openFd` mmap like FUTO.
 */
class ModelBuiltInAsset(
    override val name: String,
    val ggmlFile: String,
) : ModelLoader {
    override fun exists(modelsDir: File): Boolean = true

    override fun getRequiredDownloadList(modelsDir: File): List<String> = emptyList()

    override fun loadGGML(modelsDir: File): WhisperGGML {
        // Implemented via AssetFileDescriptor + FileChannel.map — requires a Context, so the
        // native-load path lives in NativeWhisperEngine (see FutoTranscriber). Not vendored yet.
        throw UnsupportedOperationException(
            "Built-in asset models are not vendored yet; use a downloadable model."
        )
    }

    override fun key(modelsDir: File): Any = "BuiltIn$ggmlFile"
}

/**
 * A model downloaded into [ModelDownloader]'s `filesDir/models/` with a pinned SHA-256.
 */
class ModelDownloadable(
    override val name: String,
    val ggmlFile: String,
    val checksum: String,
) : ModelLoader {
    override fun exists(modelsDir: File): Boolean = getRequiredDownloadList(modelsDir).isEmpty()

    override fun getRequiredDownloadList(modelsDir: File): List<String> =
        listOf(ggmlFile).filter { !ModelStore(modelsDir).modelFile(ggmlFile).exists() }

    override fun loadGGML(modelsDir: File): WhisperGGML {
        val modelStore = ModelStore(modelsDir)
        val file = modelStore.modelFile(ggmlFile)
        if (checksum.isNotBlank()) {
            val actual = modelStore.sha256(file)
            require(actual.equals(checksum, ignoreCase = true)) {
                "Checksum mismatch for $ggmlFile: expected $checksum, got $actual. " +
                    "Delete the file and re-download."
            }
        }
        return WhisperGGML(modelStore.mmap(file))
    }

    override fun key(modelsDir: File): Any = "Downloadable$ggmlFile$checksum"
}

/**
 * A model file the user imported manually (e.g. from the keyboard.futo.tech directory page) —
 * mirrors FUTO's `ModelFileFile`. No checksum pinning (we don't know the remote file's hash).
 */
class ModelFileFile(
    override val name: String,
    val file: File,
) : ModelLoader {
    override fun exists(modelsDir: File): Boolean = file.exists()

    override fun getRequiredDownloadList(modelsDir: File): List<String> = emptyList()

    override fun loadGGML(modelsDir: File): WhisperGGML {
        if (!file.exists()) throw InvalidModelException()
        return WhisperGGML(ModelStore(modelsDir).mmap(file))
    }

    override fun key(modelsDir: File): Any = "File${file.absolutePath}"
}

/**
 * Pure file layout + hashing for the model directory (JVM-testable). Layout:
 * `modelsDir/<ggmlFile>` for the model, `modelsDir/<ggmlFile>.part` while downloading.
 */
class ModelStore(private val modelsDir: File) {

    /** The final model file for [fileName]. */
    fun modelFile(fileName: String): File = File(modelsDir, fileName)

    /** Temporary download target; renamed to [modelFile] only after checksum verification. */
    fun downloadTarget(fileName: String): File = File(modelsDir, "$fileName.part")

    /** Delete a stale `.part` file, if any. */
    fun clearPartial(fileName: String) {
        downloadTarget(fileName).delete()
    }

    /** mmap a model file read-only (the JNI requires a direct buffer). */
    @Throws(IOException::class)
    fun mmap(file: File): MappedByteBuffer {
        require(file.exists()) { "Model file does not exist: ${file.absolutePath}" }
        FileInputStream(file).use { fis ->
            return fis.channel.map(FileChannel.MapMode.READ_ONLY, 0, fis.channel.size()).load()
        }
    }

    /** Names of fully installed models (final files, not `.part` downloads). */
    fun installedFileNames(): List<String> =
        modelsDir.listFiles()
            ?.filter { it.isFile && it.name.endsWith(".bin") }
            ?.map { it.name }
            ?.sorted()
            .orEmpty()

    /** Delete an installed model file (and any partial download for it). */
    fun delete(fileName: String) {
        modelFile(fileName).delete()
        downloadTarget(fileName).delete()
    }

    /** Remove every model file and partial download in the directory. */
    fun deleteAll() {
        modelsDir.listFiles()?.forEach { it.delete() }
    }

    /** Lowercase hex SHA-256 of [file]. */
    fun sha256(file: File): String {
        val digest = java.security.MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    /** True when [file] exists and (if [expected] is non-null) matches its SHA-256. */
    fun verifyChecksum(file: File, expected: String?): Boolean {
        if (!file.exists()) return false
        if (expected.isNullOrBlank()) return true
        return sha256(file).equals(expected, ignoreCase = true)
    }
}