package com.scholiast.android.ui.reader

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scholiast.android.data.prefs.ReaderPrefs
import com.scholiast.android.data.prefs.ReaderSettings

/**
 * The resolved typography for one render pass (plan §6.1: type scale 16→22sp in
 * 5 steps, serif = system serif, max-width narrow/wide).
 * Kept separate from NativeReader so it survives the WebView pivot.
 */
data class ReaderTypography(
    val body: TextUnit,
    val family: FontFamily,
    val maxWidth: Dp,
) {
    companion object {
        fun from(settings: ReaderSettings): ReaderTypography {
            val step = settings.fontStep.coerceIn(ReaderPrefs.MIN_FONT_STEP, ReaderPrefs.MAX_FONT_STEP)
            return ReaderTypography(
                body = (16f + step * 1.5f).sp,
                family = if (settings.serif) FontFamily.Serif else FontFamily.SansSerif,
                maxWidth = if (settings.wideWidth) WIDE_MAX_WIDTH else NARROW_MAX_WIDTH,
            )
        }
    }
}

private val NARROW_MAX_WIDTH = 640.dp
private val WIDE_MAX_WIDTH = 920.dp
