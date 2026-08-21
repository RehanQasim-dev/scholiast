package com.scholiast.android.ui.reader

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.scholiast.android.ui.theme.AccentPurple

/** High-frequency motion (plan §6.5): badge = 120ms scale .95→1 + fade. */
private val BADGE_EASING = CubicBezierEasing(0.23f, 1f, 0.32f, 1f)

/**
 * The inline 💬n comment-count chip painted at a highlight's range end
 * (plan §5.3). Pure state + callbacks; used standalone or as the content of
 * [badgeInlineContent] inside a Text's `inlineContent` map.
 *
 * Enter: scale .95→1 + fade over 120ms (no exit — it lives in text flow).
 * [reducedMotion] drops the transform, keeping only the fade.
 */
@Composable
fun BadgeChip(
    count: Int,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    reducedMotion: Boolean = false,
) {
    val scale = remember { Animatable(if (reducedMotion) 1f else 0.95f) }
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        val spec = tween<Float>(durationMillis = 120, easing = BADGE_EASING)
        if (!reducedMotion) scale.animateTo(1f, spec)
        alpha.animateTo(1f, spec)
    }

    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()

    Box(
        modifier = modifier
            .graphicsLayer {
                // Press feedback rides the same layer as the enter transform.
                scaleX = scale.value * if (pressed) 0.97f else 1f
                scaleY = scaleX
                this.alpha = alpha.value
            }
            .background(
                color = AccentPurple.copy(alpha = 0.18f),
                shape = RoundedCornerShape(6.dp),
            )
            .clickable(interactionSource = interaction, indication = null, onClick = onClick)
            // TalkBack reads this instead of "💬 2" (plan §6.4 a11y sweep).
            .semantics { contentDescription = "$count comments — open comments" }
            .padding(horizontal = 5.dp, vertical = 1.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "💬$count",
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = AccentPurple,
        )
    }
}
