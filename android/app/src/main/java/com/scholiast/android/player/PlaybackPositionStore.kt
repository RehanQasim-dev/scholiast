package com.scholiast.android.player

import android.content.Context
import android.content.SharedPreferences

/**
 * Persists the user's last playback timestamp per video so that returning to
 * a video (from Home, another video, or app restart) automatically resumes
 * from the exact second they left off.
 */
class PlaybackPositionStore(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * Save the playback position in seconds for [videoId].
     * Clamped to avoid saving initial pre-roll (<2s).
     */
    fun savePosition(videoId: String, seconds: Double) {
        if (videoId.isBlank() || seconds < 2.0) return
        prefs.edit()
            .putFloat(KEY_POS_PREFIX + videoId, seconds.toFloat())
            .putLong(KEY_TIME_PREFIX + videoId, System.currentTimeMillis())
            .apply()
    }

    /**
     * Retrieve the last saved playback position for [videoId], or 0.0 if none.
     */
    fun getPosition(videoId: String): Double {
        if (videoId.isBlank()) return 0.0
        return prefs.getFloat(KEY_POS_PREFIX + videoId, 0f).toDouble()
    }

    /**
     * Remove the stored position for [videoId].
     */
    fun clearPosition(videoId: String) {
        if (videoId.isBlank()) return
        prefs.edit()
            .remove(KEY_POS_PREFIX + videoId)
            .remove(KEY_TIME_PREFIX + videoId)
            .apply()
    }

    companion object {
        private const val PREFS_NAME = "scholiast_playback_positions"
        private const val KEY_POS_PREFIX = "pos_"
        private const val KEY_TIME_PREFIX = "time_"

        @Volatile
        private var instance: PlaybackPositionStore? = null

        fun getInstance(context: Context): PlaybackPositionStore {
            return instance ?: synchronized(this) {
                instance ?: PlaybackPositionStore(context).also { instance = it }
            }
        }
    }
}
