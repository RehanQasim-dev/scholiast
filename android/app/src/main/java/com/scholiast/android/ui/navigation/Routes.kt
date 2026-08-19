package com.scholiast.android.ui.navigation

object Routes {
    const val HOME = "home"
    const val PLAYER = "player/{videoId}"
    const val SETTINGS = "settings"
    const val VOICE_EDIT = "voiceEdit"
    const val FRAME = "frame"

    fun player(videoId: String) = "player/$videoId"
}