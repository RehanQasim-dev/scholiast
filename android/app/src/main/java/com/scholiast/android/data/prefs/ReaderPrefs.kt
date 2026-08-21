package com.scholiast.android.data.prefs

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.readerDataStore by preferencesDataStore(name = "scholiast_reader")

/** The reader display settings as one immutable snapshot. */
data class ReaderSettings(
    val fontStep: Int = ReaderPrefs.DEFAULT_FONT_STEP,
    val serif: Boolean = false,
    val wideWidth: Boolean = false,
)

/**
 * Reader display preferences (Task 23 contract), in DataStore:
 * `font_step` (Int, clamped to 0..4, default [ReaderPrefs.DEFAULT_FONT_STEP]),
 * `serif` (Boolean, default false), `wide_width` (Boolean, default false).
 */
class ReaderPrefs(private val context: Context) {

    /** Live settings; emits on every change. */
    val settings: Flow<ReaderSettings> = context.readerDataStore.data.map { prefs ->
        ReaderSettings(
            fontStep = (prefs[K_FONT_STEP] ?: DEFAULT_FONT_STEP).coerceIn(MIN_FONT_STEP, MAX_FONT_STEP),
            serif = prefs[K_SERIF] ?: false,
            wideWidth = prefs[K_WIDE_WIDTH] ?: false,
        )
    }

    /** Current settings once. */
    suspend fun load(): ReaderSettings = settings.first()

    /** Set the text-size step (clamped to 0..4). */
    suspend fun setFontStep(step: Int) {
        context.readerDataStore.edit {
            it[K_FONT_STEP] = step.coerceIn(MIN_FONT_STEP, MAX_FONT_STEP)
        }
    }

    suspend fun setSerif(serif: Boolean) {
        context.readerDataStore.edit { it[K_SERIF] = serif }
    }

    suspend fun setWideWidth(wideWidth: Boolean) {
        context.readerDataStore.edit { it[K_WIDE_WIDTH] = wideWidth }
    }

    companion object {
        const val DEFAULT_FONT_STEP: Int = 1
        const val MIN_FONT_STEP: Int = 0
        const val MAX_FONT_STEP: Int = 4

        private val K_FONT_STEP = intPreferencesKey("font_step")
        private val K_SERIF = booleanPreferencesKey("serif")
        private val K_WIDE_WIDTH = booleanPreferencesKey("wide_width")
    }
}
