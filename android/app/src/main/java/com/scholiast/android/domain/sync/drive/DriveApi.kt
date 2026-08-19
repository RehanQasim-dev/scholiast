package com.scholiast.android.domain.sync.drive

import com.scholiast.android.domain.sync.DriveApi as SyncDriveApi
import com.scholiast.android.domain.sync.DriveFileMeta as SyncDriveFileMeta
import com.scholiast.android.domain.sync.DriveFilePage as SyncDriveFilePage
import com.scholiast.android.domain.sync.DriveFolder as SyncDriveFolder
import com.scholiast.android.domain.sync.SyncConflictException
import java.io.IOException
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** The three appdata subfolders (mirrors the desktop's `pages/frames/diagrams` layout). */
enum class DriveFolder(val dirName: String) {
    PAGES("pages"),
    FRAMES("frames"),
    DIAGRAMS("diagrams"),
}

/** Metadata of a Drive file — id, name, and the CAS / change-detection revision. */
@Serializable
data class DriveFileMeta(
    val id: String,
    val name: String? = null,
    val headRevisionId: String? = null,
    val modifiedTime: String? = null,
)

/** One page of a folder listing. */
@Serializable
data class DrivePage(
    val files: List<DriveFileMeta> = emptyList(),
    val nextPageToken: String? = null,
)

/** A downloaded blob: raw bytes plus the response's Content-Type. */
data class DriveBlob(val bytes: ByteArray, val mimeType: String)

/** Typed failures of the Drive REST client. */
sealed class DriveException(message: String, cause: Throwable? = null) : Exception(message, cause) {

    /** 401 — the access token was rejected (even after a refresh). */
    class Unauthorized(cause: Throwable? = null) : DriveException("Drive request was unauthorized", cause)

    /** 403 — scope/consent problem (the user revoked access, the scope changed, …). */
    class Forbidden : DriveException("Drive returned 403 (scope/consent problem)")

    /** 404 — the file does not exist (anymore). */
    class NotFound : DriveException("Drive file not found (404)")

    /** 412 — the If-Match CAS failed: the file changed remotely; re-merge and re-PUT. */
    class Conflict : DriveException("Drive returned 412 — the file changed remotely (If-Match CAS failed)")

    /** Any other HTTP error status. */
    class Http(val code: Int, detail: String? = null) :
        DriveException("Drive HTTP $code${detail?.let { ": $it" } ?: ""}")

    /** The transport failed (DNS, refused, timeout). */
    class Network(cause: Throwable? = null) : DriveException("Drive network error", cause)
}

/**
 * The REST surface Task 17's sync engine needs, ported from `src/utils/google-drive.ts`
 * (appdata folder ids, `multipart/related` creates, media PATCH updates with If-Match
 * CAS, `alt=media` reads). JVM-fakeable; [OkHttpDriveApi] is the real client and
 * [SyncEngineDriveApi] adapts it to Task 17's `domain/sync/` interface.
 */
interface DriveApi {

    /** List a folder's files, walking the pagination; the returned token is null. */
    suspend fun listFolder(folder: DriveFolder, pageToken: String? = null): DrivePage

    /** Find one file by exact name inside [folder]; null when absent. */
    suspend fun findInFolder(folder: DriveFolder, name: String): DriveFileMeta?

    /** Create a text file in [folder]; returns its metadata (id + revision). */
    suspend fun createTextFile(folder: DriveFolder, name: String, content: String): DriveFileMeta

    /** Overwrite a file's content; [ifMatchRevision] is the If-Match CAS token. */
    suspend fun updateFile(id: String, content: String, ifMatchRevision: String? = null): DriveFileMeta

    /** Upload a binary blob (frame JPEG / diagram PNG) into [folder]. */
    suspend fun uploadBlob(folder: DriveFolder, name: String, bytes: ByteArray, mimeType: String): DriveFileMeta

    /** Download a text file's raw content. */
    suspend fun downloadText(id: String): String

    /** Download a blob's bytes with its Content-Type. */
    suspend fun downloadBlob(id: String): DriveBlob

    /** Delete a file by id (idempotent — a 404 counts as success). */
    suspend fun deleteFile(id: String)

    /** Delete every root child of appDataFolder; returns how many were deleted. */
    suspend fun wipeAppData(): Int
}

/**
 * OkHttp Drive REST client, ported from `google-drive.ts`. Folder ids are resolved
 * (and cached per instance, like the desktop's session cache) via
 * `name='…' and mimeType='application/vnd.google-apps.folder'`, created on first use.
 * A 401 invalidates the access token and retries once after a silent refresh; any
 * other error maps to a typed [DriveException].
 */
class OkHttpDriveApi(
    private val oauth: DriveOAuth,
    private val httpClient: OkHttpClient,
    private val filesBaseUrl: String = "https://www.googleapis.com/drive/v3/files",
    private val uploadBaseUrl: String = "https://www.googleapis.com/upload/drive/v3/files",
) : DriveApi {

    private val json = Json { ignoreUnknownKeys = true }
    private val folderIdCache = mutableMapOf<DriveFolder, String>()

    // --- Auth wrapper ---------------------------------------------------------------

    private suspend fun authed(request: (token: String) -> Request): Response {
        var response: Response
        var token: String
        try {
            token = oauth.getAccessToken()
            response = execute { request(token) }
        } catch (e: OAuthException) {
            throw e.toDriveException()
        }
        if (response.code == 401) {
            response.close()
            try {
                oauth.invalidateAccessToken()
                token = oauth.getAccessToken()
                response = execute { request(token) }
            } catch (e: OAuthException) {
                throw e.toDriveException()
            }
        }
        return response
    }

    private fun execute(build: () -> Request): Response = try {
        httpClient.newCall(build()).execute()
    } catch (e: IOException) {
        throw DriveException.Network(e)
    }

    private fun OAuthException.toDriveException(): DriveException = when (this) {
        is OAuthException.Network -> DriveException.Network(this)
        is OAuthException.NotConnected -> DriveException.Unauthorized(this)
        is OAuthException.NotConfigured -> DriveException.Unauthorized(this)
        else -> DriveException.Unauthorized(this)
    }

    private fun Response.checkError(): Response {
        if (code in 200..299) return this
        val detail = body?.string().orEmpty().take(200)
        close()
        throw when (code) {
            401 -> DriveException.Unauthorized()
            403 -> DriveException.Forbidden()
            404 -> DriveException.NotFound()
            412 -> DriveException.Conflict()
            else -> DriveException.Http(code, detail.ifBlank { null })
        }
    }

    private inline fun <reified T> Response.parse(): T {
        val body = body?.string().orEmpty()
        return try {
            json.decodeFromString(body)
        } catch (e: Exception) {
            throw DriveException.Http(code, "Malformed response: ${body.take(120)}")
        }
    }

    // --- Folders --------------------------------------------------------------------

    private suspend fun ensureFolder(folder: DriveFolder): String {
        folderIdCache[folder]?.let { return it }
        val url = filesBaseUrl + "?" + params(
            "q" to "name='${folder.dirName}' and mimeType='$FOLDER_MIME' and trashed=false",
            "spaces" to "appDataFolder",
            "fields" to "files(id,name)",
            "pageSize" to "1",
        )
        val response = authed { token -> get(url, token) }
        val page = response.use { it.checkError().parse<DrivePage>() }
        val id = page.files.firstOrNull()?.id
        if (id == null) {
            // Create the folder on first use (mirrors the desktop's ensureFolder).
            val metadata = buildJsonObject {
                put("name", folder.dirName)
                put("mimeType", FOLDER_MIME)
                put("parents", buildJsonArray { add(JsonPrimitive("appDataFolder")) })
            }.toString()
            val created = authed { token ->
                Request.Builder()
                    .url(filesBaseUrl + "?fields=id")
                    .post(metadata.toRequestBody("application/json; charset=UTF-8".toMediaType()))
                    .header("Authorization", "Bearer $token")
                    .build()
            }
            val createdMeta = created.use { it.checkError().parse<DriveFileMeta>() }
            folderIdCache[folder] = createdMeta.id
            return createdMeta.id
        }
        folderIdCache[folder] = id
        return id
    }

    // --- Files ----------------------------------------------------------------------

    override suspend fun listFolder(folder: DriveFolder, pageToken: String?): DrivePage {
        val parent = ensureFolder(folder)
        val files = mutableListOf<DriveFileMeta>()
        var token = pageToken
        while (true) {
            val url = filesBaseUrl + "?" + params(
                "q" to "'$parent' in parents and trashed=false",
                "spaces" to "appDataFolder",
                "fields" to "nextPageToken,files(id,name,modifiedTime,headRevisionId)",
                "pageSize" to "1000",
            ) + (token?.let { "&pageToken=$it" } ?: "")
            val response = authed { t -> get(url, t) }
            val page = response.use { it.checkError().parse<DrivePage>() }
            files += page.files
            token = page.nextPageToken ?: break
        }
        return DrivePage(files = files, nextPageToken = null)
    }

    override suspend fun findInFolder(folder: DriveFolder, name: String): DriveFileMeta? {
        val parent = ensureFolder(folder)
        val url = filesBaseUrl + "?" + params(
            "q" to "'$parent' in parents and name='$name' and trashed=false",
            "spaces" to "appDataFolder",
            "fields" to "files(id,name,modifiedTime,headRevisionId)",
            "pageSize" to "1",
        )
        val response = authed { t -> get(url, t) }
        return response.use { it.checkError().parse<DrivePage>().files.firstOrNull() }
    }

    override suspend fun createTextFile(folder: DriveFolder, name: String, content: String): DriveFileMeta {
        val parent = ensureFolder(folder)
        val metadata = buildJsonObject {
            put("name", name)
            put("parents", buildJsonArray { add(JsonPrimitive(parent)) })
        }.toString()
        val body = MultipartBody.Builder()
            .setType(MULTIPART_RELATED)
            .addPart(metadata.toRequestBody("application/json; charset=UTF-8".toMediaType()))
            .addPart(content.toRequestBody("application/json; charset=UTF-8".toMediaType()))
            .build()
        val response = authed { t ->
            Request.Builder()
                .url(uploadBaseUrl + "?uploadType=multipart&fields=id,name,modifiedTime,headRevisionId")
                .post(body)
                .header("Authorization", "Bearer $t")
                .build()
        }
        return response.use { it.checkError().parse<DriveFileMeta>() }
    }

    override suspend fun updateFile(id: String, content: String, ifMatchRevision: String?): DriveFileMeta {
        val response = authed { t ->
            val builder = Request.Builder()
                .url(uploadBaseUrl + "/$id?uploadType=media&fields=id,name,modifiedTime,headRevisionId")
                .patch(content.toRequestBody("application/json; charset=UTF-8".toMediaType()))
                .header("Authorization", "Bearer $t")
            if (ifMatchRevision != null) builder.header("If-Match", ifMatchRevision)
            builder.build()
        }
        return response.use { it.checkError().parse<DriveFileMeta>() }
    }

    override suspend fun uploadBlob(folder: DriveFolder, name: String, bytes: ByteArray, mimeType: String): DriveFileMeta {
        val parent = ensureFolder(folder)
        val metadata = buildJsonObject {
            put("name", name)
            put("parents", buildJsonArray { add(JsonPrimitive(parent)) })
        }.toString()
        val body = MultipartBody.Builder()
            .setType(MULTIPART_RELATED)
            .addPart(metadata.toRequestBody("application/json; charset=UTF-8".toMediaType()))
            .addPart(bytes.toRequestBody(mimeType.toMediaType()))
            .build()
        val response = authed { t ->
            Request.Builder()
                .url(uploadBaseUrl + "?uploadType=multipart&fields=id,name")
                .post(body)
                .header("Authorization", "Bearer $t")
                .build()
        }
        return response.use { it.checkError().parse<DriveFileMeta>() }
    }

    override suspend fun downloadText(id: String): String {
        val response = authed { t -> get(filesBaseUrl + "/$id?alt=media", t) }
        return response.use { it.checkError().body?.string().orEmpty() }
    }

    override suspend fun downloadBlob(id: String): DriveBlob {
        val response = authed { t -> get(filesBaseUrl + "/$id?alt=media", t) }
        return response.use {
            it.checkError()
            DriveBlob(
                bytes = it.body?.bytes() ?: ByteArray(0),
                mimeType = it.header("Content-Type") ?: "application/octet-stream",
            )
        }
    }

    override suspend fun deleteFile(id: String) {
        val response = authed { t ->
            Request.Builder()
                .url(filesBaseUrl + "/$id")
                .delete()
                .header("Authorization", "Bearer $t")
                .build()
        }
        response.use {
            if (it.code == 404) return // already gone — idempotent
            it.checkError()
        }
    }

    override suspend fun wipeAppData(): Int {
        val ids = mutableListOf<String>()
        var token: String? = null
        while (true) {
            val url = filesBaseUrl + "?" + params(
                "q" to "'appDataFolder' in parents and trashed=false",
                "spaces" to "appDataFolder",
                "fields" to "nextPageToken,files(id)",
                "pageSize" to "1000",
            ) + (token?.let { "&pageToken=$it" } ?: "")
            val response = authed { t -> get(url, t) }
            val page = response.use { it.checkError().parse<DrivePage>() }
            ids += page.files.map { it.id }
            token = page.nextPageToken ?: break
        }
        for (id in ids) deleteFile(id)
        folderIdCache.clear() // the layout is recreated on next use, like the desktop
        return ids.size
    }

    // --- Helpers ---------------------------------------------------------------------

    private fun get(url: String, token: String): Request =
        Request.Builder().url(url).get().header("Authorization", "Bearer $token").build()

    private fun params(vararg pairs: Pair<String, String>): String =
        pairs.joinToString("&") { (k, v) -> "$k=${urlEncode(v)}" }

    private fun urlEncode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")

    private companion object {
        const val FOLDER_MIME = "application/vnd.google-apps.folder"
        val MULTIPART_RELATED = "multipart/related".toMediaType()
    }
}

/**
 * Task 17's [SyncDriveApi] over this package's [DriveApi]. Task 17's `domain/sync/`
 * interface is the engine's contract (defined there per its hand-off note), so this
 * adapter bridges the two: page types, `downloadBlob`'s mimeType wrapper, and the
 * 412 CAS conflict → [SyncConflictException] (the engine's pull → re-merge → re-PUT
 * path). Wire it into `SyncGraph.engineFactory` alongside [SyncEngine].
 */
class SyncEngineDriveApi(private val delegate: DriveApi) : SyncDriveApi {

    override suspend fun listFolder(folder: SyncDriveFolder, pageToken: String?): SyncDriveFilePage {
        val page = delegate.listFolder(toLocal(folder), pageToken)
        return SyncDriveFilePage(files = page.files.map(::toSync), nextPageToken = page.nextPageToken)
    }

    override suspend fun findInFolder(folder: SyncDriveFolder, fileName: String): SyncDriveFileMeta? =
        delegate.findInFolder(toLocal(folder), fileName)?.let(::toSync)

    override suspend fun createTextFile(folder: SyncDriveFolder, fileName: String, content: String): SyncDriveFileMeta =
        toSync(delegate.createTextFile(toLocal(folder), fileName, content))

    override suspend fun updateFile(fileId: String, content: String, ifMatchRevision: String?): SyncDriveFileMeta {
        try {
            return toSync(delegate.updateFile(fileId, content, ifMatchRevision))
        } catch (e: DriveException.Conflict) {
            throw SyncConflictException(e.message ?: "Drive file changed remotely (412)")
        }
    }

    override suspend fun downloadText(fileId: String): String = delegate.downloadText(fileId)

    override suspend fun uploadBlob(folder: SyncDriveFolder, fileName: String, bytes: ByteArray, mimeType: String): SyncDriveFileMeta =
        toSync(delegate.uploadBlob(toLocal(folder), fileName, bytes, mimeType))

    override suspend fun downloadBlob(fileId: String): ByteArray = delegate.downloadBlob(fileId).bytes

    override suspend fun deleteFile(fileId: String) = delegate.deleteFile(fileId)

    override suspend fun wipeAppData(): Int = delegate.wipeAppData()

    private fun toLocal(folder: SyncDriveFolder): DriveFolder = when (folder) {
        SyncDriveFolder.PAGES -> DriveFolder.PAGES
        SyncDriveFolder.FRAMES -> DriveFolder.FRAMES
        SyncDriveFolder.DIAGRAMS -> DriveFolder.DIAGRAMS
    }

    private fun toSync(meta: DriveFileMeta): SyncDriveFileMeta =
        SyncDriveFileMeta(id = meta.id, name = meta.name, headRevisionId = meta.headRevisionId)
}