package com.scholiast.android.data.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json

/**
 * The app's single `Json` instance for repo-compatible data. Config reproduces
 * what the desktop TypeScript produces via `JSON.stringify`/`JSON.parse`:
 *
 * - `encodeDefaults = true` — fields with default values ARE written when they
 *   are non-null (`notes: []` always appears on a VideoItem, `tombstones` always
 *   appears on a PageRecord — the TS types declare them as required).
 * - `explicitNulls = false` — null fields are omitted, matching TS `undefined`
 *   (optional fields like `frame`, `updatedAt`, `quote` never serialize as null).
 * - `ignoreUnknownKeys = true` — reading is tolerant of additive fields (e.g.
 *   the app's own `ocrText` on a record written by a newer app, or `frame.dataUrl`
 *   on a stale in-memory desktop record).
 *
 * Every data-model round-trip (Room converters, Drive sync, merge, tests) goes
 * through [ScholiastJson], never a hand-rolled `Json { }`.
 */
object ScholiastJson {
    val json: Json = Json {
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = true
    }

    inline fun <reified T> encode(value: T): String = json.encodeToString(value)

    inline fun <reified T> decode(string: String): T = json.decodeFromString(string)
}

/**
 * Encodes [Double] the way JS `JSON.stringify` does, so the app's output is
 * byte-identical to the desktop's for every value that matters: integral values
 * emit as JSON integers (`x2: 1.0` → `"1"`, not `"1.0"`), fractional values as
 * usual (`0.25` → `"0.25"`). `videoTime`, `timeEnd` and every markup coordinate
 * are Doubles in the TS types (`number`), and JSON.parse treats `1` == `1.0`,
 * so any client reads both forms identically — the serializer only makes the
 * written form identical too.
 *
 * Guard rails: values must be finite, integral, and < 1e21 (past that JS itself
 * switches to exponential notation, which kotlinx would render differently).
 * Values outside those rails fall back to plain Double encoding.
 */
object JsDoubleSerializer : KSerializer<Double> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("JsDouble", PrimitiveKind.DOUBLE)

    override fun serialize(encoder: Encoder, value: Double) {
        if (value.isFinite() && value == Math.floor(value) && Math.abs(value) < 1e21) {
            encoder.encodeLong(value.toLong())
        } else {
            encoder.encodeDouble(value)
        }
    }

    override fun deserialize(decoder: Decoder): Double = decoder.decodeDouble()
}