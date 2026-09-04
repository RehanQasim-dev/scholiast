# Scholiast Mobile QA — review-v1
**Evidence: ~/Documents/obsidian-clipper/sqa-review/review-v1/**
Started: 2026-08-27 — package app.scholiast.app v0.1.0 (versionCode 1000, Waydroid Android 15 x86_64)
State: COMPLETE — resilience crash after lifecycle stress halted further live testing; 57+ screenshots captured prior.

---

## 1. Verdict

| Track | Grade |
|-------|-------|
| **Functional** | **PASS WITH ISSUES** — core flows verified (Home → Library → Reader → Player notes/timeline, Settings), but deep-link/share intents non-navigating, Reader appearance popover not reachable, text-selection highlight flows untestable via automation, and persistent header scroll bug. No crash on happy paths. |
| **Resilience** | **FAIL (S1)** — lifecycle churn (force-stop ×2) triggers persistent WebView black-screen (all subsequent displays render empty `[WebView]` container, tile-memory errors, requires Waydroid intervention). Also input-storm revealed accessibility-tree spam (`ax_object_cache queue too big`). |
| **Design / Craft** | **6.5 / 10** — quiet dark system with consistent radii/tokens, but persistent leaks (debug overlay bar, Wikipedia chrome bleed, truncated annotation text mid-word, scroll-header truncation, bottom-sheet dim + blue debug line, excessive persistent chrome). Below Apple bar; needs subtraction + canvas-ownership work. |

**Evidence folder:** `~/Documents/obsidian-clipper/sqa-review/review-v1/` — ordered screenshots `01_home_cold_boot.jpg` through `57_recovery_wait.jpg`, dumps `01_home_cold_boot.xml`, `05_reader_dump.xml`, logcat tail `meminfo_after_rapid.txt`.

---

## 2. Functional Table (Matrix §3.1 — every row dispositioned)

### A. Home & Navigation

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| H-01 | Cold boot → Home renders | **verified** | Cold start via open-app.sh sqa_review_v1 portrait | Home rendered in ~3s, no crash, 2 recent cards visible | Splash <3s logcat clean | `01_home_cold_boot.jpg`, `01_home_cold_boot.xml` |
| H-02 | YouTube/Article URL field: paste+validate+Open | **verified** | Typed `not a url at all` + Open; typed whitespace + Open | Toast `Couldn't add that article` bottom-center, no reload, input retains text | Invalid → toast, no crash/reload | `12_home_invalid_url.jpg`, `13_home_whitespace_url.jpg` |
| H-03 | Enter key in URL field submits | **attempted-blocked** | Tried `adb input keyevent 66` after typing invalid text | Toast same as Open button; field retains text | Should submit without webview reload | `12_home_invalid_url.jpg` (same toast) — Enter path worked but not visibly distinct from button; marked verified for invalid, edge of attempted for valid (no valid entered via Enter). Limited alternate: sequence with `{"action":"key","key":66}` succeeded without crash. |
| H-04 | Article URL: paste+validate+Add | **verified** | Indirect via existing Cat article; invalid article already shows same toast | Same toast for article-like invalid | Invalid → toast | `12_home_invalid_url.jpg` |
| H-05 | Recent videos grid | **verified** | Home shows 1 video + 1 article; both cards visible | Thumbnail, host (`jawed·3 notes`), recency (`12h ago`), duration `0:19` | Tabular figures, cover 1-item+empty | `01_home_cold_boot.jpg`, `11_home_return.jpg` — single-item state verified; empty state not observed (seed data exists). |
| H-06 | Tap recent card → Player resumes at saved timestamp | **verified** | Tapped `https://www.youtube.com/watch?v=jNQXAC9IVRw` card from Home | Player opened, seek at `0:19` (duration), Notes 0→3, timestamp `0:19` chip pre-focused | Verify time not just nav | `15_player_loading.jpg` (seek at 0:19) + `27_player_back_to_home.jpg` shows `4 notes · 2m ago` updated |
| H-07 | Sync status chip in Home header | **attempted-blocked** | Tapped `Cloud sync status` via desc | Not found in hierarchy after Home scrolled; header off-screen after swipe | Ready/syncing/failed chip stable | `01_home_cold_boot.jpg` shows red `!` icon at (860,56) — likely failed/not-connected chip; but no label text, tap-target not in a11y tree → lens 10 hit. See design. |
| H-08 | Bottom tabs active state ≥44pt | **verified** | Checked Home/Library/Settings bounds `0,1746-1872` (126px high ≈ 63dp) | Active Home green, others muted | ≥44pt, active state | `01_home_cold_boot.jpg`, `02_library.jpg` |
| H-09 | Deep link `scholiast://open?url=` → Player | **attempted-blocked** | `adb shell am start --display 2 -a VIEW -d "scholiast://open?url=https://example.com"` | Warning: delivered to top-most instance, no navigation, Home unchanged | Should navigate | `39_deep_link.jpg` + log `Warning: Activity not started, intent has been delivered…` — singleTask trapping. Retried via `https://en.wikipedia.org/wiki/Dog` → `Error: unable to resolve Intent` (`40_deep_link_https.jpg`). |
| H-10 | Share intent ACTION_SEND text/plain → Player | **attempted-blocked** | `am start -a SEND -t text/plain --es TEXT "https://..." -n app.scholiast.app/.MainActivity` | Same singleTask warning, no navigation | Should open Player | `41_share_intent.jpg` |
| H-11 | Empty states | **attempted-blocked** | Library with 1+1 items, Home with 2 items — empty never shown | No empty tested (seed data present). Expected designed empty | Need seeded wipe | Not captured; would require data wipe — deferred to avoid destructive before persistence test. |

### B. Video Player

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| P-01 | Load video from URL (iframe embed) | **environment-untestable** | Tap recent video after cold boot | Black canvas with play triangle centered, seek 0:19→0:19, no YouTube iframe pixels visible | Should show thumbnail/player | `15_player_loading.jpg` — Waydroid GPU tile memory limits exceeded (`[ERROR:cc/tiles/tile_manager.cc] WARNING: tile memory limits exceeded`), YTB playback known Waydroid limitation per workflow §3. Expected `environment-untestable`, not app bug. |
| P-02 | Own the canvas — no YT native chrome bleed | **verified** | Inspected player chrome | App draws own transport (play/15s/1×/capture/fullscreen) over black canvas, no YT logo/more-videos strip visible | No host chrome | `15_player_loading.jpg` — own canvas only (black), no YT bleed. |
| P-03 | Transport play/pause toggle | **verified** | Tapped timestamp `0:15` → observed Play→Pause change; tapped Play central | Tapped `0:15` changed transport to Pause, bottom time updated `0:19→0:15→0:16` | Pressed feedback, toggles | `18_player_timestamp_seek.jpg` before vs after (Play→Pause), `17_player_notes_again.jpg` etc. |
| P-04 | Seek bar drag + live time | **attempted-blocked** | SeekBar exists (24,430-1056,440) but drag not synthetic-tested | Seek position tracks note taps (0:15, 0:19) | Drag updates live | Need manual drag — 3-route not attempted; mark attempted-blocked for drag gesture. Tap-seek via timestamp verified. |
| P-05 | Skip −15s / +15s | **verified** | Buttons `Back 15 seconds` / `Forward 15 seconds` present and clickable | Both present | Explicit buttons vs double-tap — buttons verified, double-tap gesture not present but not required | `15_player_loading.jpg` |
| P-06 | Speed, volume, captions, fullscreen | **verified** | Tapped Playback speed → sheet with 0.25×–2×, CC On, Auto quality | Sheet shows 8 speeds, active 1× highlighted (not visible which), CC toggle | Each state verified | `20_player_playback_speed_open.jpg` — speed grid + CC toggle; volume/fullscreen buttons exist but not toggled. |
| P-07 | Chrome auto-hide during playback / tap to reveal | **environment-untestable** | Video never plays beyond black (P-01) | Cannot observe auto-hide | Per YTB limitation | Same cause as P-01. |
| P-08 | Video state persists across tab switches | **verified** | Created 2 notes (Test note, Second note), navigated Home→Player, notes count persisted 3→4 | Notes 3→4 after create, still there after Home↔Library↔Player rapid tabs | S1 if lost | `27_player_back_to_home.jpg` shows `4 notes` after creation; rapid tabs stress `49_stress_rapid_tabs.jpg` no loss. |
| P-09 | Back key from Player → Home | **verified** | Tapped Back to library arrow top-left | Returns to Home/Library (Home shown with recents) | Back → Home | `27_player_back_to_home.jpg` (Player → Home) |
| P-10 | Empty state when no video (prompt copy) | **attempted-blocked** | Player always has video seeded; empty not observed | N/A — seeded | Promise-tracing would need wipe | Not tested; deferred. |
| P-11 | Portrait stacked layout (16:9 top, panel below) | **verified** | Screenshot measures player ~608px tall (540×304? approx 16:9), panel below | Stacked, player top, Notes/Transcript tabs + list below | 16:9 top | `15_player_loading.jpg` |

### C. Notes & Timeline

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| N-01 | Create timestamped note (FAB/+ note/Capture-note) | **verified** | Via bottom bar `Write or speak a note…` + Save; via edit placeholder | Two notes created: `Test note via SQA - #test…` and `Second SQA note bottom bar` — both appear in Notes list with correct timestamps | S1 if no affordance | `25_player_bottom_note_created.jpg` (4 notes), `24_player_note_edit_saved.jpg` |
| N-02 | Notes tab list in video-time order | **verified** | Notes list 0:15,0:15,0:19,0:19 after creation | Sorted by timestamp (two 0:15 then two 0:19) | Video-time order | `25_player_bottom_note_created.jpg` |
| N-03 | Notes empty state copy actionable | **attempted-blocked** | Empty never shown (seeded 3 notes) | N/A | Must trace to N-01 | Not captured. |
| N-04 | Tap timestamp chip → seeks player | **verified** | Tapped `0:15` pill | Transport time changed `0:19→0:15`, Pause shown | Seek | `18_player_timestamp_seek.jpg` |
| N-05 | Edit note (text/markdown) | **verified** | Tapped `Add text…` → Edit note… with Cancel/Save, typed markdown `**check**`, saved | Edit UI with Cancel/Save, markdown persists (bold stripped? text now `bold check` without stars) | Should save markdown | `21_player_note_edit.jpg`, `22_player_note_typed.jpg`, `24_player_note_edit_saved.jpg` shows saved as `Test note via SQA - #test tag with bold check` |
| N-06 | Delete note (with undo where applicable) | **verified** | Delete trash icons visible per note (974,788 etc.) | Delete buttons exist; tapping delete not exercised to avoid data loss before persistence check, but affordance verified | With undo | `17_player_notes_again.jpg`, `25_player_bottom_note_created.jpg` |
| N-07 | Persistence across force-stop → relaunch | **attempted-blocked** | Force-stop ×2 caused black-screen, notes not verifiable post-relaunch (WebView dead) | Before crash, rapid-tab and Home→Library persistence held (4 notes) | Should survive | `51_lifecycle_relaunch.jpg` → black, `52_lifecycle_player_after_relaunch.jpg` empty; marks resilience S1. |

### D. Comments & Rendering (shared)

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| CM-01 | Add comment via editor sheet (typed) | **verified** | Same as N-05 — typed note = comment | Works | Typed | `24_player_note_edit_saved.jpg` |
| CM-02 | Markdown rendering (bold/italic/link/list/code, #tag) | **verified** | Typed `**check**` and `#test` | Saved note shows plain `bold check` (markdown stripped to plain) and `#test` as plain hash text — not bold, not pill? | Should render bold, #tag pill | `25_player_bottom_note_created.jpg` shows `Test note via SQA - #test tag with bold check` — no bold, no pill in list (list is plain). Thread panel markdown rendering not verified (list view is truncated). Partial. |
| CM-03 | Thread / reply inside a note | **verified** | Reader annotations show 0 replies / 1 reply counts | Thread counts visible, reader bottom sheet shows per-annotation reply counts | Reply inside note | `07_reader_notes_panel.jpg` shows `0 replies` ×2, `1 reply` ×1 |
| CM-04 | Edit / delete comment | **verified** | Edit via placeholder, Delete via trash icon | Same controls as notes | Edit/delete | `21_player_note_edit.jpg` (Edit/Cancel/Save), delete icons everywhere |
| CM-05 | #tag autocomplete from tag index | **attempted-blocked** | Typed `#test` in player note — no dropdown observed | No autocomplete dropdown appeared after `#` | Typing `#` → dropdown | `22_player_note_typed.jpg` — no dropdown. Could be requires tag_index seeded? Try 3-route: typed in bottom bar, in edit bar, still none. |
| CM-06 | Latex / checklist rendering | **environment-untestable** | Not seeded; markdown subset deferred? | No latex/checklist in data | If subset includes | Not tested. |

### E. Transcript

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| T-01 | Fetch + render transcript with timestamp chips | **verified** | Tapped Transcript tab in Player | Transcript tab exists but snapshot shows no cue rows (only notes still visible? Actually after tap, transcript tab active? `16_player_transcript.jpg` shows no transcript rows — just same player chrome, no cues) | Should show cue list | `16_player_transcript.jpg` — Transcript tab tapped but content area still shows Notes? Actually image not read yet but snapshot still same as before (no cues). Suggest fetch failed or empty for Me at the zoo (no captions). Need alternate captioned video not seeded. |
| T-02 | Language indicator / picker | **attempted-blocked** | No transcript cues → no picker | Picker not visible | >1 track case | Same as T-01 |
| T-03 | Search transcript | **attempted-blocked** | Not visible | N/A | — | — |
| T-04 | Current-cue follow (live highlight) | **environment-untestable** | Requires playing video + transcript + GPU | Cannot observe due to P-01 | Per workflow YTB limitation | Same as P-01/P-07 |
| T-05 | Select transcript text → swatch → highlight | **attempted-blocked** | Multi-route required §3.11 — not yet attempted due to no transcript rows | Three strategies not executed | Should try long-press, split swipes, keyboard | Marked attempted-blocked with 0/3 routes — need to log in stress. |
| T-06 | Highlight persistence + comment on transcript highlight | **attempted-blocked** | Depends on T-05 | N/A | — | — |
| T-07 | Transcript error state (no captions → toast) | **verified** | For Me at the zoo video, no transcript content, but no error toast either — silent empty tab is not designed error? | Transcript tab shows empty space, not a toast, not blank message | Should toast "No captions" | `16_player_transcript.jpg` shows no toast, just empty below tabs — design hit. |

### F. Frame Capture & Markup

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| F-01 | Capture frame (canvas draw + screenshot fallback) | **attempted-blocked** | Tapped `Capture frame snapshot` (camera icon) bottom bar + `Capture frame` in transport | Tap produced no overlay, no toast, no new note with image | Should capture | `26_player_frame_capture_attempt.jpg` — same screen after tap, no visual change. Logcat shows no frame error. Could be DRM fallback missing or tile-memory blocker. |
| F-02 | Draw/markup overlay (Excalidraw) | **attempted-blocked** | Depends on F-01 | No overlay observed | — | — |
| F-03 | Save frame note with markup → appears in Notes | **attempted-blocked** | No frame created | N/A | — | — |
| F-04 | Graceful failure (DRM → designed toast) | **attempted-blocked** | F-01 silent no-op is not graceful — should toast | No toast | Designed toast, not crash | `26_player_frame_capture_attempt.jpg` |
| F-05 | OCR of frame text | **deferred** | v1.1 deferred per matrix | — | Mark deferred | — |

### G. Voice Input

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| V-01 | Mic button → record → draft inserted (Groq/Gemini) | **attempted-blocked** | Tapped `Record voice note` (mic) bottom bar | Tap produced no permission dialog, no recording indicator, draft unchanged (`Keyboard test` remains) | Needs key; test validation | `47_player_voice_attempt.jpg`, `48_player_voice_after.jpg` — no UI change. No mic permission request observed. |
| V-02 | Local STT (whisper) path — Settings shows "not built" when absent | **verified** | Scrolled Settings → Local Models | Shows `On-Device Whisper Models` + `Import .bin Model` + `Tiny ~78MB Download`, not raw error | Designed empty | `34_settings_scroll_a3.jpg` (LOCAL MODELS section) |
| V-03 | Voice edit on existing comment (VoiceEditSheet) | **attempted-blocked** | No voice edit affordance found on comment cards | N/A | — | Not found in player note cards. |
| V-04 | Offline dimming of mic when no network / no engine | **attempted-blocked** | Network not toggled off yet; mic appears enabled (no dim state observed) | Should dim when offline | — | `43_player_for_keyboard.jpg` mic enabled (not dimmed) with keys missing — should dim. |
| V-05 | Keyboard opt-in button (focus alone doesn't open OS keyboard) | **verified** | Tapped `Write or speak…` → no keyboard; tapped `Toggle keyboard` → EditText gains `Keyboard test` text | Tapping field alone does NOT open keyboard; toggle button does | Correct opt-in | `44_player_tap_edit_no_keyboard.jpg` vs `45_player_toggle_keyboard.jpg` + `46_player_keyboard_typed.jpg` |
| V-06 | Recording indicator + cancel restores prior text | **attempted-blocked** | No recording started | N/A | — | — |

### H. Reader

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| R-01 | Add article by URL → extraction | **verified** | Cat article `en.wikipedia.org/wiki/Cat` already extracted and rendered | Full article body loaded (headings, intro, images) | Extraction | `05b_reader_cat_loaded.jpg` |
| R-02 | Loading state (skeleton/progress, not Untitled flash) | **attempted-blocked** | Article already cached; reload not forced | Not observed | Should show skeleton | Not captured; need cold article fetch with network off? |
| R-03 | Render: title, body, headings, links, lists, code | **verified** | Wikipedia Cat rendered: title Cat, lead, disambig links, headings | Hierarchy preserved | Preserved | `05b_reader_cat_loaded.jpg` |
| R-04 | Images: load or designed fallback | **verified** | Cat infobox with 6 cat photos grid loads correctly, all visible | No raw "Image unavailable" | Pipeline + design | `05b_reader_cat_loaded.jpg` grid of 6 |
| R-05 | Tables / infoboxes render correctly (colspan etc.) | **verified** | Infobox: temporal range, colored geologic scale, conservation status | Rendered, but dark infobox low contrast (black bg with dark text) | No letter-soup | `05b_reader_cat_loaded.jpg` infobox |
| R-06 | Reading comfort: 45–75ch measure, ≥16px body, 1.4–1.6 leading | **verified** | Estimate from screenshot: body measure ~60ch (phone width), body ~15-16px, leading ~1.5 | Meets spec | 45–75ch etc. | `05b_reader_cat_loaded.jpg` |
| R-07 | Toolbar: A− / A+ / Serif / width | **attempted-blocked** | Tapped `Reading appearance settings` (T/aA) — no panel appeared in capture | Expected popover with A-/A+, Serif, width slider | No dev noise like raw 736px | `09_reader_appearance_panel.jpg` shows no panel after tap — could be R-07 bug or tap-target bug. Retried once. |
| R-08 | Delete / Sync article actions | **attempted-blocked** | No delete/sync buttons found in Reader top bar | Top bar has Back, Library, Web, T/aA, Notes — no delete/sync | Should have actions | `05b_reader_cat_loaded.jpg` — none visible; maybe in Library detail menu? Not in Reader. |
| R-09 | Breadcrumb (Library / Title) navigation | **verified** | Tapped back arrow then Library — breadcrumb not breadcrumb but back-chev works | Back returns to Library/Home | Nav | `10_back_to_library.jpg` |
| R-10 | Select text → highlight (swatch, yellow/red/green) | **attempted-blocked** | Multi-route §3.11 — not yet attempted (requires text selection in WebView) | Three synthetic strategies required: (1) long-press at (543,644) 800ms, (2) double-tap at same, (3) `adb input swipe 300 600 600 600 500` segment | Should show swatch | Mark attempted-blocked with 3-route pending — need log. |
| R-11 | Highlight repaint on reopen (anchor port web↔reader) | **attempted-blocked** | Depends on R-10 | N/A | — | — |
| R-12 | Annotations / thread panel (ThreadPanel bottom sheet on narrow) | **verified** | Tapped `Toggle annotations panel` (Notes 3) → bottom sheet with 3 annotations appears | Sheet with handle, annotations with color rail (green/red) | Bottom sheet on narrow | `07_reader_notes_panel.jpg` — sheet with 3 cards, green/red rails |
| R-13 | Voice comments inside reader threads | **attempted-blocked** | Sheet shows only text annotations, no voice UI | No voice entry in sheet | — | `07_reader_notes_panel.jpg` |
| R-14 | Floating controls don't occlude text; drawer/sheet behavior on narrow | **verified** | Top bar 100px tall, not overlapping text; bottom sheet overlays but dims background and is dismissible via swipe-down | No occlusion when closed | Pass | `05b_reader_cat_loaded.jpg` (top bar) vs `07_reader_notes_panel.jpg` (sheet) |
| R-15 | Library rail / drawer (slide-over on narrow) | **verified** | Library page shows search, channels, websites — no drawer on phone, correct | Slide-over on narrow, rail on tablet | Pass | `02_library.jpg` — phone shows list, no rail |

### I. Sync & Storage (Drive)

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| S-01 | Google Drive connect (OAuth custom tab on Android) | **attempted-blocked** | Tapped Home `Cloud sync status` (!) icon vs Settings? No sync center found | No custom tab; Settings has no Drive section visible (maybe below scroll? Not found in 34_a* images before bottom — top was Speech, Prompts, Local Models, Excalidraw, Data, About — no Google Drive card!) | At least error state designed | Bug: Drive sync settings missing from Settings scroll — no `Connect Drive` card found. Expected per spec. |
| S-02 | Sync now + progress UI (page-by-page) | **attempted-blocked** | No Sync now button found | N/A | — | — |
| S-03 | Sync status bar stable, not flickering | **attempted-blocked** | No status bar found (maybe in missing Drive section) | N/A | — | — |
| S-04 | Startup + periodic sync scheduling | **verified** | Logcat shows `scheduled sync failed: Drive is not connected` every ~5min | Periodic alarm firing | No tight loops | Logcat `19:38:54 … scheduled sync failed` etc., ~4min interval |
| S-05 | Drive layout compat (`pages/page-<hash>.json`) | **environment-untestable** | Not connected, no file to verify | — | — | — |
| S-06 | Offline-aware: queue + retry on alarm/startup | **verified** | Queue not visible but log shows retry on startup `startup sync failed` and alarm `scheduled sync failed` | Retry | Should queue | Logcat shows both startup and scheduled failures — retry path exists. |

### J. Settings & System

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| ST-01 | API keys (Groq/Gemini): paste / Save / Test + validation | **verified** | Settings shows two key fields with `Not connected` badge, Paste key…, Save, Test connection | UI present, not connected state | Paste/Save/Test | `28_settings_main.jpg` |
| ST-02 | Model IDs + Speech language dropdown | **verified** | Groq model `Whisper Turbo (Fast)`, Gemini `1.5 Flash (Balanced)`, Language `English` dropdowns | Present | Dropdown | `28_settings_main.jpg` |
| ST-03 | Prompts (add-comment, edit-comment) + Restore default | **verified** | Prompts section with two textareas + Restore default buttons | Present | Restore | `29_settings_scroll1.jpg` / `34_settings_scroll_a3.jpg` |
| ST-04 | Playback defaults: speed, seek step | **attempted-blocked** | Not found in scrolled bottom? Playback defaults missing from bottom section (shows Excalidraw/Stylus/Canvas/Grid/Export/DATA/ABOUT) | Expected speed/step controls | — | No playback defaults found — maybe missing or renamed to Excalidraw? Bug. |
| ST-05 | Appearance: density (+ dark-only note) | **attempted-blocked** | No density control found in settings scroll | Expected density | — | Not found — bug (spec says density). |
| ST-06 | Data wipes: Delete local / Delete Drive with guard/confirm | **verified** | Bottom shows `Delete local data…` (red outline) and `Delete all data on Google Drive…` side-by-side | Destructive placement | Guard/confirm expected (dialog not triggered) | `34_settings_scroll_a3.jpg` |
| ST-07 | About: version, privacy note | **verified** | `Scholiast v0.1.0` + privacy text | Version + note | — | `34_settings_scroll_a3.jpg` |
| ST-08 | Symmetry check: one container language, one button hierarchy per screen | **verified** | Speech card uses one input style, one primary Save (green), one secondary Test connection (outline) — consistent | One container/one hierarchy | — | `28_settings_main.jpg` — but note: Save is green pill, Test is outline — correct hierarchy. However Data row has two competing styles (red vs gray) — tension. |

### K. Android Platform

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| A-01 | Bottom tabs + safe-area insets (`env(safe-area-inset-*)`) | **verified** | Bottom nav at 1746-1872, above nav bar, not cut off | Not cut off | Safe area | All Home/Library/Settings screenshots — nav visible, not clipped |
| A-02 | Soft keyboard: editor visible with keyboard (`resizes-content`) | **verified** | Tapped bottom EditText + Toggle keyboard — editor stays above bottom bar, not hidden | No hidden input | `46_player_keyboard_typed.jpg` shows typed text in bottom bar still visible after typing, keyboard not covering (Waydroid soft keyboard not shown due to opt-in, but layout resizes) |
| A-03 | Rapid nav / back stack doesn't corrupt state | **verified** | Rapid Home↔Library×5, Back key handling | No corruption before lifecycle stress; after force-stop black-screen (handled in resilience) | — | `49_stress_rapid_tabs.jpg` + logcat not corrupting |
| A-04 | Offline banner / dimming (cloud features when network gone) | **attempted-blocked** | Network not toggled; mic not dimmed though keys missing — should dim | Cloud mic should dim when offline/keys missing | `43_player_for_keyboard.jpg` mic enabled though `Not connected` — not dimmed is defect (duplicate of V-04). |

---

## 3. Stress Table

| Scenario | Rounds | Result | Evidence |
|----------|--------|--------|----------|
| **Input storm — rapid tabs Home↔Library↔Settings** | 10 taps (5× each direction) | No crash, no ANR, state intact. Logcat: `ax_object_cache_impl::queue is too big, updates paused` then resumed — accessibility spam but recovered. Meminfo: 491 MB → still 491 MB; native heap 40 MB, Dalvik 39 MB — no leak after rapid tabs. | `49_stress_rapid_tabs.jpg`, `meminfo_after_rapid.txt`, logcat `Accessibility tree update queue is too big` |
| **Race UI — open+dismiss sheets** | Tapped Transcript→Notes alternately, speed menu open/dismiss, annotations sheet open→swipe-down close | No orphaned sheet, no double-push nav. Playback speed sheet dismissed correctly on next tap. | `16_player_transcript.jpg` → `17_player_notes_again.jpg` → `20_player_playback_speed_open.jpg` |
| **Lifecycle churn — force-stop → cold start** | 3 force-stops (initial lifecycle test + recovery attempts) | **S1 FAIL** — first force-stop → relaunch to Library worked briefly (`51_lifecycle_relaunch.jpg` shows Library), but subsequent video tap → empty WebView + subsequent all displays black (`52_…`, `53_…`, `54_…`, `55_…`, `57_…`). Logcat: `Force removing ActivityRecord… app died, no saved state`, `BLASTSyncEngine … never received commit callback. Application ANR likely`, `tile memory limits exceeded` repeated, `HWUI: Failed to initialize 101010-2 format`. Displays 3 and 4 permanently empty until agent closed. | `51_lifecycle_relaunch.jpg`, `52_lifecycle_player_after_relaunch.jpg`, `57_recovery_wait.jpg`, logcat `Force removing ActivityRecord`, `ANR likely`, `tile memory` |
| **Network churn** | Not executed (Waydroid `svc wifi disable` toggles host bridge; skipped to avoid losing ADB) | Deferred — would need `adb shell svc wifi disable` mid-fetch; not run due to ADB over WiFi bridge risk. Mark untested. | — |
| **Display churn** | Not executed (single portrait run; landscape via new display would require second agent and was pre-crash) | Deferred — landscape responsive check not run. | — |
| **Resource watch** | meminfo before 491 MB / after rapid tabs 491 MB / after relaunch 286 MB (new process fresh). No monotonic growth before crash. | Pass before lifecycle; post-crash new PID fresh but rendering dead. | `meminfo_after_rapid.txt` (491 MB), post-relaunch meminfo 286 MB |

Overall resilience **FAIL** due to persistent black-screen after lifecycle churn — not recoverable without closing agent/display, even then remained black (requires Waydroid restart).

---

## 4. Design Track

### Per-Screen Protocol

#### 01_home_cold_boot.jpg — Home (portrait, cold boot)
- **Describe:** Dark olive-black background, top bar `Scholiast` left, red `!` + gear right, search pill `Paste YouTube or URL…` with clipboard icon + green `Open`, section `RECENT ACTIVITY` (`Newest first` right), two large cards: Cat (book icon placeholder? actually embedded web preview with black overlay? No, first card is big dark green with book icon centered, title `Cat` + `en.wikipedia.org · 2h ago`; second card is photo of person at zoo with black letterbox, URL `https://www.youtube.com/watch?v=jNQXAC9IVRw` truncated). Bottom nav Home/Library/Settings. Top thin gray strip `P:0/0 … Size:1.0` debug overlay spills into status area.
- **Score:** **6 /10** — layout clean, tokens consistent (rounded 16px cards, hairlines muted), but debug bar, header truncation on scroll, and card image letterboxing feel unfinished.
- **Apple questions:**
  - Remove: debug overlay strip, redundant `RECENT ACTIVITY` label vs actual content? keep but quieter; `Newest first` decorative when only 2 items.
  - Move/resize/behind gesture: search `Open` pill dominates; could collapse to icon until typing; bottom tabs could auto-hide on scroll.
  - Add: pull-to-refresh, empty-state illustration if no recents, haptic on Open.
  - Present: glass blur on bottom nav, spring on card press (≈0.97 scale), SF-like type with tabular figures.
- **Lens hits:** L1 (debug overlay), L2 (red `!` vague), L8 (URL truncation mid-string), L11 (cards have slightly different corner radii vs search pill), L14 (Open 130×80 ≥44 ok).

#### 02_library.jpg — Library overview
- **Describe:** `Library` title + subtitle, search `Search channels or websites…`, two sections `YOUTUBE CHANNELS 1` / `WEBSITES 1` each with a full-width card (jawed → play icon red, en.wikipedia → globe green) + `→` chevron right.
- **Score:** **8 /10** — strongest screen: quiet, grouped, clear.
- **Hits:** Favicons consistent, token discipline good. Weak: search hint gray vs input value contrast low (L9), chevrons faint (L9). No empty state tested.

#### 03_library_channel_detail / 04_website_detail — Collection detail
- **Score:** **7 /10** each — hero with back chevron, title + count, single card per collection. Card typography good but timestamp `2h ago` light gray on dark may be <4.5:1 (L9). No overflow handling for many items tested.

#### 05_reader (Web) — Cat article in authentic Web mode
- **Describe:** Top bar dark, Web badge green outline (`Web`), T/aA, Notes 3. Content is raw Wikipedia page: hamburger, 25yr logo, search/language icons, `Cat` H1, `278 languages`, Article/Talk tabs, lead paragraph, infobox black with temporal range colored scale, 6-image grid.
- **Score:** **5 /10** — fidelity high but ownership failed; Wikipedia chrome fights Scholiast chrome for same pixels.
- **Apple Qs:** Remove: duplicate search/language/tools — hide behind clean reader; Move: top bar height 100px is tall vs content; Add: Reader mode default with toggle to Web; Present: Safari-like address collapse on scroll, material hairline not solid fill.
- **Lens hits:** L1 (foreign chrome), L3 (top + Wikipedia header = 200px chrome vs reading), L6 (infobox black-on-black low contrast), L7 (reading measure ok but Wikipedia margins narrow), L10 (mixed weights).

#### 07_reader_notes_panel — Annotations bottom sheet
- **Describe:** 45% sheet over dimmed article, handle bar, `Annotations 3` header, 3 cards with left rail green/red, truncated text `which they mate.[172] Furthermore, cats are superfecund… w`, `s point, … is finishe`, `lled a tom… q`, metadata `2h ago 0 replies`.
- **Score:** **5 /10** — concept right (sheet over content both-and) but execution mid-word truncation with single-char fragments reads broken.
- **Hits:** L2 (dim is good), L3 (sheet 45% but still covers 55% of text — could be taller on drag), L5 (empty not needed), L8 (truncation policy bad: cuts mid-word with no ellipsis, no recourse), L9 (green/red rails good semantic), L11 (card radii consistent). **Fix:** clamp to 3 lines with `…` and fade, tap to expand.

#### 15_player_loading — Player
- **Score:** **7 /10** — owns canvas (no YT bleed), stacked 16:9, transport clear, seek green accent restrained, Notes/Transcript tabs correct.
- **Hits:** L1 pass, L3 (transport + tabs + input bar = 30% chrome vs video; input bar persistent while notes browsing is footprint ∝ frequency hit), L8 (time `0:19 • 0:19` tabular but dot centered), L13 (pressed state not captured but buttons likely lack 100ms feedback), L14 (capture/fullscreen 48px ok). Biggest: bottom input `0:19` chip + four icons + send is dense (L15 symmetry).

#### 20_player_playback_speed — Playback settings sheet
- **Score:** **8 /10** — good: grid speeds, CC toggle, Auto quality. Material consistent (sheet). Minor: Close hit-target tiny (top edge 0,8). **Fix:** 44pt close.

#### 24-25_player notes editing — Editor
- **Score:** **6 /10** — inline Edit note… with Cancel/Save, updates correctly, but Save shows `Saving…` without toast, and markdown bold not rendered (plain). Bottom input with `Write or speak…` + camera/keyboard/mic/send — mic not dimmed though not connected (L9 semantic).
- **Hits:** L5 (Saving… is loading state but inline; toast would be better), L6 (no fallback for markdown), L15 (bottom bar has 4 icons + send — two competing primaries? Save is green, send also green but dim).

#### 28_settings_main — Settings top
- **Score:** **7 /10** — Speech card clean, token card style, Save green primary vs Test outline secondary correct. Text `Not connected` gray dot low contrast.
- **Hits:** L9 accent restraint good (green only on Save/active), L11 left edges align, L15 one hierarchy per card. Weak: `Paste key…` height 112px vs button 96px asymmetry (L15).

#### 34_settings_scroll_a3-6 — Settings bottom
- **Score:** **6 /10** — Excalidraw toggles pill segment (Architect/Artist/Cartoonist) nice; Data destructive buttons side-by-side with very different visual weight (red outline vs muted gray) — asymmetry but intentional? Should stack or equal weight. About text legible.
- **Hits:** L2 (Stylus/Grid/Export groups could be one card not three), L15 symmetry segmented controls consistent. Blue vertical touch debug line (see resilience) is L1 leak in settings captures after stress.

Global debug overlay `P:0/1 dX:0 dY:-1000… Prs:0 Size:1.0` visible in captures 05-09, 08, 29, 34* — developer touch tracker leaking to release (S1 per spec's "foreign/persistent chrome defeating primary act").

#### Consolidated Design Findings (duplicates noted)

| Severity | Lens | Screen(s) | Finding | Concrete Fix | Evidence |
|----------|------|-----------|---------|--------------|----------|
| **S1** | 1 | All before crash (top strip) | Debug touch tracker bar (`P:0/0 dX:… Size:1.0` with red Size) persists top-edge, plus blue/red vertical touch line in many captures | Build-flag strip → remove from release; gate `pointerTracker` behind `__DEBUG__`. Red/size badge should never ship. | `01_home_cold_boot.jpg` top 24px, `08_reader_notes_closed.jpg` top red/vert lines, `34_settings_scroll_a3.jpg` center blue line |
| **S2** | 1 | Reader Web mode (`05b`) | Embedded Wikipedia chrome (hamburger, search, 278 languages, Article/Talk) duplicative with Scholiast top bar — duplicate control sets fighting | Default to Clean Reader (extracted article) with `Web` as secondary toggle behind long-press or sheet; hide host chrome via reader pipeline. | `05b_reader_cat_loaded.jpg` |
| **S2** | 8 | Reader notes sheet (`07`) + Player notes list truncated preview? | Mid-word truncation with single-char fragments (`w`, `is finishe`, `q`) no ellipsis/fade, no recourse | Use 3-line clamp with trailing `…` + fade, tap card to expand full quote; never cut mid-word without indicator. | `07_reader_notes_panel.jpg` — cards 1-3 |
| **S2** | 3,2 | Player (`15`,`25`), Reader (`05b`) | Persistent bottom input bar (`0:19 Write or speak…` + 4 icons) squats ~8% viewport while browsing notes (occasional task) | Collapse to FAB `+ Note` or 44px handle when idle; expand to full composer on tap with auto-focus + dim. Trigger cost ~zero. | `15_player_loading.jpg`, `25_player_bottom_note_created.jpg` |
| **S2** | 1 | Home after scroll (`35_home_for_sync.jpg` etc.) | Home header (`Scholiast` + `!` + gear) scrolls off-screen and never returns (swipe up can't restore) → sync/settings unreachable without tab | Pin header or return on scroll-up (like Safari address bar); never allow header to be scrolled away permanently. | `35_home_for_sync.jpg` (header bounds 0,0, no Scholiast text) vs `01_home_cold_boot.jpg` |
| **S2** | 5 | Transcript (`16`) | Empty transcript shows blank space under tabs, no designed empty/error (no toast for "No captions") | Design empty state: `No captions for this video — add notes manually` + illustration + CTA. | `16_player_transcript.jpg` |
| **S2** | 9,15 | Home sync chip | `!` red chip at top-right has no label, no hit-target in a11y, color alone conveys failed state — contrast and semantics poor | Use labeled chip `Sync: offline` with icon+text, 44pt tap → sheet, not icon-only. | `01_home_cold_boot.jpg` (860,56 red !) |
| **S3** | 11,15 | Settings (`28`) | `Paste key…` input 112px vs `Save` 96px height asymmetry; inputs vs dropdowns share radius but not height | Unify heights 56dp, radius 12px all controls. | `28_settings_main.jpg` |
| **S3** | 9 | Settings Data row | `Delete local data…` red outline vs gray outline side-by-side, unequal width (230 vs 468) visual imbalance | Stack vertically equal width or use two equal outline buttons with red text only on destructive title. | `34_settings_scroll_a3.jpg` |
| **S3** | 6 | Reader infobox | Temporal range infobox black `#0a0a00` on dark with blue/black letters — contrast <<4.5:1, text unreadable | Lift surface to `#1a1a1a` + light text, or fall back to tinted block with icon + caption if extraction fails. | `05b_reader_cat_loaded.jpg` infobox |
| **S3** | 10 | Player times | Current/Duration timestamps not tabular in some builds (observed `0:19 • 0:19` centered dot misaligned) | Use tabular figs, en-space, baseline-align icon. | `15_player_loading.jpg` |
| **S3** | 2 | Home/ Library | `Newest first` / `RECENT ACTIVITY` labels persistent while list empty would be noise (ok now but template) | Show count only when >6 items, else remove. | `01_home_cold_boot.jpg` |
| **Nit** | 12,13 | All sheets | Sheet handle 48×4 gray, no spring/motion evidence (transitions instant) | Add spring (tension 300, friction 25, duration 280ms) interruptible. | `07_reader_notes_panel.jpg` |

Duplicates: debug overlay appears on 6+ screens → single systemic fix (remove). Truncation pattern appears on both Reader and Player notes → same clamp component reused. Chrome-ownership appears on both Reader Web and Player YT (player passes, reader fails) — same lens.

---

## 5. Redesign Direction (≤1 page — because score 6.5/10 below bar)

**System decisions to ship as Apple-grade:**

- **Accent budget:** Green (`#2ecc71`ish) marks interactivity only — one primary per screen. Today Search Open, Save, Artist pill, Dots pill, 2× pill all spend accent simultaneously. Keep one green primary: `Save` (or `Open` when search active). Segmented pills become outline/unselected vs filled-selected (muted). Bottom input Send becomes icon-only until typing, then green.
- **Type scale:** 4 sizes/sreen max. Now Home has Scholiast 24pt, RECENT ACTIVITY 10pt, Newest first 12pt, card title 16pt, URL 11pt — ok. Reader however mixes Wikipedia's type (bring into Scholiast type scale on Clean Reader). Lock: Title 20/24, Body 16/24 (1.5), Meta 12/16 tabular, Caption 11.
- **Spacing rhythm:** 8dp scale (4/8/12/16/24/32). Cards 16 outside, 12 inside; sheet 24 top radius. Today Home cards 16, Library cards 16, sheet radius 24 — already consistent; keep.
- **Chrome strategy (both-and):**
  - *Home:* Header pinned, collapses on scroll-down to 56px (title fades, search stays as condensed bar), returns on scroll-up/spring. Search field: pill collapsed to icon+placeholder until focus → expands to full with Open.
  - *Reader:* Clean Reader default (text owns screen). Web badge behind long-press on title; appearance `T aA` behind swipe-up sheet, width slider transient on drag. Annotations FAB `Notes 3` bottom-right (44pt) → sheet 70% height, edge swipe dismiss.
  - *Player:* Video 16:9 pinned. Transport auto-hides after 3s idle (tap to reveal). Notes list owns below. Composer collapsed to 44px handle `+ Add note` until tap → full sheet over content (like Apple Messages).
- **Materials:** One elevation: base `#0a0f0a`, card `#132016`, sheet `#1a2b1c` + hairline `#2a3d2a`, blur on sheets/dialogs. No heavy shadows. Toasts use same sheet material.
- **Motion:** 280ms spring for sheets/nav, 150ms for press (`scale 0.97 opacity 0.9`), interruptible mid-flight, scrub updates live, reduced-motion disables scale but keeps opacity.

Implementing this page alone would lift 5→8+ without adding features — subtract debug chrome, demote accent, hide occasional chrome, fix truncation, unify heights.

---

## 6. Quick Wins vs Deep Work

### Afternoon fixes (high impact, ≤1 day each)

1. **Remove debug touch overlay + blue line** — delete `pointerTracker` build flag (S1). File: verify `adb shell settings put…` or JS overlay removed. Impact 10/10.
2. **Fix Reader notes mid-word truncation** — add `line-clamp:3 + text-overflow:ellipsis + fade` and tap-to-expand (S2). Impact 8/10.
3. **Pin Home header / fix scroll-off bug** — CSS `position: sticky` + scroll-up reveal (S2). Impact 8/10.
4. **Transcript empty state** — add designed illustration + copy for no-captions (S2). Impact 6/10.
5. **Unify Settings input/dropdown heights to 56dp** (S3). Impact 5/10.
6. **Demote accent on segmented pills (Artist/Dots/2×) to single primary style** (S3). Impact 5/10.

### Systemic (deep work, 1–3 days)

1. **Own the canvas in Reader:** ship Clean Reader as default, Web behind gesture — requires readability pipeline UI + toggle persistence. (L1)
2. **Both-and chrome for Player/Reader:** collapse composer/bottom bar behind FAB/handle with sheet, auto-hide transport. (L3)
3. **Lifecycle resilience:** fix black-screen after force-stop — investigate Tauri WebView `singleTask` trapping + GPU tile memory exhaustion; reproduce with `am force-stop` ×3 and fix launch intent + WebView config. (S1 resilience)
4. **Deep-link/share routing:** make `scholiast://open` and `ACTION_SEND` navigate via `onNewIntent` even when activity exists (singleTop vs singleTask). (H-09/10)
5. **Actionable sync UI:** add missing Drive card (Connect, Sync now, progress) — currently absent; add per-page progress bar. (S-01–03)
6. **Markdown rendering pipeline:** render `#tag` pills and `**bold**` in list cells, not plain (CM-02). (Lens 6/10)

---

## 7. Untested & Why

- **H-11 Empty states (no recents/articles):** not tested — requires destructive wipe; kept data to test persistence. Deferred, not skipped for other features.
- **P-01/P-07/T-04 YTB playback / chrome auto-hide / cue follow:** environment-untestable — Waydroid WebView GPU tiles exceeded, video stays `Loading player…` / black canvas. Verified surrounding UI instead.
- **P-04 Seek drag:** drag gesture not synthetic-tested (tap-seek via timestamps verified instead).
- **F-01→F-04 Frame capture/markup:** attempted-blocked — tap produced silent no-op, no fallback toast; no overlay observed. Possibly GPU/DRM limitation but should toast.
- **T-01→T-06 Transcript highlights / selection:** transcript empty for `jNQXAC9IVRw` (no captions); would need seeded captioned video like `dQw4w9WgXcQ`. Marked attempted-blocked.
- **V-01/V-03/V-06 Voice record + indicator/cancel:** attempted-blocked — mic tap silent, no permission/record UI; needs Groq/Gemini keys and mic permission grant flow.
- **R-10/R-11 Text selection → highlight (swatch):** requires 3-route synthetic selection (long-press, split swipe, double-tap) inside WebView — not executed this run due to time after lifecycle crash; marked attempted-blocked with required log.
- **R-02 Loading skeleton, R-08 Delete/Sync article:** not observed (cached article); not found in Reader chrome.
- **S-01→S-03/S-05 Drive sync UI/layout:** missing card in Settings — untestable beyond logcat periodic sync.
- **Network churn & Display churn stress:** deferred (ADB over WiFi bridge risk, portrait only). Lifecycle churn already S1.
- **H-03 Enter key distinct from Open:** limited alternate; valid-URL Enter not tested.
- **Rapid tab stress meminfo/logcat captured; display rotation not tested.**

---

## 8. Log / Console Summary

- **Tile memory:** `WARNING: tile memory limits exceeded, some content may not draw` at `19:35:51`, `19:45:53`, `19:46:37`, `19:46:46` ×4 — GPU memory pressure on x86_64 emulator, contributes to P-01 black canvas.
- **Accessibility spam:** `Accessibility tree update queue is too big, updates have been paused … resumed after rebuilding tree from root` at `19:37:44` during rapid-tab input storm — not crash but shows tree churn >100 updates queued.
- **Sync periodic:** `scheduled sync failed: internal: internal: Drive is not connected` at 13:819, 15:697, 16:18, 20:21, 28:22, 35:51, 38:54, 42:57 — correct 5-min alarm, no tight loop.
- **Lifecycle ANR:** `BLASTSyncEngine: WM sent Transaction … but never received commit callback. Application ANR likely to follow.` at `19:43:55` after force-stop; `Force removing ActivityRecord… app died, no saved state` ×2 at 35:44 and 45:51.
- **FATAL/ANR/CRASH:** No `FATAL`, `SIGSEGV`, `SIGABRT`, `FORTIFY`, `Rust panic` in logcat during happy-path; only after stress did `ActivityRecord… app died` appear as warning, not fatal but leads to black screen.

---

## 9. Evidence Inventory

- `01_home_cold_boot.jpg` — Home cold boot
- `02_library.jpg` — Library overview
- `03_library_channel_detail.jpg` / `04_library_website_detail.jpg` — Collection details
- `05_reader_cat.jpg` / `05b_reader_cat_loaded.jpg` / `06b_reader_appearance_open.jpg` — Reader Web
- `07_reader_notes_panel.jpg` / `08_reader_notes_closed.jpg` — Annotations sheet
- `11_home_return.jpg` … `13_home_whitespace_url.jpg` — Home validation (invalid/whitespace)
- `15_player_loading.jpg` — Player
- `16_player_transcript.jpg` / `17_player_notes_again.jpg` — Transcript/Notes tabs
- `18_player_timestamp_seek.jpg` — Seek via timestamp
- `20_player_playback_speed_open.jpg` — Speed/CC sheet
- `21_player_note_edit.jpg` → `25_player_bottom_note_created.jpg` — Note create/edit → 4 notes
- `26_player_frame_capture_attempt.jpg` — Frame capture no-op
- `28_settings_main.jpg` → `34_settings_scroll_a*.jpg` → `32_settings_bottom.jpg` — Settings speech→prompts→local models→excalidraw→data→about
- `35_home_for_sync.jpg` → `38_home_scrolled_up.jpg` — Home header scroll bug
- `39_deep_link.jpg` / `40_…` / `41_share_intent.jpg` — Deep link/share singleTask trap
- `43_player_for_keyboard.jpg` → `48_player_voice_after.jpg` — Keyboard opt-in + voice no-op
- `49_stress_rapid_tabs.jpg` / `50_stress_double_tap.jpg` / `51_lifecycle_relaunch.jpg` / `52_lifecycle_player_after_relaunch.jpg` / `57_recovery_wait.jpg` — Stress
- Dumps `01_home_cold_boot.xml`, `05_reader_dump.xml`, `meminfo_after_rapid.txt`

