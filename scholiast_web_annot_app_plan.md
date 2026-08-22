This plan specifies the complete design for webpage annotation on Android: architecture, data model, every feature's behavior, the UI/motion system, testing, milestones, and risks. All decisions were locked through the Q&A in this design session; evidence citations refer to source code actually read in the referenced open-source projects (cloned and inspected during planning).

1. Product overview
1.1 Goal
While reading an article on the Android tablet/phone, the user can:

Share any URL from any browser → it opens in Scholiast's Reader.
Read the extracted article natively (dark-mode aware, adjustable typography).
Select text → floating pill → tap a color to highlight (two taps total).
Tap the pill's mic, speak, review the transcription in the editor, save — the comment attaches to the highlight silently (badge only).
Everything syncs to Drive; desktop dashboard and Obsidian plugin see the same annotations; desktop-made highlights paint in the Reader.
1.2 Relationship to existing features
Sibling of the Player (YouTube) surface — same patterns, same stores, same sync engine.
Video features are untouched. Reader annotations live in the page-highlights category of PageRecord (highlights[]), which the app previously only passed through from sync snapshots.
1.3 Design principles
Selection is the mode — no annotation mode, no toolbar; creation requires a deliberate pill tap.
Voice-first — identical speech stack to the player (Groq/Gemini/local FUTO).
Never lose a spoken word — transcription drafts survive sheet dismissal.
Data-compatible — byte-compatible PageRecord, same merge rules, same Drive layout.
Calm reading chrome — motion follows the project's apple-design/emil-design-eng rules (§6.5); nothing animates that is used dozens of times a day.
2. Locked decisions (from Q&A)
Area	Decision
Rendering	Native-first hybrid: extracted article rendered in Compose; automatic WebView fallback when extraction fails/empty
Formatting fidelity	User accepts reader-mode formatting changes ("don't mind changing formatting as long as everything renders correctly")
Extraction library	net.dankito.readability4j:readability4j:1.0.8 — the exact artifact Feeder & Read You ship (verified in both build files)
Grabber patch	Copy Read You's RYArticleGrabberExtended.kt (86 lines, GPL-3.0) — closer to Mozilla's current node-prep loop; license logged like the FUTO vendor note
Anchoring	Two-way, quote-anchor based. Kotlin port of shared/anchor.ts create+resolve (exact → whitespace-insensitive → fuzzy), golden-tested against the TS test fixtures. WebView fallback reuses the TS directly
Annotation mode	Dropped — selection-driven; no toolbar (web's mode gating is meaningless on touch)
Comment display	No column ever. Bottom sheet (portrait phone) / docked side panel (tablet landscape ≥600dp)
STT flow	Quick preview: speak → transcription lands pre-filled in CommentEditorSheet → review → Save
Draft safety	Dismissing the preview keeps the draft (session-scoped, keyed by highlightId); reopening the thread restores it
Voice-edit (Gemini rewrite)	Deferred v1.1 (reuses stubbed VOICE_EDIT route)
Home	Segmented Videos | Pages; Pages = favicon rows, cleaned titles, domain, highlight count, last-opened; tap resumes scroll %
Dropped v1	Pencil on pages · element/image highlights (v1.1) · diagrams · pasted images · LaTeX rendering (source preserved) · Obsidian REST push
Kept as-is	3 fixed hues + group recolor · overlap merging · #tag autocomplete · light-markdown editor · <!--timestamp:N--> format · per-page Drive sync · deep-link scroll+flash
Pencil/freehand	Stays video-frame-only
Wikipedia-style hybrid	Rejected as primary (verified: Wikipedia's app is itself WebView-based — correction recorded)
3. Architecture
3.1 High-level view
Share sheet / Open link ──► Routes.READER?url=…
                                      │
                    ┌─────────────────▼──────────────────┐
                    │            ReaderScreen            │
                    │  Compose chrome (auto-hide bar)    │
                    │                                    │
                    │   extracted? ──► NativeReader      │
                    │      (LazyColumn of blocks,        │
                    │       SelectionContainer,          │
                    │       SwatchPill, badges)          │
                    │                                    │
                    │   extraction failed? ──► WebView   │
                    │      fallback (+annotation bundle, │
                    │      Task 29)                      │
                    └───────┬────────────────────────────┘
                            │ ReaderViewModel (StateFlow)
        ┌───────────────────┼─────────────────────────────┐
        ▼                   ▼                             ▼
 ExtractionPipeline   HighlightRepository         VoiceRecorder +
 (Readability4J+RY    (Room: highlightsJson)      Transcriber chain
  grabber→Linearizer)                               (existing)
        │                   │                             │
        └────────► SyncEngine.syncChanged([url]) ◄───────┘
              (assembleLocalPage now reads REAL local highlights)
3.2 Tech stack (additions only)
Concern	Choice
Extraction	readability4j:1.0.8 (+ copied RYArticleGrabberExtended) over Jsoup DOM
Article model	Custom LinearArticle (Feeder-proven shape): flat block list + char-offset annotations
Rendering	Compose LazyColumn; blocks → AnnotatedString; images = Coil items with DisableSelection
Selection	SelectionContainer + onSelectionChange + TextLayoutResult.getBoundingBox() for pill positioning
Anchors	Kotlin port of shared/anchor.ts (AnchorKt), golden tests vs TS fixtures
Fallback	Existing WebView + small annotation JS bundle (Task 29)
3.3 Package structure (additions)
com.scholiast.android/
├── ui/reader/
│   ├── ReaderScreen.kt          # chrome + state host
│   ├── NativeReader.kt          # LazyColumn renderer
│   ├── SwatchPill.kt            # colors + 🎤 + 💬 (origin-aware)
│   ├── VoiceBubble.kt           # recording bubble
│   ├── ThreadSheet.kt           # bottom sheet / side panel adaptive
│   └── ReaderViewModel.kt
├── domain/reader/
│   ├── Extractor.kt             # Readability4J + RY grabber wiring
│   ├── Linearizer.kt            # Jsoup Element → LinearArticle
│   ├── LinearArticle.kt         # model (blocks, annotations, images)
│   └── AnchorKt.kt              # create/resolve quote anchors (ported)
└── data/
    ├── db/ (migration: highlightsJson, readerJson columns)
    └── notes/PageHighlightRepository.kt
3.4 Concurrency
Fetch+extract+linearize on Dispatchers.IO; result cached in Room; UI renders from DB state (instant reopen).
Highlight writes: optimistic in-memory → Room write → SyncScheduler.enqueueChanged(url) (existing debounced push).
Anchor resolution over long articles: single pass building collapsed-whitespace index once per render, cached per article (mirrors plugin's rootText caching lesson).
4. Data model
4.1 Principle
Android-created highlights are indistinguishable from desktop-created ones after sync. Unknown fields ride in extras (existing ExtrasPreservingSerializer) — nothing stripped.

4.2 Highlight shape (as written by the app)
{
  "id": "1787346000000",            // epoch-ms string, desktop-compatible ordering
  "type": "text",
  "color": "yellow",
  "notes": ["my spoken thought<!--timestamp:1787346012-->"],
  "updatedAt": 1787346012000,
  "content": "quoted text",          // desktop parity
  "anchor": {                        // canonical cross-surface anchor (shared/shape)
    "quote": "…", "prefix": "…", "suffix": "…", "occurrence": 0,
    "surface": "web"                 // reader text ≈ web text; keeps TS enum untouched
  },
  // extras (app-local hints, ignored by desktop):
  "hint": { "block": 14, "start": 32, "end": 118 }   // instant local repaint
}
groupId supported from day one (selection spanning blocks → one highlight per block, linked) — the merge/paint paths already handle groups.
hint makes local repaint O(1); if the article was re-extracted and the hint misses, fall back to quote resolution and rewrite the hint.
4.3 Room changes (migration N+1)
Table	Change
video_pages	+ highlightsJson TEXT NOT NULL DEFAULT '[]' (the hl: shard)
video_pages	+ readerJson TEXT (extracted LinearArticle + title/byline/wordCount/fetchedAt; NULL = not extracted)
One row per normalized URL continues to hold all shards (items/snap/meta/highlights/reader) — the established folding pattern. Non-video pages now legitimately own rows (videoId = null).

4.4 Sync spine change (the delicate one)
SyncEngine.assembleLocalPage (SyncEngine.kt:221) stops seeding highlights from snap and reads highlightsJson. Deletions become tombstones automatically via the base-vs-local diff in mergePageRecord — exactly how videoItems behave today. Golden tests (MergePageRecordTest) must remain byte-identical; new tests pin: create→sync, delete→tombstone, desktop-edit-pass-through.

4.5 Drafts
Session-scoped in-memory map drafts: Map<highlightId, String> in ReaderViewModel. Survives sheet dismissal and navigation within the process; lost on process death (accepted — spoken words are short to re-record). Not synced.

5. Features — detailed behavior
5.1 Entry points
Share sheet (ACTION_SEND text/plain, filter exists): YouTube URL → Player (unchanged); any other URL → Reader. Prose-wrapped URLs tolerated (existing regex scan).
Home "Open link": accepts any URL now; routes by type. Invalid → toast.
Home ▸ Pages tab: favicon rows (Coil favicon fetch, fallback letter avatar), cleaned title ( | Site tail dropped, matching dashboard rule), domain, highlight count, relative last-opened. Tap → Reader at saved scroll %. Long-press → remove from list (tombstones nothing; only clears reader cache row if no annotations).
5.2 Loading a page
URL → Normalize.normalizeUrl/urlHash (existing)
→ row lookup/create → cached readerJson? render instantly
→ else fetch (OkHttp, browser UA, 15s timeout) → charset detect (ICU, Feeder pattern)
→ Readability4J(+RY grabber).parse → Jsoup Element
→ Linearizer → LinearArticle (+title, byline, wordCount)
→ persist readerJson → render
Edge cases: HTTP error/paywall-wall → error card with "Open in browser" + retry; empty/garbage extraction (CSR shell detection: extracted text < 200 chars or < 3 blocks) → WebView fallback (§5.8); >400k chars → truncate with terminal notice + link (Feeder's valve).

5.3 Reading state (default UI)
Full-bleed reader column, max-width ~640dp centered on tablet; Material You dark surfaces; typography controls in the top bar overflow: A−/A+ (5 steps, persisted), serif/sans toggle, width narrow/wide.
Top bar: back · title (1 line, ellipsized) · sync dot · overflow (typography, open original, delete page data). Translucent, auto-hides on scroll-down, returns on scroll-up, tracks the finger 1:1 (§6.5).
Saved highlights paint inline immediately from highlightsJson (hints first, anchor-resolution fallback); badges 💬n at highlight end.
Scroll position persisted per page (row field) on debounce; restored on reopen.
5.4 Highlighting (the two-tap flow)
Long-press → native Compose selection handles → drag.
On selection-end, SwatchPill floats above the selection start (origin-aware scale-in): 🟡 🟢 🔴 · 🎤 · 💬.
Tap color → highlight paints synchronously (span applied before anything async), haptic tick same frame, pill dismisses, badge appears.
Multi-block selection spanning blocks → grouped highlights (groupId), one per touched block; recoloring any piece recolors the group (parity with desktop).
Overlapping/adjacent same-color selections merge (port mergeOverlappingHighlights semantics).
Pill auto-dismisses on scroll, selection collapse, or tapping elsewhere. Selection inside images/code captions suppressed (DisableSelection zones).
5.5 Comments & threads
Tap a highlight or its badge → ThreadSheet: quoted text pinned top (color-railed), thread below, reply box at bottom (mic + keyboard icons, formatting bar — the existing CommentEditorSheet components).
Adaptive: ModalBottomSheet < 600dp width; docked right panel ≥ 600dp landscape (no scrim — parallel surface, translucency only).
Replies: append text<!--timestamp:N--> to notes[]; per-reply delete; whole-thread delete only when 2+ replies (desktop parity).
Edit existing comment: inline in sheet (text editing); Gemini voice-edit deferred v1.1.
Save/close → enqueue targeted sync. Per-reply cloud-sync icon (pending → synced) carried over if cheap.
5.6 Voice flow (Quick preview + keep-draft)
🎤 in pill → VoiceBubble near selection (pulsing ring, elapsed, tap-to-stop)
→ stop → transcriber chain (Groq → Gemini-prompt → local FUTO; existing SpeechDependencies)
→ CommentEditorSheet opens PRE-FILLED (sheet never blocks the page visually on tablets)
→ Save   → notes[] append → badge 💬1 → haptic + toast "Note attached" (with Undo)
→ Dismiss→ draft kept (session map) → reopening thread restores text in the box
Recording bubble: compact (~180×48dp), positioned below the pill anchor, clamped to viewport; recording state identical to player's MicButton language.
No video pause semantics here. Offline → local STT path (existing dimming rules for cloud-only features).
Failures: transcriber error → bubble shows retry/discard; nothing saved silently.
5.7 Tag autocomplete, markdown, sync status
All inherited: # dropdown from TagIndex (Room), bold/italic/lists/checklist via existing editor, serialization through the app's existing comment-markdown subset. Diagram/image buttons hidden in Reader context (v1 drop list).

5.8 WebView fallback (Task 29)
Trigger: extraction failure/CSR shell, or user picks "Original view" from overflow.
Same route, alternate content host: WebView loads the live URL (Chrome UA spoofed), injects the annotation bundle (webpack entry reusing extension modules: anchor create/resolve, xpath+offsets, trim-range, Custom-Highlight painting, swatch/badge UI) behind an AndroidBridge JSInterface.
Bridge: JS→K highlightCreated/Updated/Deleted(json); K→JS paintHighlights(json), revealHighlight(id).
Same Room store, same sync — surfaces interchangeable. Until Task 29 ships, fallback opens read-only (view, no annotate) with a toast — graceful, honest degradation.
5.9 Deep links & cross-surface round-trip
Dashboard/desktop "open at annotation" links (#sc-hl=<id>) work in Reader: resolve → scroll to block −⅓ viewport → emphasis flash 2.6s (desktop parity).
Round-trip exit criteria: highlight+comment on tablet → visible in desktop dashboard → edit comment on desktop → merged back on tablet; desktop-made highlight (xpath broken, quote-only) paints in Reader via fuzzy tier.
5.10 Offline behavior
Feature	Online	Offline
Cached article reading + annotating	✓	✓
New page fetch	✓	✗ (error card, retry)
Voice (local STT)	✓	✓
Voice (cloud)	✓	dimmed
Drive sync	✓	queued, auto-retried (existing worker)
6. UI/UX design
6.1 Tokens
Inherit the app's design system (plan §6.1) plus: reader max-width 640dp; type scale steps 16→22sp; serif option = system serif; highlight hues unchanged (#F9E64D/#FF5A5A/#5FE3A0 at 32% alpha fill + solid 2dp rail-less underline-free paint matching desktop alpha feel).

6.2 Component library (new)
SwatchPill · VoiceBubble · BadgeChip · ThreadSheet · ReaderTopBar · TypographyPopover · ExtractErrorCard · CoachMark (first-run, once).

6.3 Screen designs
As specified in §5.3–5.6. Empty states: Pages tab empty → "Share any webpage to Scholiast"; extraction error card; no-annotations page → clean text only (chrome invisible until needed).

6.4 Interaction spec (touch)
Back-gesture unwind: close sheet → clear selection → exit reader (never trapped). All targets ≥48dp. TalkBack labels on pill buttons; highlight announce ("yellow highlight, 1 comment").

6.5 Motion & feel spec (apple-design + emil-design-eng, binding)
Frequency rule first: pill/badge = high-frequency → ≤160ms; sheets/toast = occasional → springs; coach-mark = rare → allowed delight.

Component	Enter	Exit	Physics
SwatchPill	scale .95→1 + fade, origin = selection anchor rect	reverse, faster	150ms ease-out cubic-bezier(0.23,1,0.32,1)
Highlight paint	instant span + single soft pulse	—	no enter anim; haptic tick same frame
Badge	scale .95→1 + fade	none	120ms
VoiceBubble	scale+fade from mic point	fade	150ms; ring pulse = linear, subtle
ThreadSheet (phone)	slide-up + scrim	same path	spring dampingRatio 0.8, response ~0.3s; drag 1:1 w/ grab offset; velocity-handoff release; rubber-band at bound; flick-dismiss at ~0.11 px/ms
Side panel (tablet)	slide from right, no scrim	exits right	same spring
Toast	rise+fade bottom-center	drop bottom	200ms; timer pauses while touched; carries Undo
Top bar	tracks scroll 1:1	—	never animates independently of finger
Latency audit (non-negotiable): pill on selection-end immediate (no debounce); color tap paints synchronously, Room write after visual commit; transcription fills field same frame it returns; zero spinners on local ops. Reduced-motion ("Remove animations"): transforms → opacity cross-fades, springs dropped, nothing blocked. Haptics only on commit moments (paint, save) — utility rule.

7. Build & project setup
No new Gradle modules. New deps: readability4j:1.0.8 (pulls Jsoup), Coil already present.
Vendored file: domain/reader/RYArticleGrabberExtended.kt — GPL-3.0 header retained; LOG.md entry records the FUTO-style personal-use posture.
Flavor/build commands unchanged (assembleDevDebug + Waydroid install per android/AGENTS.md §5).
8. Testing strategy
Layer	Approach
Unit	AnchorKt golden tests vs shared/anchor.test.ts fixtures (create + exact/ws-insensitive/fuzzy resolve); Linearizer fixtures (article → blocks snapshot); extraction fixtures (saved HTML pages incl. DIV-wrapped paragraphs, paywalled shell, CSR shell); merge regression (existing suite stays green)
Integration	MockWebServer: fetch→extract→persist chain; sync round-trip create/delete/pass-through
UI (Compose)	selection→pill→highlight; multi-block grouping; voice flow save/dismiss-draft/restore; sheet adaptive breakpoint; deep-link reveal
Device	Tab S-class w/ S-Pen portrait+landscape; gesture-feel checks on real hardware (Waydroid misrepresents touch physics); cross-client smoke vs desktop extension via Drive
9. Milestones & phasing
Milestone	Contents	Exit criteria
R1	Tasks 23+24: routing, Reader shell, Home Pages tab, extraction pipeline + linearizer + persistence	Share article → clean native read; reopen instant; fallback error card
R2	Task 25: Room migration, repository, assembleLocalPage real-highlights, sync push/pull	Two-device sync verified; golden tests byte-identical; delete→tombstone proven
R3	Task 26: selection layer, anchors (Kotlin port + goldens), painting, badges, grouping, deep-link reveal	Two-tap highlighting; desktop-made highlights paint in Reader
R4	Task 27: voice flow end-to-end (bubble→transcribe→preview→save→sync)	Speak-a-note round-trip; draft survives dismissal
R5	Task 28: threads/side panel, actions (recolor/delete-undo), typography controls, motion-spec pass, coach-mark, a11y	Release-candidate feel pass on device
R6	Task 29: WebView fallback + annotation bundle	Unextractable pages fully annotatable; surfaces interchangeable
10. Risks & mitigations
Risk	Impact	Mitigation
Extraction fails on steady % of pages	Feature feels unreliable	Shell detection thresholds; honest error card; R6 fallback; RY grabber patches; fixture suite pins regressions
CSR/SPA pages return empty HTML	No content to extract	Same as above — detected, not silently wrong
Anchor divergence (extracted text ≠ live DOM)	Desktop↔Reader mis-resolves	Quote anchors computed over linear text; ws-insensitive + fuzzy tiers ported with quality gates; hints avoid local flapping
assembleLocalPage change done wrong	Tombstones desktop highlights	R2 gate: golden suite + explicit pass-through tests before any UI ships
Selection-coordinate API gaps in Compose	Pill misplacement	getBoundingBox(range) util with clamping; tested at screen edges/rotation
Readability4J staleness	New-site heuristic drift	Patch-forward strategy (RY pattern); escape hatch documented: run Mozilla readability.js in offscreen WebView later
GPL vendoring	License constraint if ever distributed	Logged; swap-out isolated behind Extractor interface
Huge articles jank	Scroll jank	Truncation valve (400k chars); LazyColumn; single-pass anchor index cache
Login-walled content unreachable	Some pages unreadable	Accepted (same as desktop clipper); "open original" hand-off
11. Open items
None blocking. Two recorded assumptions, flip-cheap: drafts are session-scoped (not persisted across process death); typography controls limited to size/serif/width (more later if wanted).

12. Ported / evidenced module map
Source (verified)	App destination	Notes
readability4j:1.0.8 (Readability4JExtended)	domain/reader/Extractor.kt	Exact artifact used by Feeder FullTextParser.kt + Read You Readability.kt
Read You RYArticleGrabberExtended.kt	domain/reader/ (vendored)	GPL-3.0; 86 lines; matches Mozilla node-prep loop
Feeder HtmlLinearizer.kt / LinearArticle shape	domain/reader/Linearizer.kt	Flat blocks + char-offset annotations; truncation valve
Read You HtmlToComposable.kt (itself Feeder-derived)	ui/reader/NativeReader.kt	Tag-by-tag LazyListScope emission; images as items w/ DisableSelection
shared/anchor.ts	domain/reader/AnchorKt.kt	Create + 3-tier resolve; golden-tested vs TS fixtures
Extension mergeOverlappingHighlights, trim-range semantics	domain/reader/ ports	Grouping + boundary hygiene parity
Existing app: VoiceRecorder, Transcribers, CommentEditorSheet, TagIndex, SyncEngine, Normalize	reused as-is	Zero changes outside the listed spine points


---

# Revision B — WebView pivot (post-native post-mortem)

Status: LOCKED (user Q&A). Supersedes the native-first hybrid for the READER SURFACE ONLY;
everything outside the reader (voice, sheets, sync spine, routing, storage) stands.

## Why
Hands-on testing showed the native selection system (Compose 1.9 internalized its selection
API, forcing a hand-built parallel selection machine: SelectionTracker geometry, drag state,
word snapping) to be unfixable whack-a-mole — fixing one defect surfaced others. A WebView
deletes the problem class: OS text selection is free, HTML renders images/lists/links/anchors
correctly by definition, and the ANNOTATION KERNEL IS ALREADY WRITTEN — it is the desktop
extension's TypeScript (`shared/anchor.ts`, `highlighter-overlays.ts` painting, swatch popup),
battle-tested on the live web for months.

## Locked decisions
| Area | Decision |
|---|---|
| Flutter | DEFERRED. Full-app rewrite rejected for now (would invalidate working voice/sync/player systems; desktop covered by extension + Obsidian plugin + dashboard). Revisit only if a desktop-native need emerges. |
| Rendering | **Cleaned reader HTML**: OkHttp fetch → Readability.js (Mozilla original) inside the WebView → sanitized DOM styled by OUR stylesheet (dark palette, typography vars). Pocket-style; ads/nav never present. |
| Annotation kernel | Bundled TS from this repo's own modules (anchors incl. fuzzy resolve, Custom Highlight API painting, swatch pill, badges) behind an `AndroidBridge` JS↔Kotlin contract. |
| Dark mode | Reader CSS variables = app palette; toggle re-renders instantly. |
| Native reader code | DELETE IMMEDIATELY (user decision): ReaderBlockText, SelectionTracker, HighlightController/Painter, SwatchPill, Linearizer render path, snapToWords, NativeReader block renderer. Kept: AnchorKt + golden tests (reference), Extractor fixtures reference, ThreadSheet/Voice/controllers/repository/sync. |
| Storage | Unchanged: highlights ride PageRecord.highlights through the same merge; extracted article cached in Room (`readerJson` now stores cleaned HTML string + title/byline) for offline reopen. |

## Bridge contract (JS ↔ Kotlin)
JS→K: `highlightCreated(json)`, `highlightUpdated(json)`, `highlightDeleted(id)` (each fires
repository writes + enqueueSyncNow inside Kotlin).
K→JS: `paintHighlights(jsonArray)`, `revealHighlight(id)` (scroll+pulse), `setReaderTheme(dark,
fontPx, serif, wide)`, `getArticleText(cb)` (copy-article), `getScrollPct()/scrollToPct(p)`
(persistence + deep links).

## Tasks
| # | Task | Wave |
|---|---|---|
| 34 | `android-reader` webpack bundle: Readability.js + kernel + reader.css → single assets | 1 |
| 35 | ReaderWebScreen: WebView host + bridge + chrome (dark/copy/typography/scroll/deep-link), voice+ThreadSheet remount | 2 |
| 36 | Delete native-selection stack + regression pass + docs + install | 3 |
