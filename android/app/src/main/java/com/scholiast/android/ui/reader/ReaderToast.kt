package com.scholiast.android.ui.reader

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.scholiast.android.ui.theme.Hairline
import kotlinx.coroutines.delay

/** Plan §6.5 toast row: rise+fade 200ms in, drop-bottom out. */
private const val TOAST_ANIM_MS = 200

/**
 * Bottom-center toast (Task 31, plan §5.6/§6.5): rise+fade 200ms enter, drop
 * to the bottom on exit; the auto-dismiss timer PAUSES while the toast is
 * touched, so reading time never runs out under a finger. Carries an optional
 * action slot — the Undo used by thread delete / recolor.
 *
 * Pure state + callbacks: [message] null → hidden; a new message restarts the
 * timer. The host places it (e.g. `Align(BottomCenter)` inside its root Box)
 * and owns dismissal via [onDismiss] (timer expiry or action tap).
 *
 * @param message what to show; null hides the toast.
 * @param actionLabel optional action text ("Undo"); requires [onAction].
 * @param onAction invoked when the action is tapped, then the toast dismisses.
 * @param durationMs visible time while NOT touched.
 */
@Composable
fun ReaderToast(
    message: String?,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    durationMs: Long = 4000L,
    onDismiss: () -> Unit = {},
) {
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(
            visible = message != null,
            enter = slideInVertically(tween(TOAST_ANIM_MS)) { it } + fadeIn(tween(TOAST_ANIM_MS)),
            exit = slideOutVertically(tween(TOAST_ANIM_MS)) { it } + fadeOut(tween(TOAST_ANIM_MS)),
        ) {
            val interaction = remember { MutableInteractionSource() }
            val pressed by interaction.collectIsPressedAsState()
            // Timer restarts per message and pauses while touched (pressed in
            // the key restarts the effect; release resumes a fresh window).
            LaunchedEffect(message, pressed) {
                if (message != null && !pressed) {
                    delay(durationMs)
                    onDismiss()
                }
            }
            Surface(
                // Clickable overload so presses register on [interaction]
                // (pausing the timer); the click itself is a deliberate no-op.
                onClick = {},
                interactionSource = interaction,
                shape = RoundedCornerShape(12.dp),
                color = MaterialTheme.colorScheme.inverseSurface,
                contentColor = MaterialTheme.colorScheme.inverseOnSurface,
                shadowElevation = 6.dp,
                border = BorderStroke(1.dp, Hairline),
                modifier = Modifier.padding(bottom = 24.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(start = 16.dp, end = 4.dp),
                ) {
                    Text(
                        text = message.orEmpty(),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(vertical = 12.dp),
                    )
                    if (actionLabel != null && onAction != null) {
                        TextButton(
                            onClick = {
                                onDismiss()
                                onAction()
                            },
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = MaterialTheme.colorScheme.primary,
                            ),
                        ) { Text(actionLabel) }
                    }
                }
            }
        }
    }
}

@Preview(name = "Reader toast", showBackground = true, backgroundColor = 0xFF000000, widthDp = 400, heightDp = 200)
@Composable
private fun ReaderToastPreview() {
    MaterialTheme(colorScheme = darkColorScheme()) {
        Box(Modifier.fillMaxWidth().padding(top = 100.dp)) {
            ReaderToast(
                message = "Thread deleted",
                actionLabel = "Undo",
                onAction = {},
            )
        }
    }
}
