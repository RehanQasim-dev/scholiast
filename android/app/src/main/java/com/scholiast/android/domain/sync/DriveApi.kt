package com.scholiast.android.domain.sync

/**
 * The narrow Drive REST contract the sync engine consumes — one file per page in
 * the Drive appdata folder, image bytes as separate blobs, compare-and-swap via
 * `If-Match` on the file's `headRevisionId`.
 *
 * HAND-OFF (Task 16): this interface is defined HERE because Task 16's
 * `domain/sync/drive/DriveApi.kt` does not exist in the tree yet. Task 16's
 * `OkHttpDriveApi` must implement this interface (its test already proves the
 * method shapes: `listFolder(DriveFolder)` returning `{files, nextPageToken}`,
 * `findInFolder(folder, name)` → meta or null, `createTextFile(folder, name,
 * content)`, `updateFile(id, content, ifMatchRevision)`, `downloadText(id)`,
 * `uploadBlob(folder, name, bytes, mime)`, `downloadBlob(id)`,
 * `deleteFile(id)`, `wipeAppData()`, `DriveException` with Conflict/Forbidden/
 * NotFound). The engine depends only on this interface; a thin adapter in
 * Task 16's package is all the integration needs.
 */
interface DriveApi {

    /** List a folder's files, one page of results at a time (pagination). */
    suspend fun listFolder(folder: DriveFolder, pageToken: String? = null): DriveFilePage

    /** Find one file by name inside [folder]; null when absent. */
    suspend fun findInFolder(folder: DriveFolder, fileName: String): DriveFileMeta?

    /** Create a text file in [folder]; returns its metadata (id + revision). */
    suspend fun createTextFile(folder: DriveFolder, fileName: String, content: String): DriveFileMeta

    /**
     * Replace a file's content, CAS-guarded: when [ifMatchRevision] is given and
     * the file's current `headRevisionId` differs, the Drive API rejects the
     * write and this throws [SyncConflictException] — the caller re-merges.
     */
    suspend fun updateFile(fileId: String, content: String, ifMatchRevision: String?): DriveFileMeta

    /** Download a text file's raw content. */
    suspend fun downloadText(fileId: String): String

    /** Create a binary blob in [folder]; returns its metadata. */
    suspend fun uploadBlob(folder: DriveFolder, fileName: String, bytes: ByteArray, mimeType: String): DriveFileMeta

    /** Download a binary blob. */
    suspend fun downloadBlob(fileId: String): ByteArray

    /** Delete a file by id. */
    suspend fun deleteFile(fileId: String)

    /** Delete every file in the appdata folder; returns the count. */
    suspend fun wipeAppData(): Int
}

/** The appdata subfolders of the per-page layout (plan §4.5). */
enum class DriveFolder(val path: String) {
    PAGES("pages"),
    FRAMES("frames"),
    DIAGRAMS("diagrams"),
}

/** Metadata of a Drive file — id, name, and the CAS/change-detection revision. */
data class DriveFileMeta(
    val id: String,
    val name: String? = null,
    val headRevisionId: String? = null,
)

/** One page of a folder listing. */
data class DriveFilePage(
    val files: List<DriveFileMeta>,
    val nextPageToken: String? = null,
)

/**
 * Thrown when a CAS write (`If-Match: headRevisionId`) was rejected because the
 * remote file moved (HTTP 412). The engine catches it, pulls the fresh remote,
 * re-merges, and re-PUTs — the task's required 412 → pull → merge → re-PUT path.
 *
 * Task 16 hand-off: Task 16's `DriveException.Conflict` must be mapped to this
 * type by the adapter that implements [DriveApi] (its `updateFile` already
 * throws `DriveException.Conflict` on 412 — see its task test).
 */
class SyncConflictException(message: String) : Exception(message)

/** A page the engine failed to reconcile after its retries (per-page, non-fatal). */
class PageSyncException(val pageUrl: String, message: String) : Exception(message)