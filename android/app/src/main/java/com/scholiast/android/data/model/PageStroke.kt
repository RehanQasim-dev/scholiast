package com.scholiast.android.data.model

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * One freehand stroke inside a page record's `drawings` array. Mirrors the
 * `Stroke` interface in `shared/merge.ts` (`id`, `updatedAt?` plus the
 * `[k: string]: unknown` index signature). The desktop pencil strokes carry extra
 * fields (color, width, points) which are preserved verbatim in [extras].
 */
@Serializable(with = PageStrokeSerializer::class)
data class PageStroke(
    val id: String,
    val updatedAt: Long? = null,
    val extras: JsonObject = JsonObject(emptyMap()),
)

object PageStrokeSerializer : ExtrasPreservingSerializer<PageStroke>() {

    override val knownKeys = setOf("id", "updatedAt")

    override fun knownJson(value: PageStroke) = buildJsonObject {
        put("id", JsonPrimitive(value.id))
        value.updatedAt?.let { put("updatedAt", JsonPrimitive(it)) }
    }

    override fun extrasOf(value: PageStroke) = value.extras

    override fun fromKnown(known: JsonObject): PageStroke = PageStroke(
        id = known["id"]?.jsonPrimitive?.content
            ?: throw SerializationException("PageStroke missing required field 'id'"),
        updatedAt = known["updatedAt"]?.jsonPrimitive?.content?.toLongOrNull(),
    )

    override fun withExtras(value: PageStroke, extras: JsonObject) = value.copy(extras = extras)
}