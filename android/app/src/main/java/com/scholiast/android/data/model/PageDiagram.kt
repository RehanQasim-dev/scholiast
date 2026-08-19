package com.scholiast.android.data.model

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * A diagram pointer inside a page record's `diagrams` array. Mirrors `PageDiagram`
 * in `shared/merge.ts`: `id`, `updatedAt?`, `driveId?` (rendered PNG blob),
 * `sceneDriveId?` (editable scene JSON) — pointers only, never image or scene
 * bytes. Unknown fields (the desktop's `pasted`, `pageUrl`, …) are preserved in
 * [extras].
 */
@Serializable(with = PageDiagramSerializer::class)
data class PageDiagram(
    val id: String,
    val updatedAt: Long? = null,
    val driveId: String? = null,
    val sceneDriveId: String? = null,
    val extras: JsonObject = JsonObject(emptyMap()),
)

object PageDiagramSerializer : ExtrasPreservingSerializer<PageDiagram>() {

    override val knownKeys = setOf("id", "updatedAt", "driveId", "sceneDriveId")

    override fun knownJson(value: PageDiagram) = buildJsonObject {
        put("id", JsonPrimitive(value.id))
        value.updatedAt?.let { put("updatedAt", JsonPrimitive(it)) }
        value.driveId?.let { put("driveId", JsonPrimitive(it)) }
        value.sceneDriveId?.let { put("sceneDriveId", JsonPrimitive(it)) }
    }

    override fun extrasOf(value: PageDiagram) = value.extras

    override fun fromKnown(known: JsonObject): PageDiagram = PageDiagram(
        id = known["id"]?.jsonPrimitive?.content
            ?: throw SerializationException("PageDiagram missing required field 'id'"),
        updatedAt = known["updatedAt"]?.jsonPrimitive?.content?.toLongOrNull(),
        driveId = known["driveId"]?.jsonPrimitive?.content,
        sceneDriveId = known["sceneDriveId"]?.jsonPrimitive?.content,
    )

    override fun withExtras(value: PageDiagram, extras: JsonObject) = value.copy(extras = extras)
}