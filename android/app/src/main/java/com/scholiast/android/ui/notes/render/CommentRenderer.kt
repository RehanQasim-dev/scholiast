package com.scholiast.android.ui.notes.render

import androidx.compose.foundation.Image as FoundationImage
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material.icons.filled.Draw
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scholiast.android.ui.theme.AccentPurple
import com.scholiast.android.ui.theme.Hairline
import com.scholiast.android.ui.theme.TextDisabled
import com.scholiast.android.ui.theme.TextSecondary

/**
 * Renders the comment-markdown subset as rich display text, everywhere comments
 * are shown: note threads (Task 06), transcript comments (Task 13), frame
 * comments (Task 14). Ported from the desktop `src/utils/comment-markdown.ts`
 * (the display shape + `toggleTaskInMarkdown`) and `src/utils/video/video-notes.ts`
 * (`renderNoteHtml` + the `<!--image:ID-->`/`<!--diagram:ID-->` markers).
 *
 * Stored form (what syncs, what Task 07's editor writes) is markdown text:
 *   **bold**            *italic*            [text](url)   bare urls   #tag
 *   - item              bullet list
 *   - [ ] item          task list (- [x] when done)
 *   <!--image:ID-->     pasted image        <!--diagram:ID-->  drawn diagram
 *   <!--timestamp:N--><!--edited:M-->       id/version markers (never rendered)
 *
 * Escaping matches the TS: there is no `_` or `\` emphasis and no backslash
 * escapes — a literal `*`, `_` or `\` in prose stays literal unless it forms a
 * valid `**…**` / `*…*` pair. `$…$` LaTeX is deliberately NOT rendered (v1 is
 * plain-text fallback, desktop-only math).
 *
 * The parser is pure Kotlin — `renderComment` returns the [CommentSpans] model
 * with no Android dependency, so it is JVM-testable; [CommentText] turns the
 * model into an `AnnotatedString` with clickable links/tags and inline image
 * chips.
 */
sealed interface CommentInline {
    data class Text(val text: String) : CommentInline

    data class Bold(val content: List<CommentInline>) : CommentInline

    data class Italic(val content: List<CommentInline>) : CommentInline

    data class Link(val label: String, val url: String) : CommentInline

    /** The tag including its leading `#`, e.g. `#lecture/3`. */
    data class Tag(val tag: String) : CommentInline

    data class InlineImage(val id: String, val kind: ImageKind) : CommentInline
}

/** Which binary-image a `<!--image:ID-->` / `<!--diagram:ID-->` marker refers to. */
enum class ImageKind { IMAGE, DIAGRAM }

sealed interface CommentLine {
    data class Paragraph(val content: List<CommentInline>) : CommentLine

    data class BulletItem(val content: List<CommentInline>) : CommentLine

    data class TaskItem(val content: List<CommentInline>, val checked: Boolean) : CommentLine
}

/**
 * The parse result: one entry per source line, plus the edited-marker time when
 * the note carried `<!--edited:M-->` (the caller shows a small "edited" label).
 */
data class CommentSpans(
    val lines: List<CommentLine>,
    val edited: Long? = null,
) {
    val isEmpty: Boolean get() = lines.isEmpty()
}

// --- Markers ----------------------------------------------------------------
// `<!--timestamp:N-->` is the comment's stable id, `<!--edited:M-->` its version.
// Both are metadata, never rendered (they travel with the stored markdown).
private val TIMESTAMP_RE = Regex("""<!--timestamp:(\d+)-->""")
private val EDITED_RE = Regex("""<!--edited:(\d+)-->""")
private val IMAGE_MARKER_RE = Regex("""<!--(image|diagram):([A-Za-z0-9_-]+)-->""")

// --- Inline passes (mirror renderInlineCommentMarkdown in comment-markdown.ts) ---
private val MD_LINK_RE = Regex("""\[([^\]]+)\]\((https?://[^\s)]+)\)""")
private val BARE_URL_RE = Regex("""\bhttps?://[^\s<)]+""")
private val TRAILING_PUNCT_RE = Regex("""[.,;:?!]+$""")
private val BOLD_RE = Regex("""\*\*([^*]+)\*\*""")
private val ITALIC_RE = Regex("""\*([^*\s][^*]*?)\*""")
private val TAG_RE = Regex("""(^|\s)(#[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*)""")

// --- Line structure (mirror parseLines in comment-markdown.ts) ---
private val TASK_RE = Regex("""^\s*[-*]\s+\[([ xX])\]\s*(.*)$""")
private val BULLET_RE = Regex("""^\s*[-*]\s+(?!\[[ xX]\]\s)(.*)$""")
private val TASK_TOGGLE_RE = Regex("""^([ \t]*[-*][ \t]+\[)([ xX])(\])""", RegexOption.MULTILINE)

// Private-use codepoints stand in for parsed atoms while the passes run, exactly
// like the TS `__MDLINK_N__` placeholders (and its math markers). Real comment
// text never contains them.
private const val MARK_OPEN = '\uE000'
private const val MARK_CLOSE = '\uE001'

private enum class RawKind { BOLD, ITALIC }

private sealed class Atom {
    class Direct(val inline: CommentInline) : Atom()

    class Raw(val kind: RawKind, val text: String) : Atom()
}

/**
 * One pass per TS pass, in TS order: image markers, markdown links, bare URLs,
 * bold, italic, tags. Each match becomes an atom referenced by a placeholder, so
 * a later pass can never claim what an earlier one already took — and a bold/
 * italic payload may itself hold link/url/tag atoms (the TS parks links before
 * bold too), which [expand] resolves recursively.
 */
private class InlineParser {
    private val atoms = mutableListOf<Atom>()

    fun parse(text: String): List<CommentInline> {
        var s = text
        s = s.replace(IMAGE_MARKER_RE) { m ->
            val kind = if (m.groupValues[1] == "image") ImageKind.IMAGE else ImageKind.DIAGRAM
            atoms += Atom.Direct(CommentInline.InlineImage(m.groupValues[2], kind))
            mark(atoms.lastIndex)
        }
        s = s.replace(MD_LINK_RE) { m ->
            atoms += Atom.Direct(CommentInline.Link(m.groupValues[1], m.groupValues[2]))
            mark(atoms.lastIndex)
        }
        s = s.replace(BARE_URL_RE) { m ->
            var url = m.value
            var suffix = ""
            val trailing = TRAILING_PUNCT_RE.find(url)
            if (trailing != null) {
                suffix = trailing.value
                url = url.dropLast(suffix.length)
            }
            atoms += Atom.Direct(CommentInline.Link(url, url))
            mark(atoms.lastIndex) + suffix
        }
        s = s.replace(BOLD_RE) { m ->
            atoms += Atom.Raw(RawKind.BOLD, m.groupValues[1])
            mark(atoms.lastIndex)
        }
        s = s.replace(ITALIC_RE) { m ->
            atoms += Atom.Raw(RawKind.ITALIC, m.groupValues[1])
            mark(atoms.lastIndex)
        }
        // The TS runs the tag pass after bold/italic (over the rendered HTML), so
        // a tag inside a bold/italic payload is pilled too — applyTags runs here
        // and again inside each raw payload during expand.
        return expand(applyTags(s))
    }

    private fun applyTags(s: String): String = s.replace(TAG_RE) { m ->
        atoms += Atom.Direct(CommentInline.Tag(m.groupValues[2]))
        m.groupValues[1] + mark(atoms.lastIndex)
    }

    private fun mark(idx: Int): String = "$MARK_OPEN$idx$MARK_CLOSE"

    private fun expand(s: String): List<CommentInline> {
        val out = mutableListOf<CommentInline>()
        var i = 0
        while (i < s.length) {
            if (s[i] == MARK_OPEN) {
                var j = i + 1
                var idx = 0
                while (j < s.length && s[j].isDigit()) {
                    idx = idx * 10 + (s[j] - '0')
                    j++
                }
                val atom = if (j < s.length && s[j] == MARK_CLOSE) atoms.getOrNull(idx) else null
                when (atom) {
                    is Atom.Direct -> out += atom.inline
                    is Atom.Raw -> {
                        val inner = expand(applyTags(atom.text))
                        out += if (atom.kind == RawKind.BOLD) {
                            CommentInline.Bold(inner)
                        } else {
                            CommentInline.Italic(inner)
                        }
                    }
                    null -> out += CommentInline.Text(s.substring(i, if (j < s.length) j + 1 else j))
                }
                i = j + 1
            } else {
                var j = i
                while (j < s.length && s[j] != MARK_OPEN) j++
                out += CommentInline.Text(s.substring(i, j))
                i = j
            }
        }
        return out
    }
}

/**
 * Markdown → [CommentSpans]. Mirrors the TS `parseVideoNote` (markers stripped,
 * text trimmed) plus `commentTextToDisplayHtml`'s line/inline structure. An
 * empty comment renders nothing — it is discarded at save.
 */
fun renderComment(markdown: String): CommentSpans {
    val edited = EDITED_RE.find(markdown)?.groupValues?.get(1)?.toLongOrNull()
    val stripped = markdown
        .replaceFirst(TIMESTAMP_RE, "")
        .replaceFirst(EDITED_RE, "")
        .trim()
    if (stripped.isEmpty()) return CommentSpans(emptyList(), edited)
    val lines = stripped.split('\n').map { raw ->
        val task = TASK_RE.matchEntire(raw)
        if (task != null) {
            CommentLine.TaskItem(
                content = InlineParser().parse(task.groupValues[2]),
                checked = task.groupValues[1].equals("x", ignoreCase = true),
            )
        } else {
            val bullet = BULLET_RE.matchEntire(raw)
            if (bullet != null) {
                CommentLine.BulletItem(InlineParser().parse(bullet.groupValues[1]))
            } else {
                CommentLine.Paragraph(InlineParser().parse(raw))
            }
        }
    }
    return CommentSpans(lines, edited)
}

/**
 * Spans → stored markdown: the inverse of [renderComment], so a comment can be
 * round-tripped. Mirrors `serializeCommentEditor` for the display shape (a bare
 * auto-linked URL serializes back to plain text; a link with a label keeps the
 * `[label](url)` form).
 */
fun CommentSpans.toMarkdown(): String = lines.joinToString("\n") { line ->
    when (line) {
        is CommentLine.Paragraph -> line.content.serializeInlines()
        is CommentLine.BulletItem -> "- " + line.content.serializeInlines()
        is CommentLine.TaskItem -> "- [${if (line.checked) "x" else " "}] " + line.content.serializeInlines()
    }
}

private fun List<CommentInline>.serializeInlines(): String = joinToString("") { inline ->
    when (inline) {
        is CommentInline.Text -> inline.text
        is CommentInline.Bold -> "**" + inline.content.serializeInlines() + "**"
        is CommentInline.Italic -> "*" + inline.content.serializeInlines() + "*"
        is CommentInline.Link -> if (inline.label == inline.url) inline.url else "[${inline.label}](${inline.url})"
        is CommentInline.Tag -> inline.tag
        is CommentInline.InlineImage ->
            if (inline.kind == ImageKind.IMAGE) "<!--image:${inline.id}-->" else "<!--diagram:${inline.id}-->"
    }
}

/**
 * Flip the nth (0-based) task marker in stored markdown — used when a checkbox
 * is ticked in a *rendered* comment. Ported from `toggleTaskInMarkdown` in
 * comment-markdown.ts: only real `- [ ]`/`- [x]` line-start markers count, and
 * out-of-range nths leave the text untouched.
 */
fun toggleTaskInMarkdown(markdown: String, nth: Int): String {
    var seen = 0
    return TASK_TOGGLE_RE.replace(markdown) { m ->
        if (seen++ == nth) {
            val state = m.groupValues[2]
            val flipped = if (state.equals("x", ignoreCase = true)) " " else "x"
            m.groupValues[1] + flipped + m.groupValues[3]
        } else {
            m.value
        }
    }
}

/** Visual style knobs for the annotated-string layer; defaults are the app theme. */
data class CommentTextStyles(
    val linkColor: Color = AccentPurple,
    val linkUnderline: Boolean = true,
    val tagBackground: Color = AccentPurple.copy(alpha = 0.15f),
    val tagTextColor: Color = AccentPurple,
)

/**
 * Inline spans → `AnnotatedString` with bold/italic span styles, clickable links
 * and tag pills ([LinkAnnotation.Clickable]), and inline-content slots for image
 * chips. Pure (JVM-testable); the callbacks are invoked by the composable layer.
 * Links carry their own [TextLinkStyles] (compose 1.9 dropped
 * `TextStyle.linkStyles`).
 */
fun List<CommentInline>.toAnnotatedString(
    styles: CommentTextStyles = CommentTextStyles(),
    onOpenLink: (String) -> Unit = {},
    onTapTag: (String) -> Unit = {},
): AnnotatedString {
    val builder = AnnotatedString.Builder()
    appendInlines(builder, this, styles, onOpenLink, onTapTag)
    return builder.toAnnotatedString()
}

private fun appendInlines(
    builder: AnnotatedString.Builder,
    content: List<CommentInline>,
    styles: CommentTextStyles,
    onOpenLink: (String) -> Unit,
    onTapTag: (String) -> Unit,
) {
    for (inline in content) when (inline) {
        is CommentInline.Text -> builder.append(inline.text)
        is CommentInline.Bold -> {
            builder.pushStyle(SpanStyle(fontWeight = FontWeight.Bold))
            appendInlines(builder, inline.content, styles, onOpenLink, onTapTag)
            builder.pop()
        }
        is CommentInline.Italic -> {
            builder.pushStyle(SpanStyle(fontStyle = FontStyle.Italic))
            appendInlines(builder, inline.content, styles, onOpenLink, onTapTag)
            builder.pop()
        }
        is CommentInline.Link -> {
            builder.pushStyle(SpanStyle(color = styles.linkColor))
            builder.pushLink(
                LinkAnnotation.Clickable(
                    tag = inline.url,
                    styles = TextLinkStyles(
                        style = SpanStyle(
                            textDecoration = if (styles.linkUnderline) TextDecoration.Underline else TextDecoration.None,
                        ),
                    ),
                    linkInteractionListener = { onOpenLink(inline.url) },
                ),
            )
            builder.append(inline.label)
            builder.pop()
            builder.pop()
        }
        is CommentInline.Tag -> {
            builder.pushStyle(SpanStyle(background = styles.tagBackground, color = styles.tagTextColor))
            builder.pushLink(
                LinkAnnotation.Clickable(
                    tag = inline.tag,
                    styles = TextLinkStyles(style = SpanStyle()),
                    linkInteractionListener = { onTapTag(inline.tag) },
                ),
            )
            builder.append(inline.tag)
            builder.pop()
            builder.pop()
        }
        is CommentInline.InlineImage -> builder.appendInlineContent(
            inlineContentId(inline),
            if (inline.kind == ImageKind.IMAGE) "Pasted image" else "Diagram",
        )
    }
}

/** The `inlineContent` map key for an image chip, shared by builder and composable. */
internal fun inlineContentId(image: CommentInline.InlineImage): String =
    "scholiast:${image.kind.name.lowercase()}:${image.id}"

private fun collectImages(content: List<CommentInline>, out: MutableList<CommentInline.InlineImage>) {
    for (inline in content) when (inline) {
        is CommentInline.InlineImage -> out += inline
        is CommentInline.Bold -> collectImages(inline.content, out)
        is CommentInline.Italic -> collectImages(inline.content, out)
        else -> {}
    }
}

/**
 * Resolves a pasted-image / diagram id to its pixels. The stores are owned by
 * Task 14 (frames) / Task 16 (Drive); the renderer only ever asks through this
 * interface — null means "show the placeholder icon".
 */
fun interface CommentImageResolver {
    fun resolve(id: String): ImageBitmap?
}

/**
 * One comment body: bold/italic/links/bare URLs/`#tag` pills/checklists/images,
 * with an "edited" label when the note carries `<!--edited:M-->`. Empty text
 * renders nothing (empty comments are discarded at save). Pure renderer +
 * injected callbacks — no repository or network access.
 *
 * @param markdown the note text; `<!--timestamp:N-->`/`<!--edited:M-->` markers
 *   are tolerated and never rendered.
 * @param onOpenLink called with the URL when a link is tapped.
 * @param onToggleTask called with the rewritten markdown when a checkbox is
 *   ticked (`- [ ]` ↔ `- [x]`) — the caller persists it.
 * @param onTapTag optional tag-filter callback (v1.1 nicety); null → tags are
 *   still pill-styled but not tappable.
 * @param imageResolver optional `<!--image:ID-->`/`<!--diagram:ID-->` resolver;
 *   null → placeholder chips.
 * @param onOpenImage optional full-image opener for chip taps.
 */
@Composable
fun CommentText(
    markdown: String,
    onOpenLink: (String) -> Unit,
    onToggleTask: (String) -> Unit,
    onTapTag: ((String) -> Unit)? = null,
    imageResolver: CommentImageResolver? = null,
    onOpenImage: ((id: String, kind: ImageKind) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val spans = remember(markdown) { renderComment(markdown) }
    Column(modifier) {
        var taskNth = -1
        for (line in spans.lines) {
            when (line) {
                is CommentLine.Paragraph -> if (line.content.isNotEmpty()) InlineText(
                    line.content, onOpenLink, onTapTag, imageResolver, onOpenImage,
                )
                is CommentLine.BulletItem -> Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Top,
                ) {
                    Text("•", style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
                    Spacer(Modifier.width(8.dp))
                    InlineText(
                        line.content, onOpenLink, onTapTag, imageResolver, onOpenImage,
                        Modifier.weight(1f),
                    )
                }
                is CommentLine.TaskItem -> {
                    taskNth += 1
                    val nth = taskNth
                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = if (line.checked) Icons.Filled.CheckBox else Icons.Filled.CheckBoxOutlineBlank,
                            contentDescription = if (line.checked) "Mark task not done" else "Mark task done",
                            tint = if (line.checked) AccentPurple else TextDisabled,
                            modifier = Modifier
                                .size(18.dp)
                                .clickable { onToggleTask(toggleTaskInMarkdown(markdown, nth)) },
                        )
                        Spacer(Modifier.width(8.dp))
                        InlineText(
                            line.content, onOpenLink, onTapTag, imageResolver, onOpenImage,
                            Modifier.weight(1f),
                        )
                    }
                }
            }
        }
        if (spans.edited != null) {
            Text(
                text = "edited",
                style = MaterialTheme.typography.labelSmall,
                color = TextDisabled,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

/**
 * The contract Task 06's `NoteItemCard` calls: `CommentBody(markdown, modifier)`.
 * Callbacks default to no-ops so the legacy call site compiles unchanged; callers
 * pass the raw note string (markers included) to get the "edited" label.
 */
@Composable
fun CommentBody(
    markdown: String,
    modifier: Modifier = Modifier,
    onOpenLink: (String) -> Unit = {},
    onToggleTask: (String) -> Unit = {},
    onTapTag: ((String) -> Unit)? = null,
    imageResolver: CommentImageResolver? = null,
) {
    CommentText(
        markdown = markdown,
        onOpenLink = onOpenLink,
        onToggleTask = onToggleTask,
        onTapTag = onTapTag,
        imageResolver = imageResolver,
        modifier = modifier,
    )
}

@Composable
private fun InlineText(
    content: List<CommentInline>,
    onOpenLink: (String) -> Unit,
    onTapTag: ((String) -> Unit)?,
    imageResolver: CommentImageResolver?,
    onOpenImage: ((String, ImageKind) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val annotated = remember(content, onOpenLink, onTapTag) {
        content.toAnnotatedString(CommentTextStyles(), onOpenLink, onTapTag ?: {})
    }
    val inlineContent = remember(content, imageResolver, onOpenImage) {
        val images = mutableListOf<CommentInline.InlineImage>()
        collectImages(content, images)
        images.associate { image ->
            inlineContentId(image) to InlineTextContent(
                Placeholder(40.sp, 40.sp, PlaceholderVerticalAlign.TextCenter),
            ) {
                ImageChip(image.id, image.kind, imageResolver, onOpenImage)
            }
        }
    }
    Text(
        text = annotated,
        inlineContent = inlineContent,
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurface,
        modifier = modifier,
    )
}

@Composable
private fun ImageChip(
    id: String,
    kind: ImageKind,
    resolver: CommentImageResolver?,
    onOpenImage: ((String, ImageKind) -> Unit)?,
) {
    val bitmap by produceState<ImageBitmap?>(initialValue = null, id, kind, resolver) {
        value = resolver?.resolve(id)
    }
    Surface(
        shape = RoundedCornerShape(6.dp),
        color = Hairline,
        modifier = Modifier
            .size(40.dp)
            .then(if (onOpenImage != null) Modifier.clickable { onOpenImage(id, kind) } else Modifier),
    ) {
        if (bitmap != null) {
            FoundationImage(
                bitmap = bitmap!!,
                contentDescription = if (kind == ImageKind.IMAGE) "Pasted image $id" else "Diagram $id",
                contentScale = ContentScale.Crop,
            )
        } else {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = if (kind == ImageKind.IMAGE) Icons.Filled.Image else Icons.Filled.Draw,
                    contentDescription = "Image $id",
                    tint = TextSecondary,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
    }
}