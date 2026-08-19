package com.scholiast.android.data.notes

/**
 * The tag suggestion index, mirroring the desktop's single `tag_index`
 * storage.local key: every `#tag` ever used in a comment, stored WITHOUT the
 * `#` prefix, sorted, union-only on write. Feed it whenever a comment saves
 * (extract `#tags` from the note text); the `#` autocomplete suggests from it.
 */
interface TagIndex {

    /** Fold new tags into the index (union-only, sorted; no-ops when nothing new). */
    suspend fun addTags(tags: Collection<String>)

    /** Tags starting with [prefix] (prefix may include the `#`), up to [limit]. */
    suspend fun suggest(prefix: String, limit: Int = 10): List<String>

    /** The whole index, sorted. */
    suspend fun allTags(): List<String>
}