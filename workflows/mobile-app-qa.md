# Workflow — Mobile App QA Review (Scholiast)

Operating doctrine for any QA/SQA agent asked to verify the mobile app
(`app.scholiast.app`, Tauri build running on Waydroid). This replaces the old
"click through the flows and log crashes" style of testing.

The review has **three equal tracks** — a pass requires all three:

1. **Functional** — every feature works under real-world conditions, not just
   the demo path.
2. **Stress / resilience** — the app survives abuse: rapid input, races,
   interruptions, lifecycle churn, bad data. No crash, no ANR, no corrupted
   state.
3. **Design / craft** — judged against one bar:

> It should feel like an Apple app — modern, quiet, confident. Very clean,
> never at the cost of function. Nothing on screen that doesn't earn its place,
> and nothing essential hidden where no one will find it.

---

## 0. Mindset

1. **Guilty until proven intentional.** Every pixel, label, color, gap, and
   behavior you encounter was a decision. Treat each one as wrong until it
   justifies itself.
2. **Judge what you SEE and FEEL, not what the plan says.** The plan describes
   intent; the running app is the truth. A feature that exists but looks or
   behaves badly is a finding, not a pass.
3. **Every criticism ships with a concrete fix.** "This is bad" is noise.
   "Move X behind Y, reduce to Z px, reveal via edge-swipe" is a finding.
4. **Reject false trade-offs.** When a design seems forced to choose between
   two goods (feature vs. space, clarity vs. cleanliness), do not pick a side —
   name the pattern that achieves both. On mobile there almost always is one;
   settling for the dilemma is laziness, not pragmatism.
5. **Subtract before you add.** When something feels off, the first question
   is always "what here should not exist?" — only then "what is missing?"
6. **Review at three zoom levels**, always all three:
   - *Frame* — layout, hierarchy, spatial budget, navigation.
   - *Component* — each control's shape, state, feedback, consistency.
   - *Pixel* — alignment, truncation, contrast, optical details.

## 1. Ground rules

- **No hardcoded bug lists.** This document contains principles, never known
  issues. Apply the lenses fresh each run and catch *this run's* problems —
  including classes of problem nobody has documented yet. Recognizing a past
  example counts for nothing; recognizing a new instance of the same *class*
  anywhere in the app is exactly the job. If you notice yourself testing for
  a specific remembered bug instead of applying a principle, stop and
  generalize.
- **Evidence or it didn't happen.** Every finding cites a screenshot (path)
  and, where relevant, a UI-dump node or logcat line. Annotate/crop when the
  defect is small — make the reader see it instantly.
- **Capture everything first, then review.** Drive the whole app and collect
  the full set of screenshots/states before writing verdicts. Half the value
  of a design review is cross-screen comparison; inconsistency is invisible
  screen-by-screen.
- **Environment honesty.** Note where Waydroid limits you (no mic, DRM video,
  GPU tiles) and mark those flows untested — but never let an environment
  limitation excuse a defect you can observe.

## 2. Before reviewing

Load these skills and actually apply them — each covers a failure mode the
others miss:

| Skill | Use it for |
|---|---|
| `waydroid-inspect` | Capture mechanics: screenshots, UI dumps, scoped input, frame recording. |
| `apple-design` | The foundations bar: response, direct manipulation, interruptibility, restraint, fluid motion. |
| `emil-design-eng` | Component polish and the invisible details; the difference between works and feels great. |
| `design-taste-frontend` | Anti-slop judgment: templated/AI-generic layouts, weak type/color systems, decoration posing as design. |
| `review-animations` | Craft-bar review of any observed transition/motion. |
| `find-animation-opportunities` | Where motion *should* exist but doesn't; mine it for concrete "this would feel alive if…" proposals with values. |
| `improve-animations` | Structure motion findings as a prioritized advisory plan rather than scattered nits. |
| `animation-vocabulary` | Name observed effects precisely ("rubber-banding", "pop-in") so findings and fixes are unambiguous. |

Out of scope for a QA run (they build, we judge): `pick-ui-library`,
`prototype`. Reference them only inside improvement proposals when relevant.

**First action: create your evidence folder.** Make one directory for this
run under `/tmp/opencode/` named `qa-<yyyymmdd>-<app-or-slug>/` (e.g.
`qa-20260826-tauri-android/`). Every screenshot, recording, UI dump, and
logcat capture goes there, with ordered, self-describing names
(`01_home_cold_boot.jpg`, `07_player_stress_rapid_taps.mp4`, …). Never
scatter artifacts elsewhere. This path is a deliverable: the final report
MUST state it up front so the main agent can open and inspect the images
itself later.

**Do not read any existing `/tmp/opencode/qa-*` folders or `report.md` from prior runs** — always create a fresh folder and a fresh `report.md`. Prior runs are irrelevant.

**Full coverage mandate:** Every matrix row in §3.1 must be exercised and dispositioned — no row left as `NOT TESTED` or skipped via cascading `blocked by previous`. The only excuse for not testing a row is the app being completely dead (won't boot). If one feature is broken, that does not excuse skipping unrelated features. Even when YTB playback is broken, all other features (Home validation, Settings, Reader empty/UI, Transcript fetch, Notes empty states, comments UI structure, sync UI, platform checks) are still testable and must be tested. Known environment limitation: **YTB video playback never leaves `Loading player…` in Waydroid due to WebView/GPU tile issue — disposition P-01/P-07/T-04 as `environment-untestable` with that cause, note it once, then test everything else flawlessly without using it as a blanket excuse.**

**Live report file (mandatory):** Inside that folder, create `report.md` on
start. As you test — the moment you confirm a finding, a score, or a
disposition — append it to that file immediately. Do not batch everything
to the end. The main agent reads this file directly after your run, so it
must be complete and up to date even if the run is interrupted. Your final
message still returns the full report inline, but `report.md` on disk is the
canonical artifact.

Do not read `scholiast_tauri_app_plan.md`, task files, or READMEs — the
workflow plus the running app are your only inputs. Compare against
best-in-class references from memory: YouTube/Apple TV for the player,
Reader/Instapaper/Pocket for article reading, Apple Settings for density.

---

## 3. Functional track — beyond the happy path

The happy path proves the demo works. The job is proving the feature works
under real use. For EVERY feature, run this ladder:

1. **Happy path baseline** — record expected behavior and evidence first.
2. **Boundaries** — empty state, single item, huge item (very long text/url),
   max-length inputs, duplicates, zero results after filtering/searching.
3. **Invalid input** — garbage URLs, missing scheme, whitespace-only, emoji,
   RTL text, multi-line paste, absurd numbers. Every field and entry point.
4. **Failure injection** — network off before/during operations (`adb shell svc
   wifi disable` / `svc data disable`), kill the app mid-operation and relaunch,
   revoke whatever the flow depends on halfway through. Every failure must land
   in a *designed* state with a next step — raw error text, infinite spinner,
   or silent no-op are failures.
5. **Persistence** — force-stop → relaunch: did state survive (recents,
   settings, drafts, playback position, half-finished flows)? Nothing the user
   did should vanish without explanation.
6. **Idempotency / double-fire** — repeat every action twice, fast: duplicated
   items, double navigation pushes, double submissions are defects even if no
   crash.
7. **Concurrency & cancellation** — start action A, immediately start B; leave
   a screen while its operation runs; trigger the same flow from two entries.
   Sane queueing/cancellation/no orphaned effects required.
8. **Data integrity after chaos** — after any failure/interrupt, verify stored
   data (lists, notes, settings) is complete and uncorrupted on next launch.
9. **Promise tracing** — UI copy that names an action (empty-state invites,
   hints, toasts, onboarding text) is a contract: trace every promised action
   to a reachable entry point by actually performing it. An action the UI
   invites but provides no affordance for is an S1 — the core flow it belongs
   to is unreachable, however pretty the invitation reads.
10. **Feature coverage matrix (mandatory)** — drive coverage from the
    embedded matrix in §3.1 below. Every feature must appear in the report
    with one of exactly three dispositions: **verified** (with flow
    evidence), **attempted–blocked** (what was tried, what blocked it,
    alternates attempted), or **environment-untestable** (precise
    limitation). A feature absent from the report is a defect in the report,
    not a pass. Silent omission is the single most common QA failure mode.
    The matrix in this file is the sole source of truth — do not read
    `tauri-tasks/`, READMEs, or the plan to extend it.
11. **Multi-route interaction rule (auditable)** — a hard touch interaction
    (text selection + drag handles, long-press menus, slider thumbs, draw
    gestures) is only "untestable" after ≥3 distinct synthetic-input
    strategies have been tried (e.g. long-press with hold duration,
    split incremental swipes, double-tap, keyboard/DPad route,
    uiautomator gesture API). One failed attempt is data about the input
    method, not about the feature.
    **Compliance is auditable:** for every such feature marked
    `attempted–blocked` or `environment-untestable` you must log all 3
    attempts in the report row itself (strategy + coordinates/duration +
    screenshot + observed result). A bare `NOT TESTED` without this log is
    a workflow violation — the report is incomplete. The allowed
    dispositions are exactly `verified`, `attempted–blocked`,
    `environment-untestable`, and `deferred` — `NOT TESTED` is forbidden.

### 3.1 Feature matrix — every run must disposition every row

Copy this table into the report. Each row gets one disposition:
**verified** (evidence) · **attempted–blocked** (what was tried + alternates + 3-route log where §3.11 applies) · **environment-untestable** (precise limitation + 3-route log where §3.11 applies).
Deferred rows are NOT failures — mark them as deferred. This table is exhaustive — do not add rows, do not use `NOT TESTED` or `PARTIAL`.

#### A. Home & Navigation
| # | Feature | Notes |
|---|---------|-------|
| H-01 | Cold boot → Home renders (splash, no crash) | <3s, logcat clean |
| H-02 | YouTube URL field: paste + validate + Open | valid → Player, invalid/garbage/whitespace/empty → toast, no reload |
| H-03 | Enter key in URL field submits (no webview reload) | known Android bug class |
| H-04 | Article URL field: paste + validate + Add | valid → Reader, invalid → toast |
| H-05 | Recent videos grid (thumbnail, title, count, recency) | tabular figures, cover at least 1-item + empty |
| H-06 | Tap recent card → Player resumes at saved timestamp | verify time, not just navigation |
| H-07 | Sync status chip in Home header | ready / syncing / failed states |
| H-08 | Bottom tabs: Home / Player / Reader / Settings (active state, ≥44pt) | |
| H-09 | Deep link `scholiast://open?url=` → Player | `adb shell am start` |
| H-10 | Share intent (ACTION_SEND text/plain) → Player | share from another app |
| H-11 | Empty states (no recents, no articles) — designed, not blank | |

#### B. Video Player
| # | Feature | Notes |
|---|---------|-------|
| P-01 | Load video from URL (iframe embed) | |
| P-02 | **Own the canvas** — no YouTube native chrome bleeding through | logo, "More videos" strip, YT controls |
| P-03 | Transport: play/pause toggle | pressed feedback |
| P-04 | Seek bar: drag + time updates live | dismiss YouTube's own bar |
| P-05 | Skip −15s / +15s | explicit buttons vs double-tap gesture — check both |
| P-06 | Speed, volume, captions, fullscreen | each state verified |
| P-07 | Chrome auto-hide during playback / tap to reveal | |
| P-08 | Video state persists across tab switches (away + back) | S1 if lost |
| P-09 | Back key from Player → Home | |
| P-10 | Empty state when no video (prompt copy) | promise-tracing: does it name a reachable action? |
| P-11 | Portrait stacked layout (player 16:9 top, panel below) | |

#### C. Notes & Timeline (video)
| # | Feature | Notes |
|---|---------|-------|
| N-01 | **Create timestamped note** (FAB / + note / Capture-note) | S1 if no affordance anywhere |
| N-02 | Notes tab: list in video-time order | |
| N-03 | Notes empty state copy is actionable | must trace to N-01 |
| N-04 | Tap timestamp chip → seeks player | |
| N-05 | Edit note (text/markdown) | |
| N-06 | Delete note (with undo where applicable) | |
| N-07 | Persistence across force-stop → relaunch | |

#### D. Comments & Rendering (video + reader shared)
| # | Feature | Notes |
|---|---------|-------|
| CM-01 | Add comment via editor sheet (typed) | |
| CM-02 | Markdown rendering (bold/italic/link/list/code, #tag) | sanitization, no raw markup |
| CM-03 | Thread / reply inside a note | |
| CM-04 | Edit / delete comment | |
| CM-05 | #tag autocomplete from tag index | typing `#` → dropdown |
| CM-06 | Latex / checklist rendering where supported | if markdown subset includes it |

#### E. Transcript
| # | Feature | Notes |
|---|---------|-------|
| T-01 | Fetch + render transcript with timestamp chips | captioned video |
| T-02 | Language indicator / picker (EN etc.) | >1 track case |
| T-03 | Search transcript | |
| T-04 | Current-cue follow (live highlight as video plays) | |
| T-05 | Select transcript text → swatch → highlight | multi-route per §3.11 |
| T-06 | Highlight persistence + comment on transcript highlight | |
| T-07 | Transcript error state (no captions → toast, not blank) | |

#### F. Frame Capture & Markup
| # | Feature | Notes |
|---|---------|-------|
| F-01 | Capture frame (canvas draw + screenshot fallback) | |
| F-02 | Draw/markup overlay (Excalidraw/FrameDraw) | |
| F-03 | Save frame note with markup → appears in Notes | |
| F-04 | Graceful failure (DRM → designed toast, not crash) | |
| F-05 | OCR of frame text *(v1.1 deferred — mark deferred)* | |

#### G. Voice Input
| # | Feature | Notes |
|---|---------|-------|
| V-01 | Mic button → record → draft inserted (cloud Groq/Gemini) | needs key; test validation path |
| V-02 | Local STT (whisper) path — Settings shows "not built" when absent | designed empty, not raw error |
| V-03 | Voice edit on existing comment (VoiceEditSheet) | |
| V-04 | Offline dimming of mic when no network / no engine | |
| V-05 | Keyboard opt-in button (focus alone doesn't open OS keyboard) | |
| V-06 | Recording indicator + cancel restores prior text | |

#### H. Reader (article reading)
| # | Feature | Notes |
|---|---------|-------|
| R-01 | Add article by URL → extraction (readability pipeline) | |
| R-02 | Loading state (skeleton/progress, not "Untitled" flash) | |
| R-03 | Render: title, body, headings, links, lists, code | hierarchy preserved |
| R-04 | Images: load or **designed** fallback (not raw "Image unavailable") | pipeline + design defect if broken |
| R-05 | Tables / infoboxes render correctly (colspan, nested, no letter-soup) | the Cat-page regression |
| R-06 | Reading comfort: 45–75ch measure, ≥16px body, 1.4–1.6 leading | measure from image |
| R-07 | Toolbar: A− / A+ / Serif / width | no dev noise like raw "736px" |
| R-08 | Delete / Sync article actions | |
| R-09 | Breadcrumb (Library / Title) navigation | |
| R-10 | Select text → highlight (swatch, yellow/red/green) | multi-route per §3.11 |
| R-11 | Highlight repaint on reopen (anchor port: web ↔ reader) | |
| R-12 | Annotations / thread panel (ThreadPanel, bottom sheet on narrow) | |
| R-13 | Voice comments inside reader threads | |
| R-14 | Floating controls don't occlude text; drawer/sheet behavior on narrow | |
| R-15 | Library rail / drawer (slide-over on narrow) | |

#### I. Sync & Storage (Drive)
| # | Feature | Notes |
|---|---------|-------|
| S-01 | Google Drive connect (OAuth custom tab on Android) | at least error state is designed if untested |
| S-02 | Sync now + progress UI (page-by-page) | |
| S-03 | Sync status bar (ready / syncing / failed) — stable, not flickering | |
| S-04 | Startup + periodic sync scheduling | logcat: no tight loops |
| S-05 | Drive layout compat (`pages/page-<hash>.json` mirrors desktop) | |
| S-06 | Offline-aware: queue + retry on alarm/startup | |

#### J. Settings & System
| # | Feature | Notes |
|---|---------|-------|
| ST-01 | API keys (Groq/Gemini): paste / Save / Test + validation | |
| ST-02 | Model IDs + Speech language dropdown | |
| ST-03 | Prompts (add-comment, edit-comment) + Restore default | |
| ST-04 | Playback defaults: speed, seek step | |
| ST-05 | Appearance: density (+ dark-only note) | |
| ST-06 | Data wipes: Delete local / Delete Drive with guard/confirm | destructive placement |
| ST-07 | About: version, privacy note | |
| ST-08 | **Symmetry check**: one container language, one button hierarchy per screen | see Lens 15 |

#### K. Android Platform
| # | Feature | Notes |
|---|---------|-------|
| A-01 | Bottom tabs + safe-area insets (`env(safe-area-inset-*)`) | no cut-off by status/nav bars |
| A-02 | Soft keyboard: editor visible with keyboard (`resizes-content`) | no hidden input |
| A-03 | Rapid nav / back stack doesn't corrupt state | ties to stress track |
| A-04 | Offline banner / dimming (cloud features when network gone) | |

#### L. v1.1 Deferred — do NOT report as missing
| # | Feature | Notes |
|---|---------|-------|
| X-01 | Gemma OCR on saved frame (task-15) | |
| X-02 | Chat with this lecture — RAG over transcript (task-20) | |
| X-03 | Flashcards generation + export (task-20) | |

> This matrix is authoritative for the run — do not extend it by reading code or tasks.

## 4. Stress track — break it politely

Goal: **no crash, no ANR, no stuck UI, no corrupted state — ever.** Graceful
degradation is the only passing behavior. Run this battery; record video
(~1fps) throughout and sweep logcat after each loop:

- **Input storm** — 5–10 rapid taps on every primary button, menu item, nav
  tab; double-tap toggles; taps landing during the control's own transition.
- **Race the UI** — navigate away the instant an action starts; back-press
  during sheet animations, loads, and saves; open+dismiss the same sheet ×10
  in a loop; spam tab switches.
- **Lifecycle churn** — background→foreground ×10 during playback/sync;
  force-stop → cold start ×3; fire actions immediately after boot before the
  UI settles; repeat flows back-to-back without pause.
- **Network churn** — toggle wifi/data off→on mid-fetch and mid-sync; switch
  repeatedly during long operations.
- **Display churn** — change display size/rotation mid-playback and mid-read
  if the helper supports it.
- **Resource watch** — `dumpsys meminfo <pkg>` before/after each loop; flag
  monotonic growth. Grep logcat per loop for FATAL / ANR / SIGSEGV / Rust
  panics / JS errors. Watch recordings for jank and dead time.

**Verdict rules:** crash/ANR anywhere = S1. Silent state corruption = S1 even
without a crash. Recovered-but-janky = S3. Report stress separately from
functionality (scenario · rounds · result · evidence).

---

## 5. Design track — the lenses

Run every lens against every screen. Ordered roughly by damage done.

### Lens 1 — Ownership of the canvas
The app owns 100% of its surface. Anything visible that the *app* did not
draw is a defect: native chrome of embedded players/webviews bleeding through,
system UI artifacts, debug leftovers, library placeholder text, stray
scrollbars. Embedded external content (video pages, web articles) must be
wrapped in our own presentation with the host's chrome suppressed — duplicate
control sets fighting over the same pixels are the worst offender. Ask: "is
there anything on this screen whose presence I can't explain as an intentional
Scholiast element?"

### Lens 2 — Subtraction (the extras test)
Element by element: **if I deleted this, would anyone notice?** Delete-worthy:
labels restating standard gestures; redundant controls (two ways visible at
once); ornament with no information (separators, boxes, decorative icons);
values shown permanently that matter only mid-gesture (show transiently, on
interaction); confirmation steps for trivial actions. Count removals per
screen — a screen where nothing qualifies is rare.

### Lens 3 — Space economics & occlusion
Screen space is the scarcest resource on mobile. Two tests:

- **Occlusion:** what covers content? Estimate honestly what % of the
  viewport every floating element/panel/dock commands, whether chrome collides
  with other chrome, whether safe areas clip content. Name the remedy:
  resize, relocate, auto-hide, collapse to edge.
- **Footprint ∝ frequency:** any region holding permanent space must be
  needed *continuously* by the screen's primary act. A dock, panel, toolbar,
  or input area serving an *occasional* task must not squat between the user
  and the main content while idle. This is a defect even when the layout looks
  tidy.
- **Both-and, not either-or:** when permanent presence harms the primary act,
  the fix is never "remove the feature" nor "tolerate the lost space." Demand
  the on-demand pattern that keeps both: edge-swipe reveal, bottom sheet over
  content, collapse-to-a-few-px handle, auto-hide on idle + instant return on
  interaction, dedicated mode entered only when the task begins.
- **Trigger tax:** an on-demand control must itself cost ~zero space (an edge
  zone, an existing element, a tap on content) yet remain obvious — carried by
  platform convention, taught once (first-run hint or empty state). A hidden
  feature nobody discovers fails exactly as hard as a permanent dock nobody
  wants. Judge triggers on both axes: space cost AND discoverability.

Apply this to every screen: player chrome, reader docks, comment panels,
home cards. If >~10% of the viewport serves non-primary functions at rest,
that's a finding.

### Lens 4 — Discoverability by convention
Standard gestures need no signage: edge double-tap to seek, swipe to dismiss,
long-press for context, pull to refresh, tap to toggle chrome. Trust
conventions silently. Invented interactions require explicit teaching (empty
state, first-run hint) — flag invented interactions taught nowhere, and
conventional gestures missing where users will reflexively try them (the
gesture users attempt first and land nowhere is a finding).

### Lens 5 — Every state, designed
Per screen enumerate: empty · loading · error · degraded/partial · loaded ·
interactive feedback (pressed/dragging). Raw text, bare spinners, blank
nothing = findings. Empty states teach + invite (one sentence, one action);
errors offer the next step; loading preserves layout (no jump when content
lands). An inviting empty state is also a trap when its promised action
doesn't exist — pair every empty-state review with the promise-tracing step
of the functional ladder (§3.9).

### Lens 6 — Content fidelity & placeholders
Failed content must never surface as raw system text, browser-default
rendering, or developer messaging. Broken images, missing fonts, alt-text-as-
UI: each is a pipeline defect AND a design defect (the fallback should have
been designed — tinted block, icon, caption — even though the real fix is
upstream extraction/fetch). Report both layers separately.

### Lens 7 — Reading comfort
For any reading surface (article, transcript, notes), verify with numbers
sampled from screenshots, not vibes:
- Body size comfortable at arm's length (≈16px-equivalent minimum); measure.
- Line length 45–75 characters; measure from the image, flag wide measures.
- Leading ≈1.4–1.6; paragraph rhythm consistent; no justified-text rivers or
  crushed all-caps blocks.
- Contrast ≥4.5:1 sampled on actual pixels; margins protect the text block.
- **Distraction audit:** during pure reading, what remains visible that isn't
  prose? Persistent chrome should recede (hide on scroll-down, return on
  scroll-up) so the text owns the screen.
- Formatting fidelity: heading hierarchy preserved, lists render as lists,
  quotes/code don't overflow horizontally, inline media sized sanely.
- Endurance: read 3+ screens of continuous text and note eye-fatigue causes.

### Lens 8 — Text discipline
Truncation policy per text role: single-line ellipsis? Does a truncated title
have recourse (tap to expand/detail)? Mid-word hard cuts with no recourse are
always defects. Type scale ≤ ~4 sizes per screen; timestamps/durations in
tabular figures; metadata visually quieter than content everywhere.

### Lens 9 — Color
Token discipline (no one-off hexes); accent restraint (purple marks
interactivity — accent on >10% of a static screen means decoration is spending
it); contrast sampled on real surfaces, especially disabled/secondary states;
semantic consistency (destructive red, success green, accent purple — one
color never means two things); dark-theme surfaces step visibly (#000 → dark →
less-dark) so cards read raised; hairlines subtle, never gray-boxy.

### Lens 10 — Typography
Hierarchy legible when squinting (title vs metadata vs body still separable);
optical alignment of icons to text baselines; ≤2 weights per screen usually;
numerals aligned in columns/lists.

### Lens 11 — Layout rhythm & alignment
Left edges resolve to few distinct x-positions; sibling gaps come from a small
spacing scale (4/8/12/16/24…), not arbitrary values; the same component looks
hand-built by the same person on every screen. Tablet layouts must actually
use width — a phone column stretched into empty space is a finding.

### Lens 12 — Depth & materials
One elevation story everywhere (what floats above what, expressed consistently
via surface-lightening/hairline/blur — heavy shadows die on black backgrounds);
sheets/dialogs/toasts share one material language.

### Lens 13 — Motion & feedback
Every touchable responds on press (scale/opacity ≤100ms — capture pressed
states); transitions exist but stay quiet (none = dead, slow/bouncy = toy-like);
motion interruptible mid-flight; feedback continuous during gestures (scrub
updates live); reduced-motion respected if observable.

### Lens 14 — Touch ergonomics
Targets ≥44pt equivalent; primary actions in thumb arc; destructive actions
far from primaries and confirmed; generous row heights for scanning.

### Lens 15 — Consistency inventory & symmetry
While reviewing, inventory button styles, sheet styles, icon family, radii
values, toast patterns. One role rendered two ways = finding (name which wins).
Mixed icon families (outline + filled of different designs) read unfinished.
Then run the **symmetry pass** on same-kind elements — asymmetry between
peers is one of the loudest "unfinished" signals there is:
- Same-kind controls (text inputs, dropdowns, textareas) must share one
  container treatment, height, radius, and border — card-wrapped vs bare
  siblings on one screen is a defect.
- One button hierarchy per screen: exactly one primary style, one secondary,
  one tertiary; an orphan style used once (or three coexisting styles) is a
  defect. Two competing accent-colored primaries visible together split the
  accent budget and the user's attention.
- Sections on one screen must follow one treatment pattern (all cards, or
  all bare-with-headers — not alternating by accident).
- Spatial symmetry: check for dead columns, off-center content next to
  full-width elements, and paired floating controls at different sizes/
  offsets. Optical balance is judged from the full screenshot, not per
  element.

### Lens 16 — What's missing
Only after subtraction: undo after destructive actions, pull-to-refresh on
feeds, scroll-to-top, keyboard dismissal, remembered UI state, focus order.
Missing conventions rank below removals — adding to an unpolished base
compounds mess.

---

## 6. Per-screen protocol

For EVERY screen/state captured:

1. **Describe what you see** in one neutral paragraph (proves you looked).
2. **Run all three tracks**: functional ladder → stress scenarios relevant to
   this screen → lenses 1–16, noting hits.
3. **The Apple questions**, answered explicitly:
   - What would Apple *remove*?
   - What would Apple *move, resize, or put behind a gesture*?
   - What would Apple *add* (missing convention/state)?
   - How would Apple *present* it (materials, type, motion)?
4. **Score /10**, justified by lens hits, not vibes. Reserve 9+ for screens
   you'd ship unchanged.
5. **Write the before → after** for each hit: current state + concrete
   redesigned state, specific enough to implement without follow-up questions
   (values, positions, gesture, behavior).

## 7. Seeing better — how to read screenshots

- Zoom 2–4× into corners, edges, text before judging; most defects hide at
  boundaries (truncation, hairlines, misalignment).
- Squint test: blur your read — hierarchy problems pop out.
- Sample pixel colors for every contrast call; never eyeball.
- Compare the same component across screenshots for the consistency inventory.
- For anything animated: inspect recording frames for dead time (>100ms
  unresponsive) and discontinuities (jumps = non-spring motion).

## 8. Severity calibration

| Level | Meaning |
|---|---|
| S1 | Breaks core flow, misleads, corrupts state, crashes/ANRs, or foreign/persistent chrome defeating the primary act |
| S2 | Clearly below craft bar; every user sees it (space-waste, occlusion, raw error text, undisciplined accent, undiscoverable core action) |
| S3 | Noticeable on inspection (inconsistent radii, weak hierarchy, missing pressed state) |
| Nit | Polish residue; batch-list |

Severity applies within each track; a finding belongs to whichever track
exposed it (report tracks separately).

## 9. Report format

1. **Verdict** — PASS / PASS WITH ISSUES / FAIL as **three grades**:
   functional · resilience · design (a 10/10/4 app exists; say so plainly).
   The **evidence-folder path must appear in the verdict block itself**
   (`Evidence: /tmp/opencode/qa-…/`) — the main agent reads this report later
   and will open those images directly, so never bury or omit the path.
2. **Functional table** — feature · condition tested · observed · expected ·
   evidence.
3. **Stress table** — scenario · rounds · result · evidence (meminfo/logcat
   deltas included).
4. **Design track** — per screen: description, score, lens hits, the four
   Apple answers. Then consolidated: severity · lens # · screen · finding ·
   concrete fix · evidence path.
5. **Redesign direction (≤1 page)** — if overall design is below bar: system-
   level decisions (type scale, spacing rhythm, accent budget, chrome strategy
   incl. which controls go behind which gestures, motion character). Specific
   enough that a designer could redraw the app from this page alone.
6. **Quick wins vs deep work** — separate afternoon-fixes from systemic ones,
   each ranked by impact-per-effort.
7. **Untested & why** — honest limits.

## 10. Reviewer anti-patterns

- Don't pad with praise; "renders correctly" is a checkbox, not analysis.
- Don't review the plan or the code — review the running app.
- Don't propose features when execution is the problem (and vice versa: don't
  polish chrome that shouldn't exist).
- Don't accept trade-off framing ("keep the dock OR lose the feature") — reject
  the dilemma and name the both-and pattern.
- Don't soften severity to seem balanced. Calibrate, then tell the truth.
- Don't leave a finding without its fix, or a fix without its evidence.
