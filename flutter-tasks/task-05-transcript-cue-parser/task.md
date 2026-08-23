# Task 05: Transcript Cue Parser & Chunker

Status: DONE
Wave: 1
Depends on: task-02-core-domain-models

## Scope & Owned Files
- `scholiast_flutter/lib/core/algorithms/cue_parser.dart` (Port of `CueParser.kt`)
- `scholiast_flutter/lib/core/algorithms/transcript_chunker.dart` (Port of `TranscriptChunker.kt`)
- `scholiast_flutter/lib/core/models/transcript_models.dart` (Freezed: `Cue`, `CueParagraph`)
- `scholiast_flutter/test/core/cue_parser_test.dart`

## Acceptance Criteria
- Parses YouTube caption XML / JSON cues into timestamped paragraphs.
- `dart test test/core/cue_parser_test.dart` passes 100%.
