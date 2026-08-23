# Task 02: Core Domain Models & URL Normalization

Status: DONE
Wave: 0
Depends on: task-01-scaffold-toolchain

## Scope & Owned Files
- `scholiast_flutter/lib/core/models/page_record.dart` (Immutable: `PageRecord`, `PageTombstones`, `VideoPage`)
- `scholiast_flutter/lib/core/models/page_highlight.dart` (Immutable: `PageHighlight` with extras map preservation)
- `scholiast_flutter/lib/core/models/page_stroke.dart` (Immutable: `PageStroke`)
- `scholiast_flutter/lib/core/models/page_diagram.dart` (Immutable: `PageDiagram`)
- `scholiast_flutter/lib/core/models/video_item.dart` (Immutable: `VideoItem`, `VideoMarkup`, normalized points)
- `scholiast_flutter/lib/core/models/linear_article.dart` (Immutable: `LinearArticle`, `LinearBlock`, `LinearAnn`)
- `scholiast_flutter/lib/core/models/page_source.dart` (Immutable: `PageSource`)
- `scholiast_flutter/lib/core/algorithms/normalize.dart` (Port of `Normalize.kt`: `normalizeUrl`, `urlHash`, `extractVideoId`, `pageFileName`, `pageFilePath`)
- `scholiast_flutter/test/core/models_test.dart`
- `scholiast_flutter/test/core/normalize_test.dart`

## Acceptance Criteria
- Full JSON serialization round-trip matching Kotlin/TS schemas verbatim.
- Extras-preserving serialization for `PageHighlight`.
- `dart test` passes 100% on model and normalization unit tests (39/39 passed).
