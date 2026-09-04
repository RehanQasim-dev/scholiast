# Task 12: Transcript Fetch & Parse Core

Status: DONE
Wave: 1
Depends on: task-01

## Scope & Owned Files
Rust:
- `crates/core/src/cue.rs` — `Cue{start,end,text}`; json3 parser (`events[].segs`, tStartMs/dDurationMs) + XML fallback parser; `semantic_chunk(cues)->Vec<Paragraph>` ported from extension `semanticChunk` (same grouping thresholds)
- `src-tauri/src/transcript/client.rs` — innertube client: `POST youtubei/v1/player` IOS context → WEB fallback; `captionTracks` extraction; `pick_track(session_pref, tracks)` (session → English non-ASR → first); fetch `baseUrl&fmt=json3`
- Command: `fetch_transcript(videoId, langPref) -> {lang, paragraphs[], cues[]}` with in-memory + disk cache keyed `(videoId, lang)`; graceful "no captions" error variant

## Reference sources
Extension `../src/utils/video-transcript.ts`; Kotlin port `../android/.../domain/transcript/`.

## Acceptance Criteria
- wiremock tests: IOS→WEB fallback, pickTrack precedence matrix, json3 parse fixtures copied from repo tests
- Chunker golden test vs committed paragraph fixtures

## Notes
No DOM paths. Cache survives offline restarts (plan §6.11).
