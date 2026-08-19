package com.scholiast.android.ui.notes.editor

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import com.scholiast.android.data.notes.TagIndex
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Pins the editor's pure logic: the markdown command transforms (surround
 * selection, per-line bullet/checklist toggles, link insertion), serialization
 * to the comment-markdown subset, the `#tag` autocomplete, and the
 * empty-draft discard rule. Deterministic: the VM's suspend methods update the
 * StateFlow in the calling coroutine, so `runBlocking` suffices (no Main
 * dispatcher, per the NotesViewModel test pattern).
 */
class EditorViewModelTest {

    // --- Bold / italic ------------------------------------------------------

    @Test
    fun `bold wraps the selection and places the caret after`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("say hello", 4..9)) }
        vm.applyCommand(EditorCommand.BOLD)
        assertEquals("say **hello**", vm.state.value.text)
        assertEquals(13, vm.state.value.field.selection.start)
    }

    @Test
    fun `bold on empty selection inserts an empty pair with the caret inside`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("abc", 1..1)) }
        vm.applyCommand(EditorCommand.BOLD)
        assertEquals("a****bc", vm.state.value.text)
        assertEquals(3, vm.state.value.field.selection.start)
    }

    @Test
    fun `bold toggles off an already bold selection`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("a **b** c", 4..4)) }
        vm.applyCommand(EditorCommand.BOLD)
        assertEquals("a b c", vm.state.value.text)
    }

    @Test
    fun `italic wraps the selection`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("em", 0..2)) }
        vm.applyCommand(EditorCommand.ITALIC)
        assertEquals("*em*", vm.state.value.text)
        assertEquals(4, vm.state.value.field.selection.start)
    }

    @Test
    fun `italic toggles off an already italic selection`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("*x*", 1..2)) }
        vm.applyCommand(EditorCommand.ITALIC)
        assertEquals("x", vm.state.value.text)
    }

    // --- Bullet / checklist -------------------------------------------------

    @Test
    fun `bullet command prefixes the caret line`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("item", 2..2)) }
        vm.applyCommand(EditorCommand.BULLET)
        assertEquals("- item", vm.state.value.text)
    }

    @Test
    fun `bullet command toggles off an existing bullet line`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("- item", 3..3)) }
        vm.applyCommand(EditorCommand.BULLET)
        assertEquals("item", vm.state.value.text)
    }

    @Test
    fun `bullet command converts a task line to a bullet`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("- [x] done", 4..4)) }
        vm.applyCommand(EditorCommand.BULLET)
        assertEquals("- done", vm.state.value.text)
    }

    @Test
    fun `checklist command prefixes a plain line`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("todo", 0..0)) }
        vm.applyCommand(EditorCommand.CHECKLIST)
        assertEquals("- [ ] todo", vm.state.value.text)
    }

    @Test
    fun `checklist command toggles off an existing task line`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("- [ ] todo", 5..5)) }
        vm.applyCommand(EditorCommand.CHECKLIST)
        assertEquals("todo", vm.state.value.text)
    }

    @Test
    fun `checklist command converts a bullet line to a task`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("- item", 2..2)) }
        vm.applyCommand(EditorCommand.CHECKLIST)
        assertEquals("- [ ] item", vm.state.value.text)
    }

    @Test
    fun `line command applies to every line the selection touches`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("a\nb\nc", 1..4)) }
        vm.applyCommand(EditorCommand.BULLET)
        assertEquals("a\n- b\n- c", vm.state.value.text)
    }

    @Test
    fun `line command leaves untouched lines alone`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("a\nb\nc", 2..2)) }
        vm.applyCommand(EditorCommand.BULLET)
        assertEquals("a\n- b\nc", vm.state.value.text)
    }

    // --- Link ---------------------------------------------------------------

    @Test
    fun `link wraps the selection with the url`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("click here", 0..10)) }
        vm.applyLink("https://x.dev")
        assertEquals("[click here](https://x.dev)", vm.state.value.text)
    }

    @Test
    fun `link with empty selection places the caret inside the parens`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("abc", 1..1)) }
        vm.applyLink("https://x.dev")
        assertEquals("a[](https://x.dev)bc", vm.state.value.text)
        assertEquals(4, vm.state.value.field.selection.start)
    }

    @Test
    fun `link prepends https when the url has no scheme`() {
        val vm = vm()
        runBlocking { vm.onFieldChanged(field("x", 0..1)) }
        vm.applyLink("example.com")
        assertEquals("[x](https://example.com)", vm.state.value.text)
    }

    // --- Serialization / note helpers ---------------------------------------

    @Test
    fun `serialize strips pasted id and edited markers and trims`() {
        val vm = vm()
        runBlocking {
            vm.onFieldChanged(
                field("  hi <!--timestamp:123--><!--edited:456--> there  ", 0..0),
            )
        }
        assertEquals("hi there", vm.serialize())
    }

    @Test
    fun `serialize keeps the markdown subset untouched`() {
        val vm = vm()
        runBlocking {
            vm.onFieldChanged(field("**b** *i* [l](https://a.b) #tag - [ ] task", 0..0))
        }
        assertEquals("**b** *i* [l](https://a.b) #tag - [ ] task", vm.serialize())
    }

    @Test
    fun `finalizeNote stamps the timestamp marker via the injected clock`() {
        val vm = vm(initialText = "hello", clock = { 999L })
        assertEquals("hello<!--timestamp:999-->", vm.finalizeNote())
    }

    @Test
    fun `finalizeNote is null for a blank draft`() {
        val vm = vm(initialText = "   ")
        assertNull(vm.finalizeNote())
    }

    @Test
    fun `extractTags returns tags without the hash prefix`() {
        assertEquals(
            listOf("lecture/3", "exam"),
            extractTags("see #lecture/3 and #exam and #lecture/3 again"),
        )
    }

    @Test
    fun `feedTags folds the draft tags into the index`() = runBlocking {
        val index = FakeTagIndex()
        val vm = EditorViewModel(index, initialText = "a #new tag")
        vm.feedTags()
        assertEquals(listOf("new"), index.all.value)
    }

    // --- Empty-draft discard rule -------------------------------------------

    @Test
    fun `empty draft is discarded on click-away`() {
        assertTrue(shouldDiscardOnDismiss(""))
        assertTrue(shouldDiscardOnDismiss("   \n "))
    }

    @Test
    fun `non-empty draft is kept on click-away`() {
        assertFalse(shouldDiscardOnDismiss("hi"))
        assertFalse(shouldDiscardOnDismiss("  hi  "))
    }

    @Test
    fun `save is disabled while the draft is empty`() {
        val vm = vm()
        assertTrue(vm.state.value.isEmpty)
        runBlocking { vm.onFieldChanged(field("x", 0..0)) }
        assertFalse(vm.state.value.isEmpty)
    }

    // --- Tag autocomplete ---------------------------------------------------

    @Test
    fun `typing a hash token pops matching suggestions`() = runBlocking {
        val vm = vm(tagIndex = FakeTagIndex("lecture/3", "lecture/4", "exam"))
        vm.onFieldChanged(field("note #lecture/", 11..11))
        assertEquals(listOf("lecture/3", "lecture/4"), vm.state.value.tagSuggestions)
        assertTrue(vm.state.value.showTagSuggestions)
    }

    @Test
    fun `token inside a word is not a tag`() = runBlocking {
        val vm = vm(tagIndex = FakeTagIndex("lecture/3"))
        vm.onFieldChanged(field("abc#lecture/3", 12..12))
        assertNull(vm.state.value.activeTagToken)
        assertFalse(vm.state.value.showTagSuggestions)
    }

    @Test
    fun `selecting text hides the suggestions`() = runBlocking {
        val vm = vm(tagIndex = FakeTagIndex("lecture/3"))
        vm.onFieldChanged(field("#lec", 4..4))
        assertTrue(vm.state.value.showTagSuggestions)
        vm.onFieldChanged(field("#lec", 0..2))
        assertFalse(vm.state.value.showTagSuggestions)
    }

    @Test
    fun `insertTag replaces the partial token and closes the list`() = runBlocking {
        val vm = vm(tagIndex = FakeTagIndex("lecture/3"))
        vm.onFieldChanged(field("note #lec here", 7..7))
        vm.insertTag("lecture/3")
        assertEquals("note #lecture/3 here", vm.state.value.text)
        assertFalse(vm.state.value.showTagSuggestions)
        assertEquals(15, vm.state.value.field.selection.start)
    }

    @Test
    fun `insertTag with no active token is a no-op`() {
        val vm = vm()
        vm.insertTag("lecture/3")
        assertEquals("", vm.state.value.text)
    }

    // --- Tag pills (EditorField's display styling) ---------------------------

    @Test
    fun `pill styling skips the tag the caret is inside`() {
        val annotated = pillTagsAnnotated("see #lecture/3", caret = 7)
        assertTrue(annotated.spanStyles.isEmpty())
    }

    @Test
    fun `pill styling covers tags the caret left`() {
        val annotated = pillTagsAnnotated("see #lecture/3", caret = 3)
        assertEquals(1, annotated.spanStyles.size)
        assertEquals(4, annotated.spanStyles[0].start)
        assertEquals(14, annotated.spanStyles[0].end)
    }

    // --- Helpers ------------------------------------------------------------

    private fun field(text: String, selection: IntRange): TextFieldValue =
        TextFieldValue(text, TextRange(selection.first, selection.last))

    private fun vm(
        tagIndex: TagIndex? = null,
        initialText: String = "",
        clock: () -> Long = { 0L },
    ) = EditorViewModel(tagIndex, initialText, clock)

    private class FakeTagIndex(vararg initial: String = emptyArray()) : TagIndex {
        val all = MutableStateFlow(initial.sorted())

        override suspend fun addTags(tags: Collection<String>) {
            all.update { (it + tags.map { t -> t.removePrefix("#") }).distinct().sorted() }
        }

        override suspend fun suggest(prefix: String, limit: Int): List<String> {
            val p = prefix.trim().removePrefix("#")
            return all.value.filter { it.startsWith(p, ignoreCase = true) }.take(limit)
        }

        override suspend fun allTags(): List<String> = all.value
    }
}