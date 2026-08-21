package com.scholiast.android

import android.app.Application
import android.os.Build
import android.webkit.WebView

/**
 * Application entry point for Scholiast Android.
 * Sets WebView process directory suffix for multi-process safety.
 */
class ScholiastApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val processName = getProcessName()
            if (packageName != processName) {
                try {
                    WebView.setDataDirectorySuffix(processName)
                } catch (_: IllegalStateException) {
                    // Suffix already initialized
                }
            }
        }
    }
}
