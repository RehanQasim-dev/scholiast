# LOG — task-23-foundation-contract

## [2026-08-21 19:53] ox-alpha (Task 23 agent)
- **What I learned:**
  - System default JDK is Java 25; Gradle 8.11.1/Kotlin cannot parse its version (`IllegalArgumentException: 25.0.3` in `JavaVersion.parse`). Fixed via `org.gradle.java.home=/usr/lib/jvm/java-21-openjdk-amd64` in `android/gradle.properties` (approved environment fix).
  - `room-testing` 2.8.4 is KMP; an Android app module's local unit tests resolve the **android** variant, whose `MigrationTestHelper` needs an `Instrumentation`. Robolectric supplies it; the JVM/Path-based helper is NOT reachable from an app module without classpath conflicts.
  - Room reads migration-test schemas from **assets**; pointing test-source-set assets at `app/schemas` does not reach Robolectric's merged-assets path. Simpler robust pattern: build the v1 db directly from the exported `1.json` (`entities[].createSql`, replace `${TABLE_NAME}`, set `PRAGMA user_version = 1`), then open it with real Room + `.addMigrations(...)` — Room validates the migrated schema against its generated v2 expectation on open. This also exercises the DAO converters/accessors end-to-end.
  - Room schema validation compares column DEFAULTs strictly: a migration adding `DEFAULT '[]'` requires `@ColumnInfo(defaultValue = "[]")` on the entity field or validation fails.
  - One Gradle build-cache entry was corrupted by an earlier interrupted run (`Couldn't move cache entry ... .part`); one `--no-build-cache` run cleared it.
- **Decisions made:**
  - DB version **1 → 2**; additive `MIGRATION_1_2` on `video_pages`: `highlightsJson TEXT NOT NULL DEFAULT '[]'`, `readerJson TEXT NULL`. Entity fields carry matching Kotlin defaults so all existing named-arg call sites compile unchanged.
  - Parsed accessors live on BOTH `VideoPageEntity` (computed `highlights`/`reader`) and `LoadedVideoPage` (converter-mapped fields, defaulted so existing test constructors compile).
  - Test deps added beyond spec's "ONLY readability4j" (necessary enablers for the required migration unit test): `org.robolectric:robolectric:4.15.1`. Tried and reverted: room-testing (+jvm variant), sqlite-bundled, androidx.test:monitor — not needed by the final approach.
  - `fetchedAt` kept after defaulted params exactly as specced → construct `LinearArticle` with named args.
- **Open questions:** none blocking. Downstream tasks: reader extraction task owns actually writing `readerJson`; sync task decides whether `highlightsJson` joins the Drive payload.
- **Progress:** All scope items implemented and verified.

### Exact public signatures as landed
```kotlin
// data/model/LinearArticle.kt
@Serializable data class LinearArticle(
    val url: String, val title: String?, val byline: String? = null,
    val blocks: List<LinearBlock> = emptyList(), val wordCount: Int = 0,
    val fetchedAt: Long, val truncated: Boolean = false,
)
@Serializable data class LinearBlock(
    val kind: String, val text: String,
    val annotations: List<LinearAnn> = emptyList(),
    val imgUrl: String? = null, val imgAlt: String? = null,
)
@Serializable data class LinearAnn(val kind: String, val start: Int, val end: Int, val target: String)

// data/db/AppDatabase.kt (version = 2)
val MIGRATION_1_2: Migration  // AppDatabase.MIGRATION_1_2

// data/db/VideoPageEntity.kt — new columns + accessors
// entity: highlightsJson: String = "[]" (@ColumnInfo defaultValue "[]"), readerJson: String? = null
val VideoPageEntity.highlights: List<PageHighlight>  // computed, via ScholiastJson
val VideoPageEntity.reader: LinearArticle?           // computed, via ScholiastJson
// LoadedVideoPage: highlights: List<PageHighlight> = emptyList(), reader: LinearArticle? = null

// data/notes/PageHighlightRepository.kt
interface PageHighlightRepository {
    suspend fun highlights(url: String): List<PageHighlight>
    suspend fun upsert(url: String, hl: PageHighlight)
    suspend fun delete(url: String, id: String)
    suspend fun replaceAll(url: String, list: List<PageHighlight>)
    suspend fun saveReaderArticle(article: LinearArticle)
    suspend fun readerArticle(url: String): LinearArticle?
    fun pagesWithHighlights(): Flow<List<PageListItem>>
}
data class PageListItem(val url: String, val title: String?, val domain: String,
                        val highlightCount: Int, val lastOpenedAt: Long?)

// data/prefs/ReaderPrefs.kt
data class ReaderSettings(val fontStep: Int = ReaderPrefs.DEFAULT_FONT_STEP,
                          val serif: Boolean = false, val wideWidth: Boolean = false)
class ReaderPrefs(context: Context) {
    val settings: Flow<ReaderSettings>
    suspend fun load(): ReaderSettings
    suspend fun setFontStep(step: Int)   // clamped 0..4
    suspend fun setSerif(serif: Boolean)
    suspend fun setWideWidth(wideWidth: Boolean)
    companion object { const val DEFAULT_FONT_STEP: Int = 1
                       const val MIN_FONT_STEP: Int = 0; const val MAX_FONT_STEP: Int = 4 }
}
```

### Verification
- `./gradlew assembleDevDebug` — BUILD SUCCESSFUL.
- `./gradlew testDevDebugUnitTest --tests "*LinearArticleSerializationTest*" --tests "*VideoPagesMigrationTest*"` — 2 tests, 0 failures, 0 errors, 0 skipped.
- Schema exported: `app/schemas/com.scholiast.android.data.db.AppDatabase/2.json` (version 2).
