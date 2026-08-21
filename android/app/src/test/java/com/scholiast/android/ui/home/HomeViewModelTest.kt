package com.scholiast.android.ui.home

import com.scholiast.android.data.db.LoadedVideoPage
import com.scholiast.android.data.db.VideoPageEntity
import com.scholiast.android.data.model.ScholiastJson
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.normalize.Normalize
import com.scholiast.android.data.notes.VideoItemRepository
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Home's input validation, share parsing, and recent-list mapping. The data
 * load is driven through the public suspend `reload()` (not `refresh()`, which
 * needs viewModelScope's Main dispatcher and is therefore runtime-only).
 */
class HomeViewModelTest {

    private class FakeVideoItemRepository(
        var pages: List<VideoPageEntity> = emptyList(),
    ) : VideoItemRepository {
        override suspend fun upsertPage(url: String, videoId: String?, title: String?): VideoPageEntity =
            error("not used in Home tests")
        override suspend fun loadPage(url: String): LoadedVideoPage? = null
        // The real DAO orders by updatedAt DESC; the fake mimics that contract.
        override suspend fun listRecentPages(limit: Int): List<VideoPageEntity> =
            pages.sortedByDescending { it.updatedAt }.take(limit)
        override suspend fun listAllPages(): List<VideoPageEntity> = pages
        override suspend fun addItem(url: String, item: VideoItem): VideoItem = error("not used")
        override suspend fun updateItem(url: String, item: VideoItem): VideoItem? = null
        override suspend fun deleteItem(url: String, itemId: String): Boolean = false
        override suspend fun deletePage(url: String) = Unit
    }

    private fun page(
        url: String,
        videoId: String?,
        title: String?,
        updatedAt: Long,
        items: List<VideoItem> = emptyList(),
    ) = VideoPageEntity(
        urlHash = Normalize.urlHash(url),
        url = url,
        videoId = videoId,
        title = title,
        itemsJson = ScholiastJson.encode(items),
        updatedAt = updatedAt,
        snapJson = null,
        fileId = null,
        headRevisionId = null,
    )

    private fun item(id: String, videoTime: Double = 0.0) =
        VideoItem(id = id, kind = "note", videoTime = videoTime)

    // --- recent-list mapping ---

    @Test
    fun `empty repository maps to an empty recent list`() = runBlocking {
        val vm = HomeViewModel(FakeVideoItemRepository())
        vm.reload()
        assertTrue(vm.recentPages.value.isEmpty())
    }

    @Test
    fun `recent pages render newest first with note counts`() = runBlocking {
        val repo = FakeVideoItemRepository(
            listOf(
                page("https://youtube.com/watch?v=aaa", "aaa", "Older", 100L, items = listOf(item("1"))),
                page("https://youtube.com/watch?v=bbb", "bbb", "Newer", 200L, items = listOf(item("2"), item("3"))),
            )
        )
        val vm = HomeViewModel(repo)
        vm.reload()
        val pages = vm.recentPages.value
        assertEquals(listOf("bbb", "aaa"), pages.map { it.videoId })
        assertEquals(2, pages[0].noteCount)
        assertEquals(1, pages[1].noteCount)
    }

    @Test
    fun `pages without a videoId are not shown`() = runBlocking {
        val repo = FakeVideoItemRepository(listOf(page("https://example.com/x", null, "No id", 300L)))
        val vm = HomeViewModel(repo)
        vm.reload()
        assertTrue(vm.recentPages.value.isEmpty())
    }

    @Test
    fun `null title falls back to Untitled video`() = runBlocking {
        val repo = FakeVideoItemRepository(listOf(page("https://youtube.com/watch?v=ccc", "ccc", null, 1L)))
        val vm = HomeViewModel(repo)
        vm.reload()
        assertEquals("Untitled video", vm.recentPages.value.single().title)
    }

    // --- open-link input validation ---

    @Test
    fun `open link accepts every youtube url form and clears the field`() = runBlocking {
        val vm = HomeViewModel(FakeVideoItemRepository())
        val opened = mutableListOf<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            vm.pendingOpen.collect { videoId ->
                if (videoId != null) {
                    opened.add(videoId)
                    vm.consumePendingOpen()
                }
            }
        }
        val forms = listOf(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
            "https://m.youtube.com/live/dQw4w9WgXcQ",
        )
        for (form in forms) {
            vm.onOpenLinkChange(form)
            vm.submitOpenLink()
            yield() // let the collector consume the pending emission
            assertEquals("", vm.openLink.value)
        }
        assertEquals(List(5) { "dQw4w9WgXcQ" }, opened)
        job.cancel()
    }

    @Test
    fun `non-youtube open link routes to the reader and clears the field`() = runBlocking {
        // Task 28: open-link routing by URL type — non-YouTube http(s) URLs
        // open the Reader (normalized), only truly invalid text toasts.
        val vm = HomeViewModel(FakeVideoItemRepository())
        val opened = mutableListOf<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            vm.pendingOpenUrl.collect { url ->
                if (url != null) {
                    opened.add(url)
                    vm.consumePendingOpenUrl()
                }
            }
        }
        vm.onOpenLinkChange("https://example.com/not-a-youtube-url")
        vm.submitOpenLink()
        yield() // let the collector consume the pending emission
        assertEquals(listOf("https://example.com/not-a-youtube-url"), opened)
        assertEquals("", vm.openLink.value)
        job.cancel()
    }

    @Test
    fun `empty open link shows a toast`() = runBlocking {
        val vm = HomeViewModel(FakeVideoItemRepository())
        val toasts = mutableListOf<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            vm.pendingToast.collect { message ->
                if (message != null) {
                    toasts.add(message)
                    vm.consumePendingToast()
                }
            }
        }
        vm.onOpenLinkChange("   ")
        vm.submitOpenLink()
        yield() // let the collector consume the pending emission
        assertEquals(listOf(HomeViewModel.NOT_YOUTUBE_LINK), toasts)
        assertNull(vm.pendingOpen.value)
        job.cancel()
    }

    // --- share-intent parsing ---

    @Test
    fun `share with a bare url opens the video`() = runBlocking {
        val vm = HomeViewModel(FakeVideoItemRepository())
        val opened = mutableListOf<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            vm.pendingOpen.collect { videoId ->
                if (videoId != null) {
                    opened.add(videoId)
                    vm.consumePendingOpen()
                }
            }
        }
        vm.parseShareText("https://www.youtube.com/watch?v=abc123")
        yield() // let the collector consume the pending emission
        assertEquals(listOf("abc123"), opened)
        job.cancel()
    }

    @Test
    fun `share with surrounding prose still extracts the url`() = runBlocking {
        val vm = HomeViewModel(FakeVideoItemRepository())
        val opened = mutableListOf<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            vm.pendingOpen.collect { videoId ->
                if (videoId != null) {
                    opened.add(videoId)
                    vm.consumePendingOpen()
                }
            }
        }
        vm.parseShareText("Check out this lecture https://youtu.be/xyz789 thanks!")
        yield() // let the collector consume the pending emission
        assertEquals(listOf("xyz789"), opened)
        job.cancel()
    }

    @Test
    fun `share with invalid text shows a toast and opens nothing`() = runBlocking {
        val vm = HomeViewModel(FakeVideoItemRepository())
        val toasts = mutableListOf<String>()
        val opened = mutableListOf<String>()
        val toastJob = launch(start = CoroutineStart.UNDISPATCHED) {
            vm.pendingToast.collect { message ->
                if (message != null) {
                    toasts.add(message)
                    vm.consumePendingToast()
                }
            }
        }
        val openJob = launch(start = CoroutineStart.UNDISPATCHED) {
            vm.pendingOpen.collect { videoId ->
                if (videoId != null) {
                    opened.add(videoId)
                    vm.consumePendingOpen()
                }
            }
        }
        vm.parseShareText("just some words, no link")
        yield() // let the collectors consume the pending emissions
        assertEquals(listOf(HomeViewModel.NOT_YOUTUBE_LINK), toasts)
        assertTrue(opened.isEmpty())
        toastJob.cancel()
        openJob.cancel()
    }

    @Test
    fun `share with null text shows a toast`() = runBlocking {
        val vm = HomeViewModel(FakeVideoItemRepository())
        val toasts = mutableListOf<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            vm.pendingToast.collect { message ->
                if (message != null) {
                    toasts.add(message)
                    vm.consumePendingToast()
                }
            }
        }
        vm.parseShareText(null)
        yield() // let the collector consume the pending emission
        assertEquals(listOf(HomeViewModel.NOT_YOUTUBE_LINK), toasts)
        job.cancel()
    }

    @Test
    fun `cold-start share with invalid text still shows its toast once Home collects`() = runBlocking {
        // Simulates ACTION_SEND firing before Home's composition subscribes: the
        // toast is buffered in pendingToast (a StateFlow) and delivered on collect.
        val vm = HomeViewModel(FakeVideoItemRepository())
        vm.parseShareText("shared before Home existed")
        val toasts = mutableListOf<String>()
        val job = launch(start = CoroutineStart.UNDISPATCHED) {
            vm.pendingToast.collect { message ->
                if (message != null) {
                    toasts.add(message)
                    vm.consumePendingToast()
                }
            }
        }
        assertEquals(listOf(HomeViewModel.NOT_YOUTUBE_LINK), toasts)
        assertNull(vm.pendingToast.value)
        job.cancel()
    }

    // --- sync status ---

    @Test
    fun `sync status holder drives the chip state`() {
        val holder = InMemorySyncStatusHolder()
        val vm = HomeViewModel(FakeVideoItemRepository(), holder)
        assertTrue(vm.syncStatus.value is SyncStatus.Disconnected)
        holder.set(SyncStatus.Syncing)
        assertEquals(SyncStatus.Syncing, vm.syncStatus.value)
        holder.set(SyncStatus.Synced(123L))
        assertEquals(SyncStatus.Synced(123L), vm.syncStatus.value)
        vm.updateSyncStatus(SyncStatus.Error("boom"))
        assertEquals(SyncStatus.Error("boom"), vm.syncStatus.value)
    }
}