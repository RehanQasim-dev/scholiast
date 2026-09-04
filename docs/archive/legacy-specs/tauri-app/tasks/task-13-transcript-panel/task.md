# Task 13: Transcript Panel & Annotation UI

Status: DONE
Wave: 3
Depends on: task-02, task-12

## Scope & Owned Files
- `scholiast_tauri/src/player/TranscriptPanel.tsx` — paragraph cards from `fetch_transcript`; `[M:SS]` seek pills; karaoke active-cue bold-white; smooth follow keeping active line ~30% from top (scroll only when active cue changes)
- Language picker in header (>1 track), session memory per video (prefs key `transcript.lang.<videoId>`)
- Selection → `SwatchPopup`: yellow/red/green swatches + 💬 Comment (component shared with Reader later — place in `src/components/`)
- Highlight creation: derive `M:SS–M:SS` from covered cues; save `kind:'transcript'` item with `anchor{startCue,startOffset,endCue,endOffset}`, quote, color via task-02 commands
- Inline repaint of saved highlights while scrolling/reopen; click highlight → open thread (task-07 sheet reused for reply flow)
- Search box filtering paragraphs with jump+pause
- Transcript tab enablement tied to captions availability event

## Acceptance Criteria
- Component tests: selection→swatch→item persisted; repaint on reload; picker precedence
- Live-follow unit test with mocked clock/cue index

## Notes
Anchor format must equal extension's `TranscriptAnchor` exactly (task-02 types).
