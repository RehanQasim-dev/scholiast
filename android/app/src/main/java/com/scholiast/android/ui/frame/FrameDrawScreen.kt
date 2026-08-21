package com.scholiast.android.ui.frame

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Highlight
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Redo
import androidx.compose.material.icons.filled.Save
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.scholiast.android.data.model.VideoMarkup
import com.scholiast.android.player.CaptureStatus
import com.scholiast.android.player.PlayerViewModel
import com.scholiast.android.ui.theme.Background
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.Surface
import com.scholiast.android.ui.theme.TextSecondary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The full-bleed frame capture flow (plan §5.7, task 14): observes Task 05's
 * [PlayerViewModel.capture] for the capture result, hosts the custom
 * [MarkupView] on a black screen with the toolbar (tool / color / undo / redo /
 * clear / Save / Discard / Comment), and routes saves through
 * [FrameCaptureViewModel.save] (frame + optional comment → `kind:"frame"` item
 * + JPEG file).
 *
 * ## Wiring contract (integration, Task 06/05's player screen)
 * The screen needs the SAME [PlayerViewModel] instance the player screen holds
 * (the bridge result lands on its `capture` StateFlow). `Routes.FRAME` still
 * shows Task 05's placeholder; this composable is called directly with the
 * shared VMs. Exit paths: [onExit] after Save / Discard / a capture failure
 * toast (playback resumes in each — the VM owns that).
 *
 * The comment field is a minimal inline box (Task 07's editor sheet is swapped
 * in at integration; see task LOG.md).
 */
@Composable
fun FrameDrawScreen(
    viewModel: FrameCaptureViewModel,
    player: PlayerViewModel,
    onExit: () -> Unit,
) {
    val state by viewModel.state.collectAsState()
    val capture by player.capture.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    // Self-starting capture: open the screen → capture (no-op once Drawing).
    LaunchedEffect(Unit) {
        if (state is FrameCaptureViewModel.FrameUiState.Idle) viewModel.startCapture()
    }

    // Forward the bridge result into the VM (Task 05's single-listener design:
    // the screen is the observer; the VM holds the flow logic).
    LaunchedEffect(capture.status) {
        when (capture.status) {
            CaptureStatus.SUCCESS -> {
                viewModel.onFrameReady(capture.dataUrl.orEmpty(), capture.width, capture.height)
                player.clearCapture()
            }
            CaptureStatus.FAILED -> {
                viewModel.onFrameFailed(capture.error ?: "capture-unavailable")
                player.clearCapture()
            }
            else -> Unit
        }
    }

    // Terminal states: failure → toast + leave; saved → leave.
    val failed = state as? FrameCaptureViewModel.FrameUiState.Failed
    LaunchedEffect(state) {
        when (state) {
            is FrameCaptureViewModel.FrameUiState.Saved -> {
                viewModel.clear()
                onExit()
            }
            is FrameCaptureViewModel.FrameUiState.Failed -> {
                val message = if (failed?.error == "save-failed") {
                    "Couldn't save the frame"
                } else {
                    "This video can't be captured"
                }
                snackbar.showSnackbar(message)
                viewModel.clear()
                onExit()
            }
            else -> Unit
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Background),
    ) {
        when (val s = state) {
            is FrameCaptureViewModel.FrameUiState.Drawing -> {
                DrawSurface(
                    frame = s.frame,
                    onSave = { jpeg, markup, comment ->
                        scope.launch {
                            viewModel.save(
                                markup = markup,
                                jpeg = jpeg,
                                w = s.frame.w,
                                h = s.frame.h,
                                comment = comment,
                            )
                        }
                    },
                    onDiscard = {
                        scope.launch { viewModel.discard() }
                        onExit()
                    },
                )
            }
            is FrameCaptureViewModel.FrameUiState.Saving -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Saving frame…", color = TextSecondary)
                }
            }
            is FrameCaptureViewModel.FrameUiState.Saved,
            is FrameCaptureViewModel.FrameUiState.Failed,
            is FrameCaptureViewModel.FrameUiState.Idle,
            is FrameCaptureViewModel.FrameUiState.Capturing,
            -> Unit
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }
}

/**
 * The draw stage: the captured frame (decoded from the JPEG data URL) inside
 * [MarkupView], the tool/color/undo/redo/clear toolbar on top, and Save /
 * Comment / Discard at the bottom.
 */
@Composable
private fun DrawSurface(
    frame: FrameCaptureViewModel.CapturedFrame,
    onSave: (ByteArray, VideoMarkup, String?) -> Unit,
    onDiscard: () -> Unit,
) {
    // Decode the JPEG data URL off the main thread (already ≤1280px wide).
    val bitmap by produceState<Bitmap?>(initialValue = null, frame.dataUrl) {
        value = withContext(Dispatchers.Default) {
            decodeJpeg(frame.dataUrl)
        }
    }

    var view by remember { mutableStateOf<MarkupView?>(null) }
    var showComment by remember { mutableStateOf(false) }
    var comment by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Surface)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            ToolIconButton(
                icon = { Icons.Filled.Edit },
                selected = view?.tool == MarkupView.Tool.PENCIL,
                label = "Pencil",
            ) { view?.tool = MarkupView.Tool.PENCIL }
            ToolIconButton(
                icon = { Icons.Filled.Highlight },
                selected = view?.tool == MarkupView.Tool.HIGHLIGHTER,
                label = "Highlighter",
            ) { view?.tool = MarkupView.Tool.HIGHLIGHTER }
            ToolIconButton(
                icon = { Icons.Filled.Backspace },
                selected = view?.tool == MarkupView.Tool.ERASER,
                label = "Eraser",
            ) { view?.tool = MarkupView.Tool.ERASER }

            Spacer(Modifier.width(8.dp))
            FrameColor.entries.forEach { c ->
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clickable { view?.color = c },
                    contentAlignment = Alignment.Center,
                ) {
                    Surface(
                        shape = CircleShape,
                        color = Color(c.argb),
                        modifier = Modifier.size(if (view?.color == c) 26.dp else 22.dp),
                        border = if (view?.color == c) {
                            BorderStroke(2.dp, Color.White)
                        } else {
                            null
                        },
                    ) {}
                }
            }

            Spacer(Modifier.weight(1f))
            IconButton(
                onClick = { view?.undo() },
                enabled = view?.canUndo() == true,
            ) {
                Icon(Icons.Filled.Undo, "Undo", tint = TextSecondary)
            }
            IconButton(
                onClick = { view?.redo() },
                enabled = view?.canRedo() == true,
            ) {
                Icon(Icons.Filled.Redo, "Redo", tint = TextSecondary)
            }
            IconButton(
                onClick = { view?.clearMarkup() },
                enabled = view?.hasMarkup() == true,
            ) {
                Icon(Icons.Filled.DeleteSweep, "Clear", tint = TextSecondary)
            }
        }

        if (bitmap != null) {
            AndroidView(
                factory = { ctx ->
                    MarkupView(ctx, bitmap!!).also { view = it }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .aspectRatio(bitmap!!.width.toFloat() / bitmap!!.height.toFloat()),
            )
        } else {
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                Text("Decoding frame…", color = TextSecondary)
            }
        }

        // Bottom bar: Save (with or without a comment) / Discard.
        Column(
            Modifier
                .fillMaxWidth()
                .background(Surface)
                .padding(horizontal = 16.dp, vertical = 10.dp),
        ) {
            if (showComment) {
                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    placeholder = { Text("Comment on this frame (optional)") },
                    minLines = 1,
                    maxLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = Hairline,
                        focusedTextColor = MaterialTheme.colorScheme.onSurface,
                        unfocusedTextColor = MaterialTheme.colorScheme.onSurface,
                    ),
                )
                Spacer(Modifier.height(8.dp))
            }
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                TextButton(onClick = onDiscard) {
                    Text("Discard", color = MaterialTheme.colorScheme.error)
                }
                TextButton(onClick = { showComment = !showComment }) {
                    Icon(Icons.Filled.PhotoCamera, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Comment")
                }
                Spacer(Modifier.weight(1f))
                FilledTonalIconButton(
                    onClick = {
                        val v = view ?: return@FilledTonalIconButton
                        val jpeg = v.renderComposite() ?: return@FilledTonalIconButton
                        onSave(jpeg, v.currentMarkup(), comment.takeIf { it.isNotBlank() })
                    },
                ) {
                    Icon(Icons.Filled.Save, "Save frame")
                }
                Text("Save", color = TextSecondary)
            }
        }
    }
}

@Composable
private fun ToolIconButton(
    icon: @Composable () -> ImageVector,
    selected: Boolean,
    label: String,
    onClick: () -> Unit,
) {
    val tint = if (selected) MaterialTheme.colorScheme.primary else TextSecondary
    IconButton(onClick = onClick) {
        Icon(icon(), label, tint = tint, modifier = Modifier.size(22.dp))
    }
}

/** Decode a `data:image/jpeg;base64,…` capture payload to a bitmap. */
private fun decodeJpeg(dataUrl: String): Bitmap? {
    val comma = dataUrl.indexOf(',')
    if (comma < 0) return null
    val bytes = try {
        Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
    } catch (e: IllegalArgumentException) {
        return null
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
}