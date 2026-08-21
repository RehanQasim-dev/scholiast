package com.scholiast.android.ui.reader

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.DisableSelection
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.scholiast.android.data.model.LinearArticle
import com.scholiast.android.data.model.LinearBlock
import com.scholiast.android.data.prefs.ReaderPrefs
import com.scholiast.android.data.prefs.ReaderSettings
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.TextSecondary

/**
 * The resolved typography for one render pass (plan §6.1: type scale 16→22sp in
 * 5 steps, serif = system serif, max-width narrow/wide).
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

/**
 * The native article renderer (plan §5.3): a LazyColumn of blocks over the
 * [LinearArticle] model from Task 26. No entrance animations (high-frequency
 * rule); the list state is hoisted so the screen can persist scroll and drive
 * the top bar.
 */
@Composable
fun NativeReader(
    article: LinearArticle,
    settings: ReaderSettings,
    listState: LazyListState,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(top = 72.dp, bottom = 96.dp),
    annotation: AnnotationHost? = null,
) {
    val typo = remember(settings) { ReaderTypography.from(settings) }
    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        LazyColumn(
            state = listState,
            contentPadding = contentPadding,
            modifier = Modifier
                .widthIn(max = typo.maxWidth)
                .fillMaxSize(),
        ) {
            itemsIndexed(article.blocks, key = { index, _ -> index }) { index, block ->
                BlockItem(
                    block, typo,
                    if (annotation != null && TEXT_KINDS.contains(block.kind)) index else -1,
                    annotation,
                )
            }
            if (article.truncated) {
                item(key = "truncated") { TruncatedNotice(typo) }
            }
        }

        /* ANNOTATION-SLOT
         * Filled by [annotation] (Task 32 mounting layer): the selection layer,
         * SwatchPill and highlight painting ride on the blocks above; the pill
         * itself floats inside this Box above the list.
         */
        annotation?.Pill()
    }
}

private val TEXT_KINDS = setOf("p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "li")

/**
 * The annotation host Task 32 passes into [NativeReader]: renders painted +
 * selectable text per block and floats the swatch pill. Null → plain reading.
 */
class AnnotationHost(
    val tracker: SelectionTracker,
    val selection: ReaderSelectionState,
    val articleProvider: () -> LinearArticle,
    val highlights: () -> List<com.scholiast.android.data.model.PageHighlight>,
    val onTapHighlight: (HitSpan) -> Unit,
    val onHintRewrite: (List<Rehint>) -> Unit,
    /** Task 33 C6: annotated-path link taps — host opens the browser. */
    val onLinkTap: (String) -> Unit = {},
    val onCommit: () -> Unit,
    val pillVisible: () -> Boolean = { true },
    val pillRect: () -> androidx.compose.ui.geometry.Rect?,
    val onColor: (String) -> Unit,
    val onMic: () -> Unit,
    val onComment: () -> Unit,
    val onPillDismiss: () -> Unit,
) {
    @Composable
    fun Pill() {
        SwatchPill(
            visible = pillVisible() && pillRect() != null,
            anchorRect = pillRect(),
            onColor = onColor,
            onMic = onMic,
            onComment = onComment,
            onDismiss = onPillDismiss,
        )
    }
}

// ----------------------------------------------------------------- blocks

@Composable
private fun BlockItem(
    block: LinearBlock,
    typo: ReaderTypography,
    index: Int = -1,
    annotation: AnnotationHost? = null,
) {
    when (block.kind) {
        "h1" -> Heading(block, typo, scale = 1.9f, top = 22.dp, bottom = 8.dp, index = index, annotation = annotation)
        "h2" -> Heading(block, typo, scale = 1.55f, top = 20.dp, bottom = 7.dp, index = index, annotation = annotation)
        "h3" -> Heading(block, typo, scale = 1.3f, top = 18.dp, bottom = 6.dp, index = index, annotation = annotation)
        "h4" -> Heading(block, typo, scale = 1.15f, top = 16.dp, bottom = 5.dp, index = index, annotation = annotation)
        "h5" -> Heading(block, typo, scale = 1.05f, top = 14.dp, bottom = 4.dp, index = index, annotation = annotation)
        "h6" -> Heading(block, typo, scale = 1f, weight = FontWeight.SemiBold, top = 14.dp, bottom = 4.dp, index = index, annotation = annotation)
        "blockquote" -> Blockquote(block, typo, index, annotation)
        "li" -> ListItemBlock(block, typo, index, annotation)
        "img" -> ImageBlock(block)
        "code" -> CodeBlock(block, typo)
        "figcaption" -> FigCaption(block, typo)
        else -> Paragraph(block, typo, index, annotation) // "p" and any future plain-text kind
    }
}

@Composable
private fun Paragraph(
    block: LinearBlock,
    typo: ReaderTypography,
    index: Int = -1,
    annotation: AnnotationHost? = null,
) {
    LinkedText(
        block = block,
        typo = typo,
        baseStyle = MaterialTheme.typography.bodyLarge.copy(
            fontSize = typo.body,
            fontFamily = typo.family,
            color = MaterialTheme.colorScheme.onSurface,
            lineHeight = typo.body * 1.55f,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 7.dp),
        index = index,
        annotation = annotation,
    )
}

@Composable
private fun Heading(
    block: LinearBlock,
    typo: ReaderTypography,
    scale: Float,
    weight: FontWeight = FontWeight.Bold,
    top: Dp,
    bottom: Dp,
    index: Int = -1,
    annotation: AnnotationHost? = null,
) {
    LinkedText(
        block = block,
        typo = typo,
        baseStyle = MaterialTheme.typography.titleLarge.copy(
            fontSize = typo.body * scale,
            fontFamily = typo.family,
            fontWeight = weight,
            color = MaterialTheme.colorScheme.onSurface,
            lineHeight = typo.body * scale * 1.25f,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 20.dp, top = top, bottom = bottom),
        index = index,
        annotation = annotation,
    )
}

@Composable
private fun Blockquote(
    block: LinearBlock,
    typo: ReaderTypography,
    index: Int = -1,
    annotation: AnnotationHost? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 16.dp, end = 20.dp, top = 8.dp, bottom = 8.dp),
    ) {
        Box(
            modifier = Modifier
                .width(3.dp)
                .height(24.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(MaterialTheme.colorScheme.primary),
        )
        Spacer(Modifier.width(12.dp))
        LinkedText(
            block = block,
            typo = typo,
            baseStyle = MaterialTheme.typography.bodyLarge.copy(
                fontSize = typo.body,
                fontFamily = typo.family,
                fontStyle = FontStyle.Italic,
                color = TextSecondary,
                lineHeight = typo.body * 1.5f,
            ),
            modifier = Modifier.weight(1f),
            index = index,
            annotation = annotation,
        )
    }
}

/** One list item; <ol> items print their number, <ul> items a dot (task 33). */
@Composable
private fun ListItemBlock(
    block: LinearBlock,
    typo: ReaderTypography,
    index: Int = -1,
    annotation: AnnotationHost? = null,
) {
    val marker = block.listOrdinal?.let { "$it." } ?: "•"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 24.dp, end = 20.dp, top = 3.dp, bottom = 3.dp),
    ) {
        Text(
            text = marker,
            style = MaterialTheme.typography.bodyLarge.copy(
                fontSize = typo.body,
                color = TextSecondary,
            ),
            modifier = Modifier.width(if (block.listOrdinal != null) 30.dp else 18.dp),
        )
        LinkedText(
            block = block,
            typo = typo,
            baseStyle = MaterialTheme.typography.bodyLarge.copy(
                fontSize = typo.body,
                fontFamily = typo.family,
                color = MaterialTheme.colorScheme.onSurface,
                lineHeight = typo.body * 1.5f,
            ),
            modifier = Modifier.weight(1f),
            index = index,
            annotation = annotation,
        )
    }
}

@Composable
private fun CodeBlock(block: LinearBlock, typo: ReaderTypography) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 10.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(codeBackground()),
    ) {
        Text(
            text = block.text.trimEnd('\n'),
            style = MaterialTheme.typography.bodySmall.copy(
                fontFamily = FontFamily.Monospace,
                fontSize = typo.body * 0.82f,
                lineHeight = typo.body * 1.25f,
                color = MaterialTheme.colorScheme.onSurface,
            ),
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(14.dp),
        )
    }
}

@Composable
private fun FigCaption(block: LinearBlock, typo: ReaderTypography) {
    Text(
        text = block.text,
        style = MaterialTheme.typography.bodySmall.copy(
            fontSize = typo.body * 0.85f,
            fontFamily = typo.family,
            color = TextSecondary,
        ),
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 32.dp, vertical = 4.dp),
    )
}

@Composable
private fun ImageBlock(block: LinearBlock) {
    val url = block.imgUrl ?: return
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Selection is suppressed here so Task 29's selection layer can never
        // start inside an image (plan §5.4 DisableSelection zones).
        DisableSelection {
            AsyncImage(
                model = url,
                contentDescription = block.imgAlt,
                contentScale = ContentScale.FillWidth,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 140.dp)
                    .clip(RoundedCornerShape(10.dp)),
            )
        }
        if (!block.imgAlt.isNullOrBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = block.imgAlt,
                style = MaterialTheme.typography.labelSmall,
                color = TextSecondary,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun TruncatedNotice(typo: ReaderTypography) {
    Text(
        text = "This article is very long — the rest was left out. Use “Open original” to read it all.",
        style = MaterialTheme.typography.bodySmall.copy(fontSize = typo.body * 0.85f),
        color = TextSecondary,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
    )
}

// ------------------------------------------------------- text + links

/**
 * Renders a block's text. With an [AnnotationHost] (index ≥ 0) it goes through
 * the Task 32 mounting layer: highlight paint + badges, saved-highlight taps,
 * live selection preview and long-press-drag selection. Without one it is the
 * plain reader text: annotation styles as visual spans, tappable links.
 */
@Composable
private fun LinkedText(
    block: LinearBlock,
    typo: ReaderTypography,
    baseStyle: androidx.compose.ui.text.TextStyle,
    modifier: Modifier = Modifier,
    index: Int = -1,
    annotation: AnnotationHost? = null,
) {
    if (annotation != null && index >= 0) {
        ReaderBlockText(
            blockIndex = index,
            block = block,
            article = annotation.articleProvider(),
            tracker = annotation.tracker,
            selection = annotation.selection,
            highlights = annotation.highlights(),
            baseStyle = baseStyle,
            modifier = modifier,
            onLinkTap = annotation.onLinkTap, // task 33 C6: was a no-op `{}`
            onTapHighlight = annotation.onTapHighlight,
            onHintRewrite = annotation.onHintRewrite,
        )
        return
    }
    val uriHandler = LocalUriHandler.current
    val layoutResult = remember { androidx.compose.runtime.mutableStateOf<TextLayoutResult?>(null) }
    Text(
        text = annotatedBlockText(block, linkColor(), codeBackground()),
        style = baseStyle,
        onTextLayout = { layoutResult.value = it },
        modifier = modifier.pointerInput(block) {
            detectTapGestures { position ->
                val layout = layoutResult.value ?: return@detectTapGestures
                val offset = layout.getOffsetForPosition(position)
                val link = block.annotations.firstOrNull {
                    it.kind == "link" && it.target.isNotBlank() &&
                        offset >= it.start && offset < it.end
                } ?: return@detectTapGestures
                runCatching { uriHandler.openUri(link.target) }
            }
        },
    )
}

/** Overlap-safe span building: every annotation adds its own style range. */
private fun annotatedBlockText(block: LinearBlock, linkColor: Color, codeBackground: Color): AnnotatedString =
    buildAnnotatedString {
        append(block.text)
        for (a in block.annotations) {
            when (a.kind) {
                "bold" -> addStyle(SpanStyle(fontWeight = FontWeight.Bold), a.start, a.end)
                "italic" -> addStyle(SpanStyle(fontStyle = FontStyle.Italic), a.start, a.end)
                "code" -> addStyle(
                    SpanStyle(fontFamily = FontFamily.Monospace, background = codeBackground),
                    a.start, a.end,
                )
                "link" -> addStyle(
                    SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline),
                    a.start, a.end,
                )
            }
        }
    }

@Composable
private fun linkColor(): Color = MaterialTheme.colorScheme.primary

@Composable
private fun codeBackground(): Color = Hairline.copy(alpha = 0.45f)
