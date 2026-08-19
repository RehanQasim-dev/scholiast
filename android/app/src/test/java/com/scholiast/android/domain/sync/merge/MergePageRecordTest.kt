package com.scholiast.android.domain.sync.merge

import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoPage
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * GOLDEN tests for the per-page 3-way merge (plan §5.8.3 / task.md acceptance).
 *
 * The fixtures (`merge_page_record_fixtures.json`) are fed VERBATIM to the real
 * TypeScript `mergePageRecord` (`shared/merge.ts`) via node; its output was
 * recorded as `expectedJson` in `merge_page_record_expected.json` (regenerated
 * with node — see the task LOG). The Kotlin port must reproduce it BYTE-FOR-BYTE
 * for the same inputs: this is what makes the app's Drive files interchangeable
 * with the desktop extension's and the Obsidian plugin's.
 */
class MergePageRecordTest {

    private fun resource(name: String): String =
        checkNotNull(javaClass.classLoader?.getResourceAsStream("com/scholiast/android/domain/sync/merge/$name"))
            .readBytes().toString(Charsets.UTF_8)

    @Test
    fun `golden fixtures match the TypeScript merge output byte-for-byte`() {
        val fixtures = ScholiastJson.json
            .parseToJsonElement(resource("merge_page_record_fixtures.json")).jsonObject
        val expected = ScholiastJson.json
            .parseToJsonElement(resource("merge_page_record_expected.json")).jsonObject

        val now = fixtures.getValue("now").jsonPrimitive.content.toLong()
        val fixtureCases = fixtures.getValue("cases").jsonArray
        val expectedCases = expected.getValue("cases").jsonArray
        assertEquals("same number of cases as the TS golden file", fixtureCases.size, expectedCases.size)

        for (i in fixtureCases.indices) {
            val fc = fixtureCases[i].jsonObject
            val ec = expectedCases[i].jsonObject
            val name = fc.getValue("name").jsonPrimitive.content
            val base = decodeNullable(fc.getValue("base"))
            val local = decodeNullable(fc.getValue("local"))
            val remote = decodeNullable(fc.getValue("remote"))
            val expectedJson = ec.getValue("expectedJson").jsonPrimitive.content

            val merged = MergePageRecord.mergePageRecord(base, local, remote, now)
            val actual = ScholiastJson.encode(merged)
            assertEquals("case[$i] \"$name\": Kotlin merge must byte-equal the TS merge", expectedJson, actual)
        }
    }

    private fun decodeNullable(element: kotlinx.serialization.json.JsonElement): VideoPage? =
        if (element is JsonNull) null
        else ScholiastJson.json.decodeFromJsonElement(VideoPage.serializer(), element)
}