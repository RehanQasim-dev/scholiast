# LOG — task-29-selection-highlight-layer

## [2026-08-21 18:10] task-29 agent
- **What I learned:** compose-foundation 1.9 (BOM 2025.06.01) **internalized the whole low-level selection API** — `androidx.compose.foundation.text.selection.{Selection, Selectable, SelectionRegistrar, LocalSelectionRegistrar, SelectionAdjustment}` are `internal`, and `SelectionContainer`'s hoisting overload is unusable publicly. There is therefore no public way to map a raw multi-text selection back to per-block offsets, so the planned "wrap SelectionContainer + map selectableId→block" design is impossible on this BOM. Also: `Rect.unite/unions` don't exist on 1.9's `androidx.compose.ui.geometry.Rect` (only `intersect/inflate/translate`) — union computed by hand.
- **Decisions made:**
  - **Deviation from plan §3.2:** `ui/reader/SelectionTracker.kt` ships the *tracking half* only — a `@Stable SelectionTracker` registry (`layoutResults` / `rootBounds` snapshot maps) + `pillRectFor()` geometry + `Modifier.blockSelectionSource(tracker, index)` (root bounds via `boundsInRoot`) + `tracker.layoutSink(index)` for `Text(onTextLayout=…)`. The drag-gesture side (long-press-drag → `(blockIndex,start,end)`) mounts in NativeReader (Task 32), which owns the LazyColumn gesture context; it hands resolved spans to `HighlightController.create`. System handles/magnifier/context-menu are not provided by this layer.
  - Extras shape locked (plan §4.2): `extras = {type:"text", content:<quote>, anchor:{quote,prefix,suffix,occurrence,surface:"web"}, hint:{block,start,end}, groupId?}` — `hint.end` is **exclusive**; anchor built over the touched block's text; `groupId = "g<epoch-ms>"` only when a selection survives on >1 block.
  - Merge semantics in `create`: new spans merge with **same-color** existing highlights per block via Task 24's `mergeOverlappingRanges`; merged pieces keep the oldest contributor's id and are re-anchored; different colors never merge; ids offset +1ms within one create call to stay unique.
  - Painter badges: inline 💬n placeholders are inserted at range ends with full offset remapping when spans are disjoint; overlapping spans defer badges to block end.
- **Open questions:** none blocking. If AndroidX ever re-publishes public selection APIs, SelectionTracker can be swapped without touching controller/painter contracts.
- **Progress:** All owned files written (`HighlightController`, `HighlightPainter`, `BadgeChip`, `SwatchPill`, `SelectionTracker`, `ReaderHighlightPreview` @Preview); `./gradlew assembleDevDebug` BUILD SUCCESSFUL; `./gradlew testDevDebugUnitTest --tests "*HighlightControllerTest*"` → **4 run, 4 passed, 0 failed**.

## Public API for Tasks 30/31/32

```kotlin
// ui/reader/HighlightController.kt  (pure JVM)
object HighlightController {
    data class BlockSelection(val blockIndex: Int, val range: IntRange)      // inclusive
    data class Hint(val block: Int, val start: Int, val end: Int)            // end EXCLUSIVE

    fun create(blocks: List<LinearBlock>, sel: List<BlockSelection>, color: String,
               now: () -> Long = System::currentTimeMillis,
               existing: List<PageHighlight> = emptyList()): List<PageHighlight>
    fun recolor(highlights: List<PageHighlight>, groupId: String, color: String,
                now: () -> Long = System::currentTimeMillis): List<PageHighlight>
    fun delete(highlights: List<PageHighlight>, groupId: String): List<PageHighlight>

    fun hintOf(hl: PageHighlight): Hint?
    fun groupIdOf(hl: PageHighlight): String?
    fun contentOf(hl: PageHighlight): String?
    fun anchorOf(hl: PageHighlight): TextQuoteAnchor?
    fun hintRangeOf(hl: PageHighlight): IntRange?                            // inclusive view
}

// ui/reader/HighlightPainter.kt
fun highlightColor(color: String): Color                                  // yellow/red/green → theme hues
const val HIGHLIGHT_FILL_ALPHA = 0.32f
data class HitSpan(highlightId, groupId?, start, endExclusive) { contains(offset) }
data class Rehint(highlightId, hint)
data class PaintedBlock(text: AnnotatedString, hits: List<HitSpan>, rehints: List<Rehint>)
object HighlightPainter {
    fun resolve(blockIndex, block: LinearBlock, highlights): Pair<List<HitSpan>, List<Rehint>>
    fun paint(blockIndex, block, highlights, includeBaseStyles = true,
              badgeCount: (PageHighlight) -> Int = { it.notes?.size ?: 0 }): PaintedBlock
}
@Composable fun HighlightedText(painted, onHintRewrite: (List<Rehint>) -> Unit,
                                onTapHighlight: (HitSpan) -> Unit, modifier, style, inlineContent)
const val BADGE_PLACEHOLDER_CHAR; fun badgeId(highlightId): String
fun badgeInlineContent(count: Int, onClick: () -> Unit): InlineTextContent   // pair with badgeId()

// ui/reader/BadgeChip.kt
@Composable fun BadgeChip(count: Int, onClick: () -> Unit, modifier, reducedMotion: Boolean = false)

// ui/reader/SwatchPill.kt
@Composable fun SwatchPill(visible: Boolean, anchorRect: Rect?,
    onColor: (String) -> Unit, onMic: () -> Unit, onComment: () -> Unit, onDismiss: () -> Unit,
    modifier /* host-sized overlay */, reducedMotion: Boolean = false)

// ui/reader/SelectionTracker.kt
@Stable class SelectionTracker { putLayout(i, TextLayoutResult?); layoutSink(i); putRootBounds(i, Rect);
                                 clearLayouts(); layoutResults/rootBounds state }
var selectionTrackerGlobal: SelectionTracker?        // set once by Reader host (Task 32)
fun Modifier.blockSelectionSource(tracker, blockIndex): Modifier          // boundsInRoot capture
fun pillRectFor(blocks: List<LinearBlock>, selection: Pair<Int,IntRange>, density): Rect?
data class TrackedSelection(blocks: List<HighlightController.BlockSelection>, pillRect: Rect)

// ui/reader/ReaderHighlightPreview.kt
@Preview private fun HighlightLayerPreview()         // grouped yellow across 2 blocks + red w/ 💬2 badge
```

**Task 32 mount recipe:** render each block via `HighlightedText(HighlightPainter.paint(i, block, highlights))`; feed `onHintRewrite` into persistence (extras.hint rewrite); route `onTapHighlight` → ThreadSheet (Task 30); own long-press-drag gestures over registered layouts → `BlockSelection` list → show `SwatchPill(visible, tracked.pillRect)`; color tap = haptic tick + `HighlightController.create(...)` → paint synchronously → persist AFTER visual commit; call `selectionTrackerGlobal = tracker` once mounted; hide pill on scroll via your scroll listener.
