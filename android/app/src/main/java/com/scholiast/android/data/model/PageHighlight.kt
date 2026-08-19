package com.scholiast.android.data.model

import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * One highlight inside a page record's `highlights` array. Mirrors the `Highlight`
 * interface in `shared/merge.ts` (`id`, `updatedAt?`, `notes?`, `color?` plus the
 * `[k: string]: unknown` index signature). The desktop's real highlights carry many
 * more fields (xpath, offsets, content, groupId, anchor, …); they are preserved
 * verbatim in [extras] so the app's sync merge never strips them.
 */
@Serializable(with = PageHighlightSerializer::class)
data class PageHighlight(
    val id: String,
    val updatedAt: Long? = null,
    val notes: List<String>? = null,
    val color: String? = null,
    val extras: JsonObject = JsonObject(emptyMap()),
)

object PageHighlightSerializer : ExtrasPreservingSerializer<PageHighlight>() {

    override val knownKeys = setOf("id", "updatedAt", "notes", "color")

    override fun knownJson(value: PageHighlight) = buildJsonObject {
        put("id", JsonPrimitive(value.id))
        value.updatedAt?.let { put("updatedAt", JsonPrimitive(it)) }
        value.notes?.let { put("notes", JsonArray(it.map(::JsonPrimitive))) }
        value.color?.let { put("color", JsonPrimitive(value.color)) }
    }

    override fun extrasOf(value: PageHighlight) = value.extras

    override fun fromKnown(known: JsonObject): PageHighlight = PageHighlight(
        id = known["id"]?.jsonPrimitive?.content
            ?: throw SerializationException("PageHighlight missing required field 'id'"),
        updatedAt = known["updatedAt"]?.jsonPrimitive?.content?.toLongOrNull(),
        notes = (known["notes"] as? JsonArray)?.map { it.jsonPrimitive.content },
        color = known["color"]?.jsonPrimitive?.content,
    )

    override fun withExtras(value: PageHighlight, extras: JsonObject) = value.copy(extras = extras)
}