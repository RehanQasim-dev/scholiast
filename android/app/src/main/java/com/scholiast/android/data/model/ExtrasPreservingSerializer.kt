package com.scholiast.android.data.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.buildClassSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject

/**
 * A serializer that preserves unknown JSON fields. The desktop page entities
 * (`Highlight`, `Stroke`, `PageDiagram` in `shared/merge.ts`) carry a TS index
 * signature — `[k: string]: unknown` — and the merge spreads them forward
 * (`{ ...newer, notes }`). Plain kotlinx serialization would drop those fields on
 * a Kotlin round-trip, silently destroying desktop highlight data (xpath, offsets,
 * anchor, groupId, …) the moment the app re-writes a merged page record.
 *
 * This base class keeps the declared fields typed and funnels every unknown key
 * into an `extras: JsonObject` that is re-emitted verbatim on encode:
 *
 * - **serialize** — emits the known fields (built by the subclass), then appends
 *   the `extras` entries untouched (order preserved; `JsonObject` is ordered).
 * - **deserialize** — reads the whole object, extracts the known keys into a
 *   partial object the subclass parses, and collects everything else as `extras`.
 *
 * Only JSON (de)coders are supported — every use in this app is JSON.
 */
abstract class ExtrasPreservingSerializer<T : Any> : KSerializer<T> {

    /** The JSON keys the typed data class models; everything else is "extras". */
    protected abstract val knownKeys: Set<String>

    /** The typed fields rendered as a [JsonObject], in the TS field order. */
    protected abstract fun knownJson(value: T): JsonObject

    /** The preserved unknown fields of [value]. */
    protected abstract fun extrasOf(value: T): JsonObject

    /** Build [T] from the known-key-only object (id is required; others optional). */
    protected abstract fun fromKnown(known: JsonObject): T

    /** [value] with its [extras] replaced by the given ones. */
    protected abstract fun withExtras(value: T, extras: JsonObject): T

    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("Preserved")

    override fun serialize(encoder: Encoder, value: T) {
        val jsonEncoder = encoder as? JsonEncoder
            ?: error("ExtrasPreservingSerializer requires a JSON encoder")
        val merged = buildJsonObject {
            knownJson(value).forEach { (k, v) -> put(k, v) }
            extrasOf(value).forEach { (k, v) -> put(k, v) }
        }
        jsonEncoder.encodeJsonElement(merged)
    }

    override fun deserialize(decoder: Decoder): T {
        val jsonDecoder = decoder as? JsonDecoder
            ?: error("ExtrasPreservingSerializer requires a JSON decoder")
        val root = jsonDecoder.decodeJsonElement().jsonObject
        val known = buildJsonObject {
            for (key in knownKeys) root[key]?.let { put(key, it) }
        }
        return withExtras(fromKnown(known), JsonObject(root.filterKeys { it !in knownKeys }))
    }
}