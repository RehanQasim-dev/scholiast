package com.scholiast.android.ui.reader

import androidx.compose.ui.graphics.Color

fun highlightColor(color: String): Color = when (color) {
    "red" -> Color(0xFFFF5A5A)
    "green" -> Color(0xFF5FE3A0)
    else -> Color(0xFFF9E64D)
}

const val HIGHLIGHT_FILL_ALPHA = 0.32f
