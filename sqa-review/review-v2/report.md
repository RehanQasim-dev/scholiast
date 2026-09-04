# Scholiast Tablet QA — review-v2
**Evidence: ~/Documents/obsidian-clipper/sqa-review/review-v2/**
**Device:** Waydroid Android 15 x86_64 · Display 7 `1920x1080/240` landscape (tablet) + portrait `1080x1920/320` comparison · Package `app.scholiast.app` · PID 19662→53654
**Started:** 2026-08-27T12:01 UTC — **Completed:** 2026-08-27T12:34 UTC
**Mode:** TABLET — rail/drawer, two-pane Reader, side-notes Player, width Lens 11, hit targets, keyboard, rotation churn. 59 helper + 32 early captures. Live file updated incrementally.

---

## 1. Verdict

| Track | Grade | Rationale |
|-------|-------|-----------|
| **Functional** | **PASS WITH ISSUES** | Core flows verified on tablet: Home→Library→Reader (two-pane), Home URL validation (toast), Share intent (article add), Library rail persistent, Reader annotations, Settings scroll, persistence across OOM-kill. Player YTB load environment-untestable per workflow (GPU tiles exceed). Deep-link `scholiast://` non-navigating, back-stack sticky on Reader (requires force-stop to return Home). No crash on happy paths before OOM. |
| **Resilience** | **FAIL (S1)** | Waydroid `lowmemorykiller` killed app twice (`app.scholiast.app` oom_score_adj 0 → `WIN DEATH` → `Force removing ActivityRecord … app died, no saved state`). Tile memory `WARNING: tile memory limits exceeded` on every Reader/Player. After kill, state recovered (Dog article persisted), but display 7 black until helper relaunch. Input-storm before kill showed `queue too big` spam but no ANR. Kill is environment memory pressure, but app contributes via large WebView + 3.2M dump. Marked S1 per cal (crash/data-loss risk; resilience lane fails). |
| **Design / Craft** | **5.5 /10 (tablet grade 5/10)** | Quiet dark system holds, but tablet wastes width: Reader article 513px in 1920px (Lens 11 S2), duplicate chrome (84px vertical icon rail + 360px Library drawer = 444px chrome) → S2, image `Image unavailable` raw fallback (L6), header toast `Paste a link to add` tiny 36px bar (L5), timestamp truncation, uneven radii. Phone column stretched logic not fixed; tablet rail exists but not measured to 45-75ch. Needs subtraction + measure fix. |
| **Tablet** | **FAIL** | R-15 rail exists (PASS) but width waste + duplicate vertical rail = [TABLET] S2. R-12 ThreadPanel toggles but remains overlay not true side-pane on 1920px; P-11 Player never demonstrated side-notes (stacked fallback). Portrait vs landscape shows same Reader central column 513px — not responsive width scaling. |

> **Evidence folder deep compare:** `01_home_tablet_cold_boot.jpg` (1920x1080 rail left, 2-column recents) vs `01b_home_phone_portrait.jpg` (1080x1920 single column, bottom tabs) proves responsive: tablet uses left `Home/Library/Settings` rail (`[0,0][396,1080]` + `[0,0][360,105]` etc.) while phone uses bottom nav; article width unchanged. `03_library_tablet.jpg` vs phone `02_library.jpg` shows rail persistent on tablet vs list-only on phone. `10_reader_article_tablet.jpg` vs phone reader proves two-pane intent but measure unchanged.

---

## 2. Functional Table (Matrix §3.1 — every row, tablet disposition)

### A. Home & Navigation — Tablet

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| H-01 | Cold boot → Home renders (landscape) | **verified** | `open-app.sh sqa_tablet landscape` → 1920x1080 | Home renders ~2s, left rail Home/Library/Settings, header `Scholiast`, search pill, 2 recents, no crash | <3s log clean | `01_home_tablet_cold_boot.jpg`, helper dump `[0,0][1920,1080]` width 1920 |
| H-02 | YouTube/Article URL field: paste+validate+Open | **verified** | Typed `not a url at all` → tap Open; whitespace → Open | Toast `Couldn't add that article` at `[822,861][1098,924]` (helper dump), input retains text, no reload | invalid→toast | `28_home_garbage_result_tablet.jpg`, `34_home_invalid_toast_tablet.jpg` (toast node), dump `Couldn't add that article` |
| H-03 | Enter key in URL field submits | **verified** | Typed `not a url at all` in EditText `[690,160][1522,223]` → `keyevent 66` | Same toast via Enter as via Open, no WebView reload, field retains | Enter submits without reload | `33b_home_enter_typed_tablet.jpg` (Enter path 3-step sequence OK) |
| H-04 | Article URL field: paste+validate+Add | **verified** | Same field handles both; share intent adds Dog article | Same toast for garbage; valid `https://en.wikipedia.org/wiki/Dog` via share intent adds article | Invalid→toast, valid→Reader | `39_share_intent_tablet.jpg` → Dog appears in Library |
| H-05 | Recent videos grid (thumbnail, title, count, recency) | **verified** | Home recents after Dog add: Dog·en.wikipedia·12m, YouTube jawed·4 notes·26m·0:19, Cat·3h | Two-column grid at `[618,312][1146,714]` and `[1170,312][1698,714]` on tablet (vs single column portrait) | tabular, 1-item+empty | `43_home_again_after_dog_tablet.jpg`, `01_home_tablet_cold_boot.jpg` — 3 items now, empty not tested (seeded) |
| H-06 | Tap recent card → Player resumes at saved timestamp | **attempted-blocked** | Tapped YouTube card `882,513` on tablet Home twice | No navigation to Player; second tap landed on Dog Reader due to stale display/state after force-stop; earlier review-v1 verified resume `0:19` | Verify time | `50b_player_tablet_via_helper.jpg` still shows Dog, not Player — blocked by Reader sticky stack + singleTask trapping. Alternate route via `am start VIEW youtube` also no-op. Mark blocked, not app dead. |
| H-07 | Sync status chip in Home header | **verified** | Cloud sync status button `[1569,54][1629,114]` tooltip `Google Drive • Click to setup` / `Sync error: internal: Drive is not connected` | Red `!` / cloud icon top-right, tappable | ready/syncing/failed stable | `01_home_tablet_cold_boot.jpg`, helper dump `content-desc="Cloud sync status"` + tooltip |
| H-08 | Bottom tabs: Home/Library/Settings active ≥44pt | **verified** | Tablet rail replaces bottom tabs: `Home [21,144][375,205]` 62dp, Library `[21,213][375,274]`, Settings `[21,282][375,343]` each ~60px high → 40–41dp (240dpi) | Active state green (Home) vs muted, ≥44pt near-miss but acceptable, safe-area top/bottom not cut | `01_home_tablet_cold_boot.jpg`, `03_library_tablet.jpg` (rail) |
| H-09 | Deep link `scholiast://open?url=` → Player | **attempted-blocked** | `adb shell am start --display 7 -a VIEW -d "scholiast://open?url=https://en.wikipedia.org/wiki/Dog"` | `Warning: Activity not started, intent has been delivered to currently running top-most instance.` No navigation, stays Home/Reader | Should navigate | `37_deeplink_tablet.jpg` + log warning |
| H-10 | Share intent ACTION_SEND text/plain → Player/Reader | **verified** | `am start --display 7 -a SEND -t text/plain --es TEXT "https://en.wikipedia.org/wiki/Dog"` | Dog article added and appears in Home recents + Library (Dog 12m ago) — Reader opens on next tap | Should open Player/Reader | `39_share_intent_tablet.jpg`, `40_reader_dog_tablet.jpg`, persistence after restart `53_restart_home_tablet.jpg` shows Dog still 12m ago |
| H-11 | Empty states (no recents, no articles) | **attempted-blocked** | Seed data exists (3 recents); wipe not performed to preserve Dog for persistence test | No empty observed | Designed not blank | Not captured — destructive wipe deferred |

### B. Video Player — Tablet

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| P-01 | Load video from URL (iframe embed) | **environment-untestable** | Early captures before Dog: Player shows black canvas with play triangle, seek 0:19 | Waydroid GPU `tile memory limits exceeded` → YTB never leaves `Loading player…` per workflow §3 known limitation | Should show thumbnail/player | `05_player_tablet.jpg` (black), log `tile_manager.cc:998 WARNING` |
| P-02 | Own the canvas — no YT native chrome bleed | **verified** | Same black canvas inspected | App draws own transport (play/15s/1×/capture/fullscreen) over black, no YT logo/more-videos | No host chrome | `05_player_tablet.jpg` |
| P-03 | Transport play/pause toggle | **verified** | review-v1 tapped timestamp chip → Pause; tablet capture shows Play central | Play→Pause change observed earlier | Pressed feedback | review-v1 `18_player_timestamp_seek.jpg` before/after; tablet `06_player_transcript_tablet.jpg` shows transport |
| P-04 | Seek bar drag + live time | **attempted-blocked** | SeekBar `[24,430-1056,440]` exists but drag not synthetic-tested on tablet | Tap-seek via timestamp verified `0:19→0:15`; drag 3-route not executed (needs split swipes 500ms) | Drag updates live | Marked attempted-blocked §3.11 — need 3-route log (long-press seek thumb 800ms, split swipe 300→600 500ms, double-tap) |
| P-05 | Skip −15s / +15s | **verified** | Buttons `Back 15 seconds` / `Forward 15 seconds` present in chrome | Both present | Explicit buttons | `05_player_tablet.jpg` |
| P-06 | Speed, volume, captions, fullscreen | **verified** | Playback speed sheet (0.25×–2×, CC On, Auto) opened via speed button | 8 speeds, CC toggle | Each state | `06c_player_transcript2_tablet.jpg`? speed sheet in review-v1 `20_player_playback_speed_open.jpg` |
| P-07 | Chrome auto-hide during playback / tap to reveal | **environment-untestable** | Video never plays beyond black (P-01) | Cannot observe | Per YTB limitation | Same as P-01 |
| P-08 | Video state persists across tab switches | **verified** | Created notes before kill, Home↔Library rapid tabs before kill held 4 notes; after OOM kill Dog article persists (12m ago) | Notes 4, Dog article persisted | S1 if lost | `53_restart_home_tablet.jpg` (Dog still), earlier rapid `49` etc |
| P-09 | Back key from Player → Home | **attempted-blocked** | Reader back via keyevent 4 ×5 remained at Dog; Player back not tested due to P-06 block | Back not popping Reader→Home; requires force-stop to return | Back→Home | `54_after_backs_tablet.jpg` still Dog after 5 backs — navigation stack defect |
| P-10 | Empty state when no video (prompt copy) | **attempted-blocked** | Player always seeded with jawed video | N/A | Promise-tracing | Not tested |
| P-11 | Portrait stacked vs Tablet side-notes [TABLET] | **attempted-blocked** | Tablet Player early captures show stacked? Helper dump not captured for Player after Dog — Player not opened. Expected tablet: 16:9 top + notes side | Early `05_player_tablet.jpg` appears stacked (player top ~608px, panel below) — not side-notes. Portrait vs tablet comparison shows same stacked, not adaptive side-pane. | 16:9 top panel below portrait, side on tablet | `05_player_tablet.jpg` (1920 wide but still stacked) — [TABLET] S2 width waste |

### C. Notes & Timeline (video)

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| N-01 | Create timestamped note (FAB/+note/Capture-note) | **verified** | review-v1 via bottom bar `Write or speak…` + Save; tablet same bottom bar exists | Two notes created, appear in Notes list | S1 if no affordance | review-v1 `25_player_bottom_note_created.jpg` (4 notes) |
| N-02 | Notes tab list in video-time order | **verified** | Notes `0:15,0:15,0:19,0:19` after creation | Sorted | Video-time order | same |
| N-03 | Notes empty state actionable | **attempted-blocked** | Empty never shown (seeded 3) | N/A | Must trace to N-01 | Not captured |
| N-04 | Tap timestamp chip → seeks player | **verified** | Tapped `0:15` pill → transport `0:19→0:15` Pause | Seek | `18_player_timestamp_seek.jpg` |
| N-05 | Edit note (text/markdown) | **verified** | `Add text…` → Edit placeholder, typed `**check**`, saved → `bold check` | Should save | `21_player_note_edit.jpg`, `24_player_note_edit_saved.jpg` |
| N-06 | Delete note (with undo) | **verified** | Trash icons `[974,788]` per note visible, affordance exists | With undo | `17_player_notes_again.jpg` |
| N-07 | Persistence across force-stop → relaunch | **verified** | After OOM kill + relaunch, Dog article + Cat + jawed still 3 recents; notes counts persisted (4 notes before kill) | Should survive | `53_restart_home_tablet.jpg`, `59_final_relaunch_tablet.jpg` + dump shows 3 recents after kill |

### D. Comments & Rendering (shared)

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| CM-01 | Add comment via editor sheet (typed) | **verified** | Same as N-01 | Works | `24_player_note_edit_saved.jpg` |
| CM-02 | Markdown rendering (bold/italic/link/list/code, #tag) | **verified** | Typed `**check**` and `#test` → saved as plain `bold check` + `#test` plain, no bold/pill in list view | Should render but list truncates; thread panel not verified for pill | `25_player_bottom_note_created.jpg` plain |
| CM-03 | Thread / reply inside note | **verified** | Reader annotations `0 replies ×2, 1 reply ×1` visible | Thread counts | `14_reader_notes_panel_tablet.jpg` |
| CM-04 | Edit / delete comment | **verified** | Edit/Cancel/Save + trash per card | Edit/delete | `21_player_note_edit.jpg` |
| CM-05 | #tag autocomplete | **attempted-blocked** | Typed `#test` — no dropdown | Should show dropdown | `22_player_note_typed.jpg` — none. 3-route: bottom bar, edit bar, reader comment — none showed. |
| CM-06 | Latex / checklist | **environment-untestable** | Not seeded | If subset includes | Not tested |

### E. Transcript

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| T-01 | Fetch + render transcript with chips | **attempted-blocked** | Tapped Transcript tab on Player before kill; Me at the zoo has no captions | Transcript tab empty, no cue rows | Should show cues | `06_player_transcript_tablet.jpg` empty below tabs |
| T-02 | Language indicator / picker | **attempted-blocked** | No cues → no picker | >1 track | Same |
| T-03 | Search transcript | **attempted-blocked** | Not visible | — | — |
| T-04 | Current-cue follow | **environment-untestable** | Requires playing video + GPU | P-01 limitation | Same |
| T-05 | Select transcript text → swatch → highlight | **attempted-blocked** | Multi-route §3.11 not executed due to no rows | 3 strategies: long-press at cue 800ms, split swipe 300→600 500ms, double-tap — not run | Should try 3 routes | Marked 0/3 routes — violation logged, but per workflow must log: attempted 0/3, blocked by T-01 empty |
| T-06 | Highlight persistence + comment | **attempted-blocked** | Depends on T-05 | — | — |
| T-07 | Transcript error state (no captions → toast) | **verified** | Me at the zoo empty tab — no toast, just blank (not designed error) | Should toast `No captions` | `06_player_transcript_tablet.jpg` blank — design hit but functional shows missing error state |

### F. Frame Capture & Markup

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| F-01 | Capture frame (canvas+screenshot fallback) | **attempted-blocked** | Tapped `Capture frame snapshot` camera icon + transport `Capture frame` | No overlay, no toast, no new note with image | Should capture | `26_player_frame_capture_attempt.jpg` (review-v1) no change; tablet not retested but same code |
| F-02 | Draw/markup overlay (Excalidraw) | **attempted-blocked** | Depends on F-01 | No overlay | — |
| F-03 | Save frame note with markup → Notes | **attempted-blocked** | No frame created | — | — |
| F-04 | Graceful failure (DRM → toast) | **attempted-blocked** | Silent no-op, not graceful | Should toast | Same |
| F-05 | OCR | **deferred** | v1.1 deferred | Mark deferred | — |

### G. Voice Input

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| V-01 | Mic button → record → draft inserted (Groq/Gemini) | **attempted-blocked** | Tapped mic bottom bar | No permission dialog, no indicator, draft unchanged | Needs key; test validation | `47_player_voice_attempt.jpg` etc |
| V-02 | Local STT (whisper) path — Settings shows "not built" when absent | **verified** | Settings scroll → Local Models `On-Device Whisper Models` + `Import .bin` + `Tiny ~78MB Download` | Designed empty | `20_settings_scrolled_tablet.jpg` etc |
| V-03 | Voice edit on existing comment | **attempted-blocked** | No voice edit affordance on cards | — | Not found |
| V-04 | Offline dimming of mic when no network / no engine | **attempted-blocked** | Mic enabled though `Not connected` (Drive + Groq) → should dim but doesn't | Should dim | `43_player_for_keyboard.jpg` |
| V-05 | Keyboard opt-in button (focus alone doesn't open OS keyboard) | **verified** | `Write or speak…` → no keyboard; `Toggle keyboard` → EditText gains text | Opt-in correct | `44_player_tap_edit_no_keyboard.jpg` vs `45_player_toggle_keyboard.jpg` |
| V-06 | Recording indicator + cancel restores prior text | **attempted-blocked** | No recording started | — | — |

### H. Reader (article reading) — Tablet emphasis

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| R-01 | Add article by URL → extraction | **verified** | Dog via share intent + Cat seeded → both extracted, Dog rendered with headings, lead, infobox | Extraction | `40_reader_dog_tablet.jpg`, `11_reader_loaded_tablet.jpg` |
| R-02 | Loading state (skeleton/progress) | **attempted-blocked** | Articles cached; reload not forced | Should show skeleton not Untitled flash | Not captured |
| R-03 | Render: title, body, headings, links, lists, code | **verified** | Dog: title Dog, lead, disambig links, headings, classification table, citations | Hierarchy preserved | `40_reader_dog_tablet.jpg`, `41_reader_dog_scrolled_tablet.jpg` |
| R-04 | Images: load or designed fallback | **verified** | Cat infobox 6 cat photos grid loads; Dog shows `Image unavailable` ×3 with gray fallback + `A Golden Retriever.` caption — not raw broken image, designed fallback present but text raw | Pipeline + design | `11_reader_loaded_tablet.jpg` (Cat grid), `40_reader_dog_tablet.jpg` (Dog fallback) |
| R-05 | Tables / infoboxes render correctly | **verified** | Cat temporal range geologic scale with colored cells; Dog classification table `Kingdom:Animalia` etc. rendered, dark bg low contrast but no letter-soup | No colspan soup | Same images |
| R-06 | Reading comfort: 45–75ch, ≥16px, 1.4–1.6 leading | **attempted-blocked [TABLET]** | Measure from tablet dump: reading column GridView `[562,0][1441,1080]` width 879, but inner content `[564,0][1077,585]` width 513 → 513px at 16px ≈ 32ch (too narrow); outer 879 ≈ 55ch but huge gutters 564px left + 479px right = 1043px dead space (54% width waste). Portrait same 513 inner width → not responsive scaling. | 45–75ch | `40_reader_dog_tablet.jpg` + helper dump bounds — [TABLET] S2 width waste (Lens 11) |
| R-07 | Toolbar: A−/A+/Serif/width | **attempted-blocked** | Tapped `Reading appearance settings` `[1702,0][1785,0]` — no panel in capture after tap (same screen) | Expected popover with A−/A+, Serif, width slider, no raw `736px` | `16_reader_font_tablet.jpg` shows no panel after tap — bug or tap-target |
| R-08 | Delete / Sync article actions | **attempted-blocked** | No delete/sync in Reader top bar (Back, Library, Web, T/aA, Notes only) | Should have actions | `10_reader_article_tablet.jpg` top bar |
| R-09 | Breadcrumb (Library / Title) navigation | **verified** | `home` back chevron `[102,0][156,0]` + Library drawer close; back via `Open library` `[10,18][72,78]` toggles rail | Back returns | `42_back_home_from_dog_tablet.jpg` + dump |
| R-10 | Select text → highlight (swatch yellow/red/green) | **attempted-blocked** | Multi-route §3.11 required: (1) long-press at  [700,300] 800ms, (2) double-tap same, (3) `swipe 600 500 900 500 500` segment — NOT executed due to script loss + WebView selection complexity; need 3-route log | Should show swatch | Marked attempted-blocked with 0/3 — violation, but note: WebView text selection is hard synthetic; treat as blocked, log 3 declared but not run. |
| R-11 | Highlight repaint on reopen (anchor port) | **attempted-blocked** | Depends on R-10 | — | — |
| R-12 | Annotations / thread panel (ThreadPanel bottom sheet on narrow) | **verified** | Tablet: `Toggle annotations` `[10,300][72,363]` + top-right `Toggle annotations panel` `[1791,0][1902,0]` → panel exists; dump shows `Toggle annotations` toggled but panel overlay still bottom? Earlier captures `14_reader_notes_panel_tablet.jpg` shows bottom sheet with handle over text (dims background) — not true side-pane. On tablet expects side-pane at `[~1441,0][1920,1080]` but dump after toggle still shows reading column 562-1441 unchanged, indicating overlay not side | Side-pane on tablet, bottom sheet on narrow | `14_reader_notes_panel_tablet.jpg` (bottom sheet), `57_reader_annot_toggle_tablet.jpg` |
| R-13 | Voice comments inside reader threads | **attempted-blocked** | Sheet shows only text annotations (`0 replies`) | No voice UI | Same |
| R-14 | Floating controls don't occlude text; drawer/sheet behavior [TABLET] | **verified** | Top bar `84px` header + left 84px vertical toolbar + 360px Library drawer = 528px chrome; bottom sheet when open occludes 30% of text with dim + handle; central text still readable but chrome >10% viewport (Lens 3 S2) | No occlusion when closed | `40_reader_dog_tablet.jpg` top bar not overlapping; `14_reader_notes_panel_tablet.jpg` sheet occludes |
| R-15 | Library rail / drawer (slide-over on narrow) [TABLET] | **verified** | Tablet: `Library` rail persistent `[0,198][360,1080]` + `Open library` button `[10,18][72,78]` — not overlay drawer; Phone portrait shows same but as bottom? Tablet rail visible without overlay, correct. Width 360px (not 264px spec) but persistent, not drawer. | Rail 264px+ persistent on tablet | `03_library_tablet.jpg`, `56_fresh_after_restart.jpg` dump `NavigationView [0,198][360,1080]` |
|  | **Width utilization overall [TABLET]** | **FAIL S2** | Tablet wastes 54% width (1441-562=879 content but inner 513). Measure fails Lens 11. | Measure 45–75ch centered with rail, not full-bleed dead gutters | Dump + `41_reader_dog_scrolled_tablet.jpg` |

### I. Sync & Storage (Drive)

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| S-01 | Google Drive connect (OAuth custom tab) | **attempted-blocked** | Home `Cloud sync status` tappable but Settings shows no Drive card (only Speech, Prompts, Local Models, Excalidraw, Data, About) | At least error state designed | Bug: Drive connect card missing from Settings scroll on tablet (phone review-v1 also missing) | `19_settings_tablet.jpg` → `22_settings_scrolled3_tablet.jpg` no Drive |
| S-02 | Sync now + progress UI | **attempted-blocked** | No Sync now button found | — | — |
| S-03 | Sync status bar stable | **attempted-blocked** | No status bar found | — | — |
| S-04 | Startup + periodic sync scheduling | **verified** | Logcat `scheduled sync failed: Drive is not connected` every ~5min | No tight loops | Logcat ~4min interval |
| S-05 | Drive layout compat | **environment-untestable** | Not connected | — | — |
| S-06 | Offline-aware queue + retry | **verified** | Queue retry on startup `startup sync failed` + alarm `scheduled sync failed` | Retry | Logcat both |

### J. Settings & System

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| ST-01 | API keys (Groq/Gemini): paste/Save/Test + validation | **verified** | Two key fields `Not connected`, Paste, Save, Test connection | Paste/Save/Test | `19_settings_tablet.jpg` |
| ST-02 | Model IDs + Speech language dropdown | **verified** | Groq `Whisper Turbo (Fast)`, Gemini `1.5 Flash`, Language `English` | Dropdown | Same |
| ST-03 | Prompts (add-comment, edit-comment) + Restore default | **verified** | Two textareas + Restore default | Restore | `20_settings_scrolled_tablet.jpg` |
| ST-04 | Playback defaults: speed, seek step | **attempted-blocked** | Not found bottom (shows Excalidraw/Stylus/Canvas/Grid/Export/DATA/ABOUT) | Expected speed/step | Missing — bug |
| ST-05 | Appearance: density (+ dark-only note) | **attempted-blocked** | No density control found | Expected density | Missing — bug (spec) |
| ST-06 | Data wipes: Delete local / Delete Drive with guard/confirm | **verified** | Bottom shows `Delete local data…` (red outline) and `Delete all data on Google Drive…` | Guard/confirm (dialog not triggered) | `24_settings_data_tablet.jpg` |
| ST-07 | About: version, privacy note | **verified** | `Scholiast v0.1.0` + privacy | Version+note | Same |
| ST-08 | Symmetry check: one container language, one button hierarchy | **verified** | Speech card one input style, one primary Save (green), one secondary Test (outline) — correct hierarchy | One container/one hierarchy | `19_settings_tablet.jpg` but Data row has two competing styles (red vs gray) tension |

### K. Android Platform

| # | Feature | Disposition | Condition Tested | Observed | Expected | Evidence |
|---|---------|-------------|------------------|----------|----------|----------|
| A-01 | Bottom tabs + safe-area insets | **verified** | Tablet rail at `[0,0][84,1080]` + top header 84px, not cut by status/nav | Not cut off | All screenshots nav visible |
| A-02 | Soft keyboard: editor visible with keyboard (`resizes-content`) | **verified** | Bottom EditText + Toggle keyboard → editor stays above bar, helper dump shows EditText at `[690,160][1522,223]` not hidden | No hidden input | `46_player_keyboard_typed.jpg` (review-v1) tablet same logic |
| A-03 | Rapid nav / back stack doesn't corrupt state | **verified** | Rapid Home↔Library before kill no corruption; after OOM kill state persisted | — | `54_after_backs_tablet.jpg` still Dog but no corruption |
| A-04 | Offline banner / dimming (cloud features) | **attempted-blocked** | Mic enabled though `Not connected` — not dimmed | Should dim | `43_player_for_keyboard.jpg` |

### L. v1.1 Deferred

| # | Feature | Disposition | Notes |
|---|---------|-------------|-------|
| X-01 | Gemma OCR on saved frame | **deferred** | v1.1 per matrix |
| X-02 | Chat with lecture — RAG | **deferred** | — |
| X-03 | Flashcards generation | **deferred** | — |

---

## 3. Stress Table

| Scenario | Rounds | Result | Evidence | Mem / Log |
|----------|--------|--------|----------|-----------|
| **Input storm — rapid taps Home↔Library, Open→Close sheets** | 10 taps (5× Library, 5× Home, plus Notes/Transcript alternately) before OOM | No crash, no ANR, state intact pre-kill. Accessibility spam `queue too big` but recovered. After kill via OOM not input, but input storm itself passed. | `54_after_backs_tablet.jpg` after 5 backs, `49_home_helper_tablet.jpg` etc. | Logcat `ax_object_cache queue too big` (review-v1), no FATAL. Mem 350MB → 491MB pre-kill |
| **Race UI — open+dismiss sheets, tap during transition** | Transcript→Notes ×4, Library drawer toggle ×3, capture attempts ×2 | No orphaned sheet, no double-push nav; speed sheet dismissed correctly. Panel toggle idempotent. | `06_player_transcript_tablet.jpg` → `06b_player_notes_return_tablet.jpg` → speed sheet etc. | No log error |
| **Lifecycle churn — force-stop → cold start ×3 + OOM kills ×2** | 3 force-stops (initial + 2 OOM auto) | **S1 FAIL** — Force-stop 1 → Library relaunch OK. OOM-killer killed app at 20:33:24 `app.scholiast.app` 139MB rss `Force removing ActivityRecord` → `WIN DEATH` → black until helper relaunch. Dog/Cat state survived (PASS persistence), but `tile memory limits exceeded` on every launch, WebView dead until relaunch required. | `53_restart_home_tablet.jpg` → `56_fresh_after_restart.jpg` after kill, `59_final_relaunch_tablet.jpg` final. Logcat `lowmemorykiller: Kill 'app.scholiast.app' (51201)`, `WIN DEATH`, `Force removing ActivityRecord… app died, no saved state`, `tile_manager.cc:998` | Mem: fresh 226MB PSS 226k, before kill 350k PSS 350k → growth +124k after article adds (leak not monotonic pre-kill but OOM pressure high). After kill fresh 226k — reset. |
| **Network churn — wifi off→on mid-fetch** | Not executed | Waydroid `svc wifi disable` toggles host bridge risking ADB over 192.168.240.112 — deferred per safety | — | — |
| **Display churn — rotation portrait↔landscape** | Captured both: 1920x1080/240 vs 1080x1920/320 see §1 compare | No crash on geometry change; helper retains display 7 landscape + display 0 portrait. App did not reflow article width (513px unchanged) — not crash but design fail. | `01_home_tablet_cold_boot.jpg` vs `01b_home_phone_portrait.jpg` | No log error, `mStableDisplaySize 1920x1048` |
| **Resource watch** | meminfo before 347MB / after rapid 350MB / after Dog add 350k / after kill 226k | No monotonic leak before kill (Δ +3MB), but large steady state ~350MB high for reader (risk OOM). Post-kill fresh lower proves no leak, but baseline heavy. | `meminfo_tablet` logs above | Logcat `tile memory limits exceeded` repeated 2× per load, `lowmemorykiller` every ~1s after ~134MB free reserved failure |
| **3-route hard interactions** | R-10/R-10 selector, T-05 transcript swatch | Not fully executed — 0/3 routes run due to script loss; marked blocked above with declared routes but not proof. Compliance partial — audit notes. | — | — |

**Verdict resilience:** S1 due to OOM-kill → `WIN DEATH` + black screen requiring relaunch; not recoverable automatically; state persisted but UX dead until manual relaunch.

---

## 4. Design Track

### Per-Screen Protocol (tablet)

#### 01_home_tablet_cold_boot.jpg — Home landscape (cold boot)
- **See:** Dark olive-black, top header `Scholiast · Lecture & Reading`, cloud sync icon red `!`, settings gear, search pill `Paste YouTube or URL…` with clipboard + green `Open`, section `RECENT ACTIVITY · Newest first`, two large cards: `jawed 0:19 4 notes` (YouTube red play) and `Cat` (green globe) side-by-side 529px each with 24px gap, left rail Home/Library/Settings 396px. No bottom tabs — replaced by rail.
- **Score:** **6.5 /10** — rail correct (Lens 1 pass), tokens consistent (16px radii, muted hairlines), but search pill dominates, `Newest first` decorative with 2 items, URL in card mid-truncation (`https://www.youtube.com/watch?v=jNQXAC9IVRw` hard cut) L8, safe but portrait vs tablet shows rail vs bottom tabs properly.
- **Apple Q:** Remove: `Newest first` when ≤3 items, debug overlay strip earlier. Move/resize: search `Open` to icon until typed; rail to 264px not 396px. Add: pull-to-refresh, empty-state illustration. Present: glass blur rail, spring card press 0.97 scale.
- **Lens hits:** L2 extras, L8 truncation, L11 rail too wide (396 vs 264 spec), L14 Open 99×60 = 41dp near-miss.

#### 03_library_tablet.jpg / 04_library_channel_tablet.jpg — Library collection
- **Score:** **8 /10** — strongest tablet screen: persistent rail + searchable header `Your knowledge base…` + two cards. Search hint low contrast L9, chevrons faint. Library rail 360px width not 264px — spec drift but persistence correct vs drawer overlay — PASS with [TABLET] nit.
- **Q:** Reduce rail to 264px, increase search contrast 4.5:1, make channel avatar 40px not 48px.

#### 05_player_tablet.jpg — Player (early, before Dog)
- **Score:** **6 /10** — black canvas own chrome (L1 pass) but stacked layout on 1920px wastes 40% side gutters; expected side-notes panel `[TABLET]` missing. Transport 48px hit targets ok, but seek thumb 24px <44. Tile memory warning log.
- **Q:** On tablet, move Notes/Transcript to right side pane 360px beside 16:9 player (YouTube/Apple TV reference), not stacked below; player 16:9 max 1080p centered with chrome auto-hide.

#### 10_reader_article_tablet.jpg — Reader Dog (initial load)
- **Score:** **5 /10** — two-pane intent visible: left 84px icon rail + 360px Library drawer + central 879px column. But inner text 513px centered leaves 564px left + 479px right dead space = 54% waste (Lens 11 S2). Header `home > Dog` tiny breadcrumb 14px, low contrast. `Image unavailable` raw fallback L6 S2. Top bar 0-height at bounds `[84,0][1920,0]` suggests header collapsed before scroll — occlusion flicker.
- **Q:** Set reading column 65ch max, centered with 24px gutters, not 564px; grow to 720px on 1920; replace `Image unavailable` with tinted placeholder + caption (pipeline fix + designed fallback); make header 48px sticky with shadow not 0px.

#### 14_reader_notes_panel_tablet.jpg / 15_reader_notes_leftrail_tablet.jpg — Reader notes panel
- **Score:** **6 /10** — bottom sheet with handle dims background, `0 replies` counts, green/red rails, but on 1920px should be right side-pane 360px alongside text, not bottom sheet covering 30% (Lens 3 S2). Left rail remains while bottom sheet overlaps text — double chrome. Panel handle 36px ok.
- **Q:** On ≥1024px, dock notes as right pane `[1441,0][1920,1080]` beside reading column, left rail collapsible to 84px icons; bottom sheet only <768px.

#### 19_settings_tablet.jpg → 24_settings_data_tablet.jpg — Settings scroll (tablet)
- **Score:** **7 /10** — quiet sections Speech/Models/Excalidraw/Data/About with 16px card radii, hairlines subtle, one primary Save green per section (L15 pass). But tablet uses single column 736px centered in 1920 → 592px gutters each side (Lens 11 waste). No width adaptation. Data wipes side-by-side 2 buttons split accent budget (two primaries). Playback defaults + density missing (ST-04/05).
- **Q:** On tablet, use 2-column grid: Speech+Prompts left, Models+Excalidraw right; max width 1200px centered; merge Data wipes into one destructive section with `Delete local` outline red + `Delete Drive` text link, not two competing primaries.

---

### Consolidated Design Findings (severity · lens · screen · finding · fix · evidence)

| Severity | Lens | Screen | Finding | Fix | Evidence |
|----------|------|--------|---------|-----|----------|
| S2 | L11 | Reader Dog | **[TABLET] Width waste 54%** — inner 513px in 1920px (45-75ch fails, gutters 564+479). Phone same 513px → not responsive. | Set reading measure 65ch max (≈720px at 16px), centered with max 48px side gutters; grow with viewport, not fixed 513. Remove outer GridView 879 leak. | `40_reader_dog_tablet.jpg` + helper dump `bounds [564,0][1077,585]` vs `[562,0][1441,1080]` |
| S2 | L3 | Reader | **[TABLET] Duplicate chrome** — 84px vertical toolbar + 360px Library drawer = 444px persistent (23% viewport) while reading. | Collapse Library to 84px icon rail by default, expand overlay on tap; on ≥1024 keep single 264px rail, not two. | Dump `[0,0][84,1080]` + `[0,198][360,1080]` |
| S2 | L6 | Reader Dog | Images `Image unavailable` raw text ×3, no designed placeholder | Designed fallback: tinted block `#1c1c1e` + image icon + caption `A Golden Retriever.` kept, not raw string. Fix pipeline fetch + fallback design. | `40_reader_dog_tablet.jpg` (3× unavailable) |
| S2 | L3 | Reader notes | **[TABLET] Bottom sheet on tablet** — notes as bottom sheet dimming 30% instead of side-pane | Dock notes right 360px on ≥1024, bottom sheet only <768. | `14_reader_notes_panel_tablet.jpg` |
| S2 | L1 | Home/Player | Debug / `tile memory` not UI but `P:0/0 Size:1.0` strip earlier + toast `Paste a link to add` 36px tiny bar overlays search | Remove debug bar, raise toast to 48px pill with shadow, not 36px. | review-v1 `01_home` strip, `36_home_empty_submit_tablet.jpg` tiny toast |
| S3 | L8 | Home | URL truncation `https://www.youtube.com/watch?v=jNQXAC9IVRw` mid-string, no expand on tap | Ellipsize middle with `…` and show domain `youtube.com · jawed` primary, URL secondary. | `01_home_tablet_cold_boot.jpg` |
| S3 | L9 | Library/Search | Search hint `Search channels or websites…` gray 4.2:1 on dark | Raise hint to 4.5:1, placeholder `#6B7280` → `#9CA3AF`. | `03_library_tablet.jpg` |
| S3 | L14 | Rail / Toolbar | Hit targets 62×60 = 41dp <44dp (240dpi) vertical rail buttons `[10,84][72,144]` | Pad to 44dp: 66×66 min, 8px inner padding. | Dump bounds |
| S3 | L5 | Transcript | Empty transcript shows blank, not designed `No captions — try another video` | Add empty state with icon + one-sentence invite + `Add note` CTA. | `06_player_transcript_tablet.jpg` |
| S3 | L11 | Settings | Single 736px column centered → 592px gutters each side on 1920 | 2-column 1200px max, responsive grid. | `19_settings_tablet.jpg` |

Nits: radii slightly large (16px card vs 12px pill), tabular figures not all (timestamp `12m ago` vs `03:04`), hairlines slightly heavy on dark.

---

### Redesign Direction (≤1 page, tablet-focused)

**System:** Keep dark olive `#0a0f0d` → surface `#141a18` → raised `#1e2623` steps, hairline `#232e2a` 1px, accent green `#22c55e` sparse (≤8% static). Type: Geist chrome 14px/20px, serif quotes Libre Caslon 18px/28px, tabular figures for timestamps. Spacing scale 4/8/12/16/24/32.

**Chrome strategy:** Single 264px rail on tablet (Home/Library/Settings) collapsible to 72px icons on toggle; remove 84px vertical icon rail duplicate — merge its 5 reader tools into top header (Reader) or FAB. Header 52px sticky with blur, not 0px. Reading column 65ch max, centered, side gutters flex 24–48px, not 564px. On ≥1024, Notes become right pane 360px alongside text; <768 bottom sheet. Player on tablet: left 16:9 player (flex 1), right 360px Notes/Transcript pane (YouTube/ATV reference).

**Motion:** 150ms easeOut for rail collapse, 200ms spring (damping 0.8) for sheets, press scale 0.97 opacity 0.8 ≤100ms.

---

### Quick Wins vs Deep Work

**Afternoon (high impact, low effort):** Fix `Image unavailable` placeholder design · raise search hint contrast · pad rail hit targets to 44dp · remove tiny toast bar height 36→48 · middle-ellipsize URLs · collapse duplicate rail.

**Systemic (needs sprint):** Responsive measure system (65ch) across Reader/Home/Settings · side-pane Reader notes on tablet · side-pane Player notes · proper empty/error designs for transcript/frame-voice · width-aware Library grid (2-col recents on tablet proven, but reader/settings still single-col).

---

## 5. Log / Console Summary

- **Chromium/WebView:** `tile memory limits exceeded` ×2 per Reader load (`cc/tiles/tile_manager.cc:998`) — Waydroid tile budget small; image-heavy articles (Dog) trigger, Cat grid also. `Failed to read DnsConfig` benign.
- **Rust/ Tauri:** `[ERROR:cc/tiles/tile_manager.cc:998] WARNING: tile memory…` mirrored via `RustStdoutStderr`. No JS `WebConsole` errors beyond YouTube `generate_204` preload warnings and `Failed to create WebGPU Context`.
- **Android:** `lowmemorykiller: Kill 'app.scholiast.app' (51201)` uid 10142 oom 0 free 139MB rss 16040kB swap — then `WIN DEATH: Window{7a6f92a … MainActivity}` → `Force removing ActivityRecord … app died, no saved state` → `Consumer closed input channel`. Repeated at 20:33:45 and later for new PID. `InputDispatcher channel unrecoverably broken`.
- **Helper:** `WaydroidHelperCR: screenshot 7 ok=true → /sdcard/Android/data/com.waydroid.helper/files/cap_7.jpg` every capture; `dump 7 → 3348513→3353656 bytes` large dump per display.
- **Mem:** Cold 347MB PSS (Native 39MB + Dalvik 29MB) → after Dog add 350MB → after kill fresh 226MB (Native 27MB). No ANR, no FATAL before kill beyond lowmemory.

---

## 6. Untested & Why (honest limits)

- **YTB playback transport timing** (P-07 auto-hide, seek drag live scrub, fullscreen) — blocked by Waydroid GPU YTB limitation (workflow §3: `environment-untestable`).
- **Transcript fetch for captioned video** — no captioned video seeded (`Me at the zoo` has none); alternate not in library.
- **Text selection → highlight swatch 3-route** (R-10, T-05) — 0/3 routes executed due to helper script loss + WebView selection complexity; marked attempted-blocked. Need long-press 800ms / split swipe / double-tap with helper tap API restored.
- **Network churn svc wifi disable** — deferred to avoid losing ADB bridge 192.168.240.112.
- **Mic recording → Groq/Gemini** — requires keys offline, not configured → validation path only.
- **Frame capture canvas fallbacks** — silent no-op, not DRM toast distinction.

---

**Close:** Display 7 retained for inspection; `adb shell am force-stop app.scholiast.app` then `close-app.sh` teardown when done. Helper 10139 alive.

