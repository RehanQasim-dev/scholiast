package com.scholiast.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val ScholiastDarkColorScheme = darkColorScheme(
    primary = AccentPurple,
    onPrimary = OnAccent,
    primaryContainer = AccentPurple,
    onPrimaryContainer = TextPrimary,
    secondary = AccentPurple,
    onSecondary = OnAccent,
    tertiary = AccentPurple,
    onTertiary = OnAccent,
    background = Background,
    onBackground = TextPrimary,
    surface = Surface,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceElevated,
    onSurfaceVariant = TextSecondary,
    surfaceContainerLowest = Background,
    surfaceContainerLow = Surface,
    surfaceContainer = Surface,
    surfaceContainerHigh = SurfaceElevated,
    surfaceContainerHighest = SurfaceElevated,
    surfaceTint = AccentPurple,
    outline = Hairline,
    outlineVariant = Hairline,
    error = Danger,
    onError = OnAccent,
    errorContainer = Danger,
    onErrorContainer = TextPrimary,
)

@Composable
fun ScholiastTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val colorScheme =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            dynamicDarkColorScheme(context)
        } else {
            ScholiastDarkColorScheme
        }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = ScholiastTypography,
        shapes = ScholiastShapes,
        content = content,
    )
}