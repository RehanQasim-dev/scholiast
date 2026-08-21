package com.scholiast.android.ui.notes.editor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.FormatListBulleted
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.FormatBold
import androidx.compose.material.icons.filled.FormatItalic
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import com.scholiast.android.ui.theme.TextDisabled

/**
 * The editor's text field (plan §5.4 / §6.4 keyboard-less spec, task 07).
 *
 * **The OS keyboard is strictly opt-in.** Focusing this field NEVER opens the
 * IME — the owning sheet grants IME access by flipping [keyboardAllowed] true
 * and calling [focusRequester] + `LocalSoftwareKeyboardController.show()` from
 * its keyboard icon. This wrapper hides the IME on every focus gain while
 * [keyboardAllowed] is false, so tapping the field (or programmatic focus)
 * only positions the caret; the IME appears only via the keyboard icon.
 *
 * Live `#tag` pills: tags the caret is NOT inside are styled with the pill
 * background/color, mirroring the desktop `refreshTagPills` rule (a tag becomes
 * a pill once the caret leaves it; the token being typed stays plain so the
 * next keystroke isn't trapped). The field stays a plain-text source of truth
 * — the styling is a display-only `AnnotatedString` overlay that round-trips
 * losslessly through [TextFieldValue].
 *
 * @param keyboardAllowed when true the field's next focus gain keeps the IME
 *   (set by the sheet's keyboard icon, reset when the IME actually closes).
 */
@Composable
fun EditorField(
    value: TextFieldValue,
    onValueChange: (TextFieldValue) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "Write a note…",
    focusRequester: FocusRequester = remember { FocusRequester() },
    keyboardAllowed: Boolean = false,
) {
    val keyboardController = LocalSoftwareKeyboardController.current
    val textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface)
    val accent = MaterialTheme.colorScheme.primary

    val caret = if (value.selection.collapsed) value.selection.start else null
    val displayed = remember(value, caret, accent) {
        value.copy(annotatedString = pillTagsAnnotated(value.text, caret, accent))
    }

    BasicTextField(
        value = displayed,
        onValueChange = onValueChange,
        readOnly = !keyboardAllowed,
        modifier = modifier
            .fillMaxWidth()
            .focusRequester(focusRequester)
            .onFocusChanged { state ->
                if (state.isFocused && !keyboardAllowed) keyboardController?.hide()
            },
        textStyle = textStyle,
        cursorBrush = SolidColor(accent),
        decorationBox = { innerTextField ->
            Box {
                if (value.text.isEmpty()) {
                    Text(
                        text = placeholder,
                        style = textStyle,
                        color = TextDisabled,
                    )
                }
                innerTextField()
            }
        },
    )
}

/**
 * The formatting toolbar (plan §5.4): bullet list, checklist, bold, italic,
 * link — the row's left side in the sheet's bottom bar. One command per tap,
 * applied by the owning [EditorViewModel] around the current selection.
 */
@Composable
fun EditorFormatBar(
    onCommand: (EditorCommand) -> Unit,
    onInsertLink: () -> Unit,
    modifier: Modifier = Modifier,
    trailingContent: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FormatIconButton("Bold (Ctrl+B)", Icons.Filled.FormatBold) { onCommand(EditorCommand.BOLD) }
        FormatIconButton("Italic (Ctrl+I)", Icons.Filled.FormatItalic) { onCommand(EditorCommand.ITALIC) }
        FormatIconButton("Inline code", Icons.Filled.Code) { onCommand(EditorCommand.CODE) }
        FormatIconButton(
            "Bullet list",
            Icons.AutoMirrored.Filled.FormatListBulleted,
        ) { onCommand(EditorCommand.BULLET) }
        FormatIconButton("Checklist", Icons.Filled.Checklist) { onCommand(EditorCommand.CHECKLIST) }
        FormatIconButton("Insert link", Icons.Filled.Link) { onInsertLink() }
        trailingContent()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FormatIconButton(label: String, icon: ImageVector, onClick: () -> Unit) {
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        tooltip = {
            PlainTooltip {
                Text(label)
            }
        },
        state = rememberTooltipState(),
    ) {
        IconButton(onClick = onClick, modifier = Modifier.size(44.dp)) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp),
            )
        }
    }
}

/**
 * The display-only pill styling for every `#tag` the caret is not inside.
 * Pure (JVM-testable) — see [EditorField]. [accent] is the theme's primary
 * color, passed in by the composable layer; `Color.Unspecified` styles nothing.
 */
fun pillTagsAnnotated(text: String, caret: Int?, accent: Color = Color.Unspecified): AnnotatedString {
    val builder = AnnotatedString.Builder(text)
    TAG_TOKEN_RE.findAll(text).forEach { m ->
        val tagStart = m.range.first + m.groupValues[1].length
        val tagEnd = m.range.last + 1
        val caretInside = caret != null && caret >= tagStart && caret <= tagEnd
        if (!caretInside) {
            builder.addStyle(
                SpanStyle(
                    background = accent.copy(alpha = 0.15f),
                    color = accent,
                ),
                tagStart,
                tagEnd,
            )
        }
    }
    return builder.toAnnotatedString()
}