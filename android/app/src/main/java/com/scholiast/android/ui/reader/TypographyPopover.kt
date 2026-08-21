package com.scholiast.android.ui.reader

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.surfaceColorAtElevation
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import com.scholiast.android.data.prefs.ReaderPrefs
import com.scholiast.android.data.prefs.ReaderSettings
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.TextSecondary

/**
 * The typography popover (plan §5.3): A−/A+ across the 5 persisted steps,
 * serif/sans toggle, narrow/wide width. Writes straight through to
 * [ReaderPrefs]; the reader re-renders from the emitted settings.
 */
@Composable
fun TypographyPopover(
    settings: ReaderSettings,
    onDismiss: () -> Unit,
    onFontStep: (Int) -> Unit,
    onSerif: (Boolean) -> Unit,
    onWideWidth: (Boolean) -> Unit,
) {
    Popup(
        alignment = Alignment.TopCenter,
        offset = IntOffset(0, 0),
        onDismissRequest = onDismiss,
        properties = PopupProperties(focusable = true),
    ) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.surfaceColorAtElevation(4.dp),
            border = BorderStroke(1.dp, Hairline),
            tonalElevation = 4.dp,
            shadowElevation = 8.dp,
            modifier = Modifier.padding(top = 120.dp),
        ) {
            Column(
                modifier = Modifier
                    .width(300.dp)
                    .padding(16.dp),
            ) {
                Text(
                    text = "Typography",
                    style = MaterialTheme.typography.labelLarge,
                    color = TextSecondary,
                )
                Spacer(Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    OutlinedButton(
                        onClick = { onFontStep(settings.fontStep - 1) },
                        enabled = settings.fontStep > ReaderPrefs.MIN_FONT_STEP,
                    ) {
                        Text("A−")
                    }
                    Text(
                        // Live preview of the current step.
                        text = "Aa",
                        style = MaterialTheme.typography.titleLarge.copy(
                            fontSize = ReaderTypography.from(settings).body * 1.25f,
                            fontFamily = if (settings.serif) FontFamily.Serif else FontFamily.SansSerif,
                        ),
                    )
                    OutlinedButton(
                        onClick = { onFontStep(settings.fontStep + 1) },
                        enabled = settings.fontStep < ReaderPrefs.MAX_FONT_STEP,
                    ) {
                        Text("A+")
                    }
                }
                Spacer(Modifier.height(6.dp))
                ToggleRow(
                    label = "Serif",
                    checked = settings.serif,
                    onChange = onSerif,
                )
                ToggleRow(
                    label = "Wide width",
                    checked = settings.wideWidth,
                    onChange = onWideWidth,
                )
            }
        }
    }
}

@Composable
private fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text = label, style = MaterialTheme.typography.bodyMedium)
        Switch(checked = checked, onCheckedChange = onChange)
    }
}
