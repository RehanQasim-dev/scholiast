# task-32 — Reader Integration & Verification

## 2026-08-24 — IN PROGRESS → DONE

Integration task: closed the seams flagged by tasks 28/29/30/31, ran the full
verification checklist. Cross-file touches are listed under "Blast radius" —
every edit outside `task-32`'s nominal scope is justified there.

### Integration gaps closed

**(a) SwatchPopup 💬 closes-only → full comment-from-selection chain**
- `src/reader/useHighlights.ts` — `createFromSelection` now resolves to the
  **representative highlight id** (`string | null`, first payload = what
  ThreadPanel treats as the group's anchor) instead of `boolean`.
- `src/reader/ArticleView.tsx` — new `onHighlightCreated?` prop threaded
  ArticleView → HighlightsLayer; `handleComment` now creates the highlight
  (yellow default per task-29), clears the selection, and hands the id up.
- `src/routes/Reader.tsx` — passes `handleHighlightClick` as
  `onHighlightCreated` too, so 💬 rides the existing `selectRequest {id,
  nonce}` path into ThreadPanel (activates the new thread, scrolls it into
  view, focuses the reply). `handleHighlightClick` also now **drops focus
  mode**, which collapses the panel — without this a 💬/click in focus mode
  would land in a `w-0` aside and look like nothing happened.
- Tests: `ArticleView.highlights.test.tsx` new case "💬 creates a yellow
  highlight and reports it through onHighlightCreated" (persist + color +
  id hand-off + `<mark class="sc-hl-yellow">` repaint + selection cleared);
  `useHighlights.test.tsx` assertion updated to the id contract.

**(b) j/k contract end-to-end**
- Emission (`useReaderKeyboard`), consumption (`ThreadPanel` listener), `f`
  focus-mode collapse and `g g` were each covered by unit tests; the missing
  seam was the full-shell path. New `Reader.test.tsx` case: with an article
  + saved highlight, `j` activates `thread-card-hl-1` (`data-active=true`)
  **and** focuses the reply textarea; `g g` scrolls `article-scroller` to
  top. Reader.tsx gained `data-testid="article-scroller"` for stable
  targeting. All prior keyboard tests still green.

**(c) Static audits of the two pending manual gates**
- Task-30 offline-voice gate (`useVoiceComment.ts`): add-flow matrix is
  correct — `offline && !localReady` → "Needs internet"; no Groq/Gemini key
  and no offline local model → "Set up speech in Settings"; edit flow is
  Gemini-only per §6.5.3. `transcribeWav` re-checks `navigator.onLine`
  **live at stop-time** and routes `stt_local_transcribe` (language pref,
  `activeLocalModel || null` → Rust first-installed fallback). Two benign
  caveats documented: (1) capability probe is session-cached, so installing
  a local model mid-session needs an app restart; (2) online-start →
  offline-stop without a local model fails loudly with a surfaced toast —
  acceptable failure mode. Real-audio verification stays with the user.
- Task-31 no-layout-jump gate (`ThreadPanel`/`ThreadCard`): reply composer
  lives in a fixed panel-bottom section (never mounts/unmounts on card
  expand — activation only swaps content inside it); quote chip is
  line-clamped to 2; cards keep stable keys so expansion re-renders one
  card section without remount flicker; `scrollIntoView` calls degrade to
  instant under `prefers-reduced-motion`. No jump defects found statically.

### Checklist evidence

1. **E2E vs real article** — `real_article_extract_annotate_persist_loop`
   (`src-tauri/src/commands/reader.rs`, `#[ignore]`, run with `--ignored`):
   live fetch of `en.wikipedia.org/wiki/Highlighter` → extraction → sanitize
   (9037-byte body, no `<script`) → 3 highlights (yellow/red/green) →
   comment (`format_note`, id preserved) → recolor yellow→green →
   delete + undo-restore (snapshot byte-equal, red comes back) → re-read
   asserts `["green","red","green"]` + comment body/id. Notable real
   finding: **example.com itself is rejected `NotReadable`** — the
   extractor's junk-page guard works on real input. Interactive
   mouse/keyboard steps: see "Deviations".
2. **Sync round-trip** — Drive NOT configured (no keyring refresh token; no
   `SCHOLIAST_GOOGLE_CLIENT_ID` in env): `sync_now`/scheduler surface
   "Drive is not connected" as a graceful error (live evidence: the Home
   "Sync failed" chip during the smoke boot) and the queue is never dropped
   (`offline_failure_leaves_queue_and_bookkeeping_intact`,
   `unchanged_pages_skip_without_network_work`). `oauth.local.json` exists
   at repo root, but a real Drive round-trip needs an interactive consent
   grant — **DEFERRED**, exact steps in "Deferred" below.
3. **Cross-client data check** — new
   `annotated_article_record_serializes_with_extension_field_names`
   (`src-tauri/src/store/assembly.rs`): assembles an annotated article
   (grouped pair + comment note + full portable anchor) and pins the
   serialized names to the extension shapes (`version`, `url`, `title`,
   `videoItems`, `drawings`, `diagrams`, `tombstones`; highlight `type`,
   `xpath`, `startOffset`, `endOffset`, `content`, `notes`, `color`,
   `groupId`, `updatedAt`; anchor `quote/prefix/suffix/occurrence` +
   `structural.surface/xpath/startOffset/endOffset`) — spot-checked against
   `src/utils/highlighter.ts` HighlightData/TextHighlightData and
   `shared/anchor.ts`.
4. **Motion/a11y audit** — aria-labels present (22 across reader surfaces:
   topbar icon buttons, rail input/filter/items with `aria-current`,
   swatches, reply composer, format buttons); `prefers-reduced-motion`
   honored globally (`tokens.css` media query kills transitions/animations/
   scroll-behavior) and in JS (`prefersReducedMotion()` guards both
   `scrollIntoView` sites). **Gap found + fixed**: no guaranteed visible
   focus indicator — added a token-based `:focus-visible` outline
   (2px accent, 2px offset) in `tokens.css` `@layer base`, so every
   rail/topbar/panel control shows a keyboard ring without restyling
   pointer clicks. Panel actions are real `<button>`s → tab-reachable.
5. **Perf sanity** — new `highlightPaint.test.ts` case: 300-paragraph
   fixture, 300 real `createAnchor`-captured highlights, 5 timed `paint()`
   passes: **cold=15.37ms, best=14.11ms, median=15.33ms per pass**
   (logged; jsdom — the real WebKitGTK DOM is faster). Within the ~16ms
   frame budget. Assertion is a generous <200ms regression guard.
6. **Final builds** — `cargo clippy --workspace --all-targets -- -D
   warnings` ✓ clean · `cargo test --workspace` ✓ **161 passed / 0 failed**
   (+1 `#[ignore]`ed network test, run explicitly above) · `pnpm lint` ✓ ·
   `pnpm typecheck` ✓ · `pnpm vitest run` ✓ **30 files / 209 tests** ·
   `pnpm tauri build --debug` ✓ →
   `target/debug/bundle/deb/Scholiast_0.1.0_amd64.deb`. Boot: built binary
   with `GDK_BACKEND=x11`, `wmctrl` id `0x00800003`, screenshots
   `/tmp/opencode/reader-home-1.png` + `reader-home-2.png` — **Home renders
   correctly** (sidebar, YouTube hero, "Paste an article URL to read +
   annotate", Sync chip; after the 15-min tick the chip correctly shows
   "Sync failed" while unconnected). Restart-persistence check: seeded a
   page + 3 highlights + comment into the app DB via sqlite3, relaunched,
   app booted clean over the seeded data (Home's RECENT grid is
   videos-only by design — articles surface in the Reader rail, which needs
   one click; see Deviations). Seeded rows removed afterwards; app process
   killed; DB back to its prior state.
7. **Board** — README.md verification summary updated; tasks 23–31 were
   already DONE, task-32 set DONE.

### Blast radius (cross-file touches, per integration mandate)
- `src/reader/useHighlights.ts` (task-29's, unowned) — id-returning create.
- `src/reader/ArticleView.tsx` (task-29's, unowned) — 💬 chain.
- `src/routes/Reader.tsx` (task-31 wiring, additive) — prop + focus-mode
  drop + testid.
- `src/styles/tokens.css` (shared scaffold) — `:focus-visible` rule.
- `src-tauri/src/store/assembly.rs`, `src-tauri/src/commands/reader.rs` —
  additive tests only.
- Test files: `useHighlights.test.tsx`, `ArticleView.highlights.test.tsx`,
  `Reader.test.tsx`, `highlightPaint.test.ts`.
No other files touched; no feature added beyond the flagged seams.

### Deviations / deferred
1. **Interactive UI loop** (physical select→swatch→type): input injection
   is unavailable in this session — no xdotool; `wtype` rejected
   ("Compositor does not support the virtual keyboard protocol");
   `ydotool`/ydotoold runs but its uinput events never reach the compositor
   (verified by pixel-diff screenshots on hover/typing attempts). Covered
   instead by: 44 reader-surface tests (selection→popup→persist→repaint,
   💬 chain, j/k/f/g g, recolor/delete/undo, reply persistence) + the
   real-network Rust E2E + boot screenshots. Physical-interaction pass
   remains a 5-minute human gate.
2. **Real Drive round-trip DEFERRED** — needs a user-granted OAuth refresh
   token. Exact steps: (a) launch the app, Settings → Sync → Connect,
   complete the Google consent in the browser (loopback PKCE flow stores
   the refresh token in the OS keyring, service `scholiast`); (b) annotate
   an article; (c) Sync now; (d) verify `pages/page-<urlhash>.json` in the
   Drive appData folder and pull it with the extension's client (same GCP
   project ⇒ same appData folder) to confirm field parity — the serde
   contract is already pinned by the item-3 test.
3. Flatpak manifest validation (task.md wording) not run — no
   `flatpak/` manifest exists in the repo (deb is the only bundle target
   wired); nothing to validate. Noted for the orchestrator.
4. Frame-capture round-trip and offline-voice remain user manual gates
   (per prior tasks' logs; unchanged by this task).

### Gates (final, from `scholiast_tauri/`)
- `pnpm lint` ✓ · `pnpm typecheck` ✓ · `pnpm vitest run` ✓ 30 files / 209 tests
- `cargo clippy --workspace --all-targets -- -D warnings` ✓
- `cargo test --workspace` ✓ 161 passed / 0 failed
- `pnpm tauri build --debug` ✓ deb bundle; boot + screenshots logged
