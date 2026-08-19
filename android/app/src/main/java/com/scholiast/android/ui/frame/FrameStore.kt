package com.scholiast.android.ui.frame

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.scholiast.android.ui.notes.FrameFileDeleteHook
import java.io.File
import kotlinx.coroutines.runBlocking

/**
 * The frame JPEG file store (plan §5.7.4): `filesDir/frames/<itemId>.jpg`,
 * referenced by id from the item's `frame{w,h,driveId}` metadata — bytes are
 * NEVER inline in any JSON, exactly like the desktop's IndexedDB `frames`
 * store (`src/utils/video/frame-store.ts`, keyed by item id).
 *
 * Pure `java.io` (suspend-wrapped), so save/load/delete round-trips are
 * plain-JVM testable against a temp dir; only [loadBitmap] touches Android.
 *
 * The delete hook for Task 06's timeline: `NotesViewModel.frameFileDeleteHook`
 * can be wired to [asDeleteHook] so a frame item's JPEG can never outlive its
 * item (the repository row is Task 06's concern; this is the file half).
 */
class FrameStore(private val dir: File) {

    /** The on-disk location of an item's JPEG. */
    fun fileFor(itemId: String): File = File(dir, "$itemId.jpg")

    /** Write (or overwrite) the item's JPEG. Returns the file. */
    suspend fun save(itemId: String, jpeg: ByteArray): File {
        val file = fileFor(itemId)
        file.parentFile?.mkdirs()
        file.writeBytes(jpeg)
        return file
    }

    /** The item's JPEG bytes, or null when no frame is stored. */
    suspend fun load(itemId: String): ByteArray? =
        fileFor(itemId).takeIf { it.exists() }?.readBytes()

    /** True when the item's JPEG exists. */
    fun has(itemId: String): Boolean = fileFor(itemId).exists()

    /** Remove the item's JPEG. False when nothing was there. */
    suspend fun delete(itemId: String): Boolean = fileFor(itemId).delete()

    /** Delete every stored frame (Settings → wipe local data). */
    fun clearAll() {
        dir.listFiles()?.forEach { it.delete() }
    }

    /**
     * Decode the item's JPEG to a bitmap (sampled to ≤1280px like the capture
     * pipeline). Null when the file is missing or corrupt.
     */
    suspend fun loadBitmap(itemId: String): Bitmap? {
        val bytes = load(itemId) ?: return null
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        val maxDim = maxOf(options.outWidth, options.outHeight)
        var sample = 1
        while (maxDim / (sample * 2) > 1280) sample *= 2
        val decode = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decode)
    }

    /**
     * Task 06's synchronous delete hook, adapted from this store's suspend
     * API. Deleting one small file is instant, so the runBlocking bridge is
     * acceptable (it is only ever called from Task 06's delete flow).
     */
    fun asDeleteHook(): FrameFileDeleteHook = FrameFileDeleteHook { itemId ->
        runBlocking { delete(itemId) }
    }

    companion object {
        /** The canonical store under `filesDir/frames/`. */
        fun inFilesDir(filesDir: File): FrameStore = FrameStore(File(filesDir, "frames"))
    }
}