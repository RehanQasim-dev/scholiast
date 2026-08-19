package com.scholiast.android.domain.sync.merge

import com.scholiast.android.data.model.PageDiagram
import com.scholiast.android.data.model.PageHighlight
import com.scholiast.android.data.model.PageRecord
import com.scholiast.android.data.model.PageStroke
import com.scholiast.android.data.model.PageTombstones
import com.scholiast.android.data.model.VideoItem
import com.scholiast.android.data.model.VideoPage

/**
 * The pure 3-way merge for the per-page Drive layout, ported VERBATIM from
 * `shared/merge.ts` (`mergePageRecord` + its primitives). Golden tests pin the
 * Kotlin output byte-equal to the TypeScript output for the same fixtures —
 * the app reads and writes the SAME `pages/page-<urlhash>.json` files as the
 * desktop extension and the Obsidian plugin, so the conflict rules must be
 * identical.
 *
 * Reconciliation is the 3-way merge between:
 *   base   = the state we last reconciled (a stored snapshot, `snap:<url>`)
 *   local  = this device's current state
 *   remote = whatever is in Drive right now
 * Deletions are detected against `base` and recorded as per-page tombstones so
 * a delete on one device isn't resurrected by the other's stale copy.
 *
 * Ordering is part of the contract: `kept` maps are insertion-ordered exactly
 * like the TS `Map`s, so serialized output is byte-identical.
 */
object MergePageRecord {

    /** Tombstones older than this are garbage-collected so the file can't grow
     * forever. Mirrors `TOMBSTONE_RETENTION_MS` in `shared/merge.ts`. */
    const val TOMBSTONE_RETENTION_MS = 30L * 24 * 60 * 60 * 1000

    // --- Comment marker parsing (mirrors comment-overlays.parseNoteString) -----

    fun commentId(note: String): String {
        val m = TIMESTAMP_RE.find(note)
        return m?.groupValues?.get(1) ?: note // fall back to raw text as id for legacy notes
    }

    fun commentVersion(note: String): Long {
        val ed = EDITED_RE.find(note)
        if (ed != null) return ed.groupValues[1].toLongOrNull() ?: 0L
        val ts = TIMESTAMP_RE.find(note)
        return ts?.groupValues?.get(1)?.toLongOrNull() ?: 0L
    }

    private val TIMESTAMP_RE = Regex("<!--timestamp:(\\d+)-->")
    private val EDITED_RE = Regex("<!--edited:(\\d+)-->")

    /**
     * JS `parseInt(s, 10)` semantics (digit prefix, optional sign) — the TS
     * merge versions entity ids with it, and comment ids can be raw legacy
     * text. Returns null when there is nothing numeric, exactly like NaN.
     */
    private fun jsParseInt(s: String): Long? {
        var i = 0
        while (i < s.length && s[i].isWhitespace()) i++
        var neg = false
        if (i < s.length && (s[i] == '+' || s[i] == '-')) {
            neg = s[i] == '-'
            i++
        }
        var v = 0L
        var any = false
        while (i < s.length && s[i].isDigit()) {
            any = true
            v = v * 10 + (s[i] - '0')
            i++
        }
        return if (any) (if (neg) -v else v) else null
    }

    // --- Generic keyed 3-way merge -----------------------------------------------

    class MergeResult<T>(val kept: LinkedHashMap<String, T>, val tombs: LinkedHashMap<String, Long>)

    /**
     * Generic keyed 3-way merge, ported from `mergeKeyed` in `shared/merge.ts`.
     * [inTombs] is MUTATED in place (the TS version mutates its `tombs` object
     * the same way), so callers must pass a fresh copy.
     */
    fun <T> mergeKeyed(
        base: Map<String, T>,
        local: Map<String, T>,
        remote: Map<String, T>,
        inTombs: MutableMap<String, Long>,
        versionOf: (T) -> Long,
        combine: (T, T) -> T,
        now: Long,
    ): MergeResult<T> {
        val kept = LinkedHashMap<String, T>()
        val tombs = LinkedHashMap<String, Long>(inTombs)
        val ids = LinkedHashSet<String>()
        ids.addAll(base.keys)
        ids.addAll(local.keys)
        ids.addAll(remote.keys)
        ids.addAll(inTombs.keys)

        for (id in ids) {
            val b = base[id]
            val l = local[id]
            val r = remote[id]
            val tomb = tombs[id]

            if (l != null && r != null) {
                val merged = combine(l, r)
                if (tomb != null && versionOf(merged) <= tomb) {
                    // Deleted more recently than this edit — stays deleted.
                } else {
                    kept[id] = merged
                    tombs.remove(id)
                }
            } else if (l != null) {
                if (tomb != null) {
                    if (versionOf(l) > tomb) {
                        kept[id] = l // re-edited locally after a remote delete → resurrect
                        tombs.remove(id)
                    }
                } else if (b == null) {
                    kept[id] = l // brand-new local entity
                } else {
                    tombs[id] = now // was in base, gone from remote → remote deleted it
                }
            } else if (r != null) {
                if (b != null) {
                    tombs[id] = now // was in base, gone locally → local deleted it
                } else if (tomb != null) {
                    if (versionOf(r) > tomb) {
                        kept[id] = r // re-added remotely after a delete → resurrect
                        tombs.remove(id)
                    }
                } else {
                    kept[id] = r // brand-new remote entity
                }
            }
            // else: absent both sides — leave any tombstone for GC below.
        }

        val iterator = tombs.entries.iterator()
        while (iterator.hasNext()) {
            val (_, t) = iterator.next()
            if (now - t > TOMBSTONE_RETENTION_MS) iterator.remove()
        }

        return MergeResult(kept, tombs)
    }

    private fun <T> byId(items: List<T>, idOf: (T) -> String): Map<String, T> {
        val m = LinkedHashMap<String, T>()
        for (e in items) m[idOf(e)] = e
        return m
    }

    // --- Comment (notes[]) merge -------------------------------------------------

    fun mergeNotes(
        baseNotes: List<String>?,
        localNotes: List<String>?,
        remoteNotes: List<String>?,
        commentTombs: MutableMap<String, Long>,
        highlightId: String,
        now: Long,
    ): List<String> {
        fun toMap(notes: List<String>?): Map<String, String> {
            val m = LinkedHashMap<String, String>()
            for (n in notes ?: emptyList()) m[commentId(n)] = n
            return m
        }
        val base = toMap(baseNotes)
        val local = toMap(localNotes)
        val remote = toMap(remoteNotes)

        val scoped = LinkedHashMap<String, Long>()
        val prefix = "$highlightId:"
        for ((k, v) in commentTombs) {
            if (k.startsWith(prefix)) scoped[k.removePrefix(prefix)] = v
        }

        val result = mergeKeyed(
            base, local, remote, scoped,
            ::commentVersion,
            { l, r -> if (commentVersion(l) >= commentVersion(r)) l else r },
            now,
        )

        for (k in scoped.keys) commentTombs.remove(prefix + k)
        for ((k, v) in result.tombs) commentTombs[prefix + k] = v

        return result.kept.values.sortedWith(compareBy { jsParseInt(commentId(it)) ?: 0L })
    }

    // --- Version helpers ---------------------------------------------------------

    private fun highlightVersion(h: PageHighlight): Long =
        h.updatedAt ?: jsParseInt(h.id) ?: 0L

    private fun videoItemVersion(it: VideoItem): Long =
        it.updatedAt ?: jsParseInt(it.id) ?: 0L

    private fun diagramVersion(d: PageDiagram): Long = d.updatedAt ?: 0L

    // --- The per-page record merge ------------------------------------------------

    /**
     * 3-way reconcile of a single page record, ported byte-for-byte from
     * `shared/merge.ts:mergePageRecord`. `base` is the last-reconciled state
     * (snapshot), `local` this device's current state, `remote` the Drive file
     * (the canonical tombstone carrier). Any may be null/absent. Returns the
     * merged record with updated tombstones, ready to write locally and upload.
     */
    fun mergePageRecord(
        base: PageRecord?,
        local: PageRecord?,
        remote: PageRecord?,
        now: Long,
    ): PageRecord {
        val url = local?.url ?: remote?.url ?: base?.url ?: ""
        val b = base ?: VideoPage.empty(url)
        val l = local ?: VideoPage.empty(url)
        val r = remote ?: VideoPage.empty(url)

        // Seed from remote — the shared, durable record of deletions (as in
        // mergeSyncFiles). Work on mutable copies; the TS version reassigns the
        // five tombstone maps as each category merges (`tombs.highlights =
        // hRes.tombs`), and mergeKeyed copies its input — so the RESULTS of each
        // merge are what feed the output record. `cmTombs` alone is mutated in
        // place (mergeNotes writes its scoped tombstones straight into it).
        val hlTombs = LinkedHashMap(r.tombstones.highlights)
        val drTombs = LinkedHashMap(r.tombstones.drawings)
        val cmTombs = LinkedHashMap(r.tombstones.comments)
        val viTombs = LinkedHashMap(r.tombstones.videoItems)
        val dgTombs = LinkedHashMap(r.tombstones.diagrams)

        val bH = byId(b.highlights) { it.id }
        val lH = byId(l.highlights) { it.id }
        val rH = byId(r.highlights) { it.id }
        val hRes = mergeKeyed(bH, lH, rH, hlTombs, ::highlightVersion, { x, y ->
            val newer = if (highlightVersion(x) >= highlightVersion(y)) x else y
            val notes = mergeNotes(bH[x.id]?.notes, x.notes, y.notes, cmTombs, x.id, now)
            newer.copy(notes = notes)
        }, now)

        val dRes = mergeKeyed(
            byId(b.drawings) { it.id }, byId(l.drawings) { it.id }, byId(r.drawings) { it.id },
            drTombs,
            { s: PageStroke -> s.updatedAt ?: 0L },
            { x, y -> if ((x.updatedAt ?: 0L) >= (y.updatedAt ?: 0L)) x else y },
            now,
        )

        val bV = byId(b.videoItems) { it.id }
        val lV = byId(l.videoItems) { it.id }
        val rV = byId(r.videoItems) { it.id }
        val vRes = mergeKeyed(bV, lV, rV, viTombs, ::videoItemVersion, { x, y ->
            val newer = if (videoItemVersion(x) >= videoItemVersion(y)) x else y
            val notes = mergeNotes(bV[x.id]?.notes, x.notes, y.notes, cmTombs, x.id, now)
            val frame = newer.frame ?: x.frame ?: y.frame
            newer.copy(notes = notes, frame = frame)
        }, now)

        val gRes = mergeKeyed(
            byId(b.diagrams) { it.id }, byId(l.diagrams) { it.id }, byId(r.diagrams) { it.id },
            dgTombs,
            ::diagramVersion,
            { x, y -> if (diagramVersion(x) >= diagramVersion(y)) x else y },
            now,
        )

        // `l.title ?? r.title ?? b.title` with TS truthiness (falsy → skip).
        val title = listOf(l.title, r.title, b.title).firstOrNull { !it.isNullOrEmpty() }
        val videoId = listOf(l.videoId, r.videoId, b.videoId).firstOrNull { !it.isNullOrEmpty() }
        return VideoPage(
            version = 2,
            url = url,
            title = title,
            videoId = videoId,
            highlights = hRes.kept.values.toList(),
            drawings = dRes.kept.values.toList(),
            videoItems = vRes.kept.values.toList(),
            diagrams = gRes.kept.values.toList(),
            tombstones = PageTombstones(
                highlights = hRes.tombs,
                drawings = dRes.tombs,
                comments = cmTombs,
                videoItems = vRes.tombs,
                diagrams = gRes.tombs,
            ),
        )
    }
}