package com.scholiast.android.ui.frame

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.scholiast.android.data.model.VideoMarkup
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.TextDisabled
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The frame item's thumbnail (Task 14 implementation of Task 06's contract):
 * the JPEG from [FrameStore] with its markup baked on top via the shared
 * [drawMarkupTo] renderer, so a drawn-on frame reads the same here as on the
 * draw surface and on the desktop. Falls back to the placeholder icon while
 * loading or when no store is wired / no file exists.
 *
 * The store comes from [LocalFrameStore] (default null → placeholder), so Task
 * 06's `NoteItemCard` call site (`FrameThumb(itemId, modifier, markup)`) does
 * not need one; the player screen provides it at integration.
 */
val LocalFrameStore = staticCompositionLocalOf<FrameStore?> { null }

@Composable
fun FrameThumb(
    itemId: String,
    modifier: Modifier = Modifier,
    markup: VideoMarkup? = null,
    store: FrameStore? = null,
) {
    val frameStore = store ?: LocalFrameStore.current
    val density = LocalDensity.current.density

    // Load + bake the composite off the main thread; recompose only on change.
    val composite by produceState<Bitmap?>(initialValue = null, itemId, markup) {
        value = withContext(Dispatchers.Default) {
            val frame = frameStore?.loadBitmap(itemId) ?: return@withContext null
            val out = Bitmap.createBitmap(frame.width, frame.height, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(out)
            canvas.drawBitmap(frame, 0f, 0f, null)
            val m = markup
            if (m != null && (m.strokes.isNotEmpty() || m.lines.isNotEmpty() ||
                    m.texts.isNotEmpty() || !m.rects.isNullOrEmpty() || !m.arrows.isNullOrEmpty())
            ) {
                drawMarkupTo(canvas, m, out.width, out.height, density)
            }
            out
        }
    }

    val bitmap = composite
    Surface(
        modifier = modifier
            .fillMaxWidth()
            .height(if (bitmap != null) 96.dp else 72.dp),
        shape = RoundedCornerShape(8.dp),
        color = Hairline,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap.asImageBitmap(),
                contentDescription = "Frame $itemId",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Filled.PhotoCamera,
                    contentDescription = "Frame $itemId",
                    tint = TextDisabled,
                    modifier = Modifier.size(24.dp),
                )
            }
        }
    }
}