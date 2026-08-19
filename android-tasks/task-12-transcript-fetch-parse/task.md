# Task 12 — Transcript fetch & parse

Status: DONE

## Objective
The transcript data layer: fetch YouTube caption tracks via the innertube player endpoint, parse cues, chunk them into paragraphs, and expose a typed transcript model with stable cue indexes for anchoring.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `domain/transcript/TranscriptClient.kt` — innertube `youtubei/v1/player` client (IOS then WEB context), caption track selection (`pickTrack`), track fetch (`&fmt=json3`), cue parsing
- `domain/transcript/TranscriptModels.kt` — `TranscriptCue(index, startMs, endMs, text)`, `TranscriptParagraph(index, text, startMs, endMs, cues: IntRange)`, `CaptionTrack(languageCode, name, baseUrl, isAsr)`, `TranscriptResult`
- `domain/transcript/CueParser.kt` — `parseCuesXml`/JSON3 parsing port
- `domain/transcript/TranscriptChunker.kt` — `semanticChunk` port
- `domain/transcript/TranscriptClientTest.kt` — fixtures from the desktop repo's test data or captured responses

## References (read first)
- `../scholiast_mobile_app_plan.md`: §5.6.1 (fetch & parse port list — drop DOM/Defuddle paths), §5.6.2 (live follow needs cue start times), §5.6.3 (anchoring needs stable cue indexes), §2 (caption language: picker defaults English; per-video session choice), §12 port map
- Desktop source to port: `../src/utils/video/video-transcript.ts` (innertube player call, `pickTrack`, `parseCuesXml`, `semanticChunk`) and `../src/utils/video/yt-transcript-extractor.ts` (the innertube request shapes)

## Requirements
- `getTranscript(videoId, preferredLang): TranscriptResult` — player response → `captionTracks` → pick track (session preference → English non-ASR → first) → fetch `baseUrl&fmt=json3` → cues → chunked paragraphs. No captions → typed `NoCaptions` result (UI disables the tab).
- Language picker data: expose the full track list so the UI can offer a picker; a `setSessionLanguage(code)` call re-fetches.
- Cues carry a stable integer index (their position in the JSON3 events array) — the anchor scheme uses `(cueIndex, charOffset)`.
- Network errors: typed results (network, 404, parse failure) so the UI can render offline banners.
- Pure parsing functions separated from the HTTP layer for testability.

## Acceptance criteria
- Unit tests: parse a captured JSON3 sample into cues with correct start/end/text; `semanticChunk` groups cues by sentence/gap boundaries matching the TS behavior on the same fixture.
- `pickTrack` priority order verified by test (preferred → English → first; ASR deprioritized).
- Integration test (optional, marked `@Ignore`): a real videoId returns a transcript; if network-disabled in CI, keep the fixture-based tests as the gate.

## Agent notes
- The innertube response shape changes over time — isolate it in `TranscriptClient` with a clear seam; log the request/response shapes you observed.
- JSON3 events can include `aAppend` (non-start events) — handle them the way the TS does (accumulate into the previous segment's text, don't create spurious cues).
- Write your log to `LOG.md` as you work.