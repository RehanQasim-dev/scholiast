package com.scholiast.android.ui.navigation

object Routes {
    const val HOME = "home"
    const val PLAYER = "player/{videoId}"
    const val READER = "reader?url={url}"
    const val SETTINGS = "settings"
    const val VOICE_EDIT = "voiceEdit"
    const val FRAME = "frame"

    fun player(videoId: String) = "player/$videoId"

    /** [url] is percent-encoded — page urls carry `?`/`&` of their own. */
    fun reader(url: String) = "reader?url=${android.net.Uri.encode(url)}"
}