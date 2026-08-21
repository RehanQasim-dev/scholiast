# Task 23 — Webpage annotation foundation (the contract)

Status: DONE

## Objective
The shared baseline every other webpage-annotation task builds on: the Gradle dependency, the Room
migration, the `LinearArticle` content model, the highlight repository interface, and reader
preferences. **Keep it small and fast — this is the contract task; other agents code against what
you land.**

Plan: `../scholiast_web_annot_app_plan.md` §3.2–3.3, §4 (data model), §7 (build).

## Scope — files you OWN (in `../android/`)
- `app/build.gradle.kts` + `gradle/libs.versions.toml` — add `readability4j = "1.0.8"`
  (`net.dankito.readability4j:readability4j`; pulls Jsoup transitively). ONLY this addition.
- `app/src/main/java/com/scholiast/android/data/model/LinearArticle.kt` — the content model:
  ```kotlin
  @Serializable data class LinearArticle(
    val url: String, val title: String?, val byline: String? = null,
    val blocks: List<LinearBlock> = emptyList(), val wordCount: Int = 0,
    val fetchedAt: Long, val truncated: Boolean = false,
  )
  @Serializable data class LinearBlock(
    val kind: String,            // "p" | "h1".."h6" | "blockquote" | "code" | "li" | "img" | "figcaption"
    val text: String,            // plain text of the block ("" for img)
    val annotations: List<LinearAnn> = emptyList(), // char-offset spans WITHIN text
    val imgUrl: String? = null, val imgAlt: String? = null,
  )
  @Serializable data class LinearAnn(val kind: String, val start: Int, val end: Int, val target: String)
  // kind: "link" | "bold" | "italic" | "code"; target = url for links
  ```
- `app/src/main/java/com/scholiast/android/data/db/` — Room migration N+1 on `video_pages`:
  `highlightsJson TEXT NOT NULL DEFAULT '[]'`, `readerJson TEXT NULL`. Update `VideoPageEntity`
  (+ fields, + parsed accessors `highlights: List<PageHighlight>` via `ScholiastJson`,
  `reader: LinearArticle?`), `VideoPageDao` (nothing new strictly needed; keep list queries working).
  Bump DB version, write the `Migration` object, update/add schema tests if present.
- `app/src/main/java/com/scholiast/android/data/notes/PageHighlightRepository.kt` — INTERFACE only:
  ```kotlin
  interface PageHighlightRepository {
    suspend fun highlights(url: String): List<PageHighlight>
    suspend fun upsert(url: String, hl: PageHighlight)          // stamps updatedAt if newer
    suspend fun delete(url: String, id: String)
    suspend fun replaceAll(url: String, list: List<PageHighlight>)
    suspend fun saveReaderArticle(article: LinearArticle)
    suspend fun readerArticle(url: String): LinearArticle?
    fun pagesWithHighlights(): Flow<List<PageListItem>>         // Home Pages tab rows
  }
  data class PageListItem(val url: String, val title: String?, val domain: String,
                          val highlightCount: Int, val lastOpenedAt: Long?)
  ```
- `app/src/main/java/com/scholiast/android/data/prefs/ReaderPrefs.kt` — DataStore keys:
  fontStep (Int 0..4, default 1), serif (Boolean false), wideWidth (Boolean false).
- Unit tests for the migration (in-memory Room) and LinearArticle JSON round-trip.

## Requirements
- Follow `android/AGENTS.md` conventions (kotlinx.serialization, suspend DAOs, byte-compat JSON).
- The migration must be additive and safe on an existing installed DB (Waydroid has data).
- Do NOT touch SyncEngine, PageStore, any UI file, or anything else — other tasks own those.

## Acceptance criteria
- `./gradlew assembleDevDebug` succeeds.
- Migration test passes (old schema → new columns, defaults intact).
- LinearArticle serializes/deserializes losslessly via `ScholiastJson`.

## Agent notes
- You are the critical path — 5 agents start the moment you finish. Prefer landing a correct
  minimal contract over polish.
- Log interface signatures in `LOG.md` exactly as landed; downstream tasks read your log.
- Skip Waydroid install (orchestrator handles installs at integration time).
