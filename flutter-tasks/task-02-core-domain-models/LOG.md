# Task 02 Work Log

## [2026-08-22 21:35] Core Domain Models Agent
- **What I learned:** 
  - Standard pure Dart immutable classes with custom serialization and JS-compatible numeric encoding (`jsNum`) eliminate code-generator lag, compile instantly, and guarantee byte-identical JSON parity with Kotlin and TypeScript models.
  - Extras preservation on `PageHighlight` ensures desktop-specific fields (`xpath`, `startOffset`, `endOffset`, `groupId`, `anchor`) are preserved seamlessly across roundtrips.
  - Normalization algorithm accurately filters all 20 ephemeral tracking parameters while preserving query order and resolving dot path segments.
- **Decisions made:**
  - Implemented `PageRecord`, `PageTombstones`, `PageHighlight`, `PageStroke`, `PageDiagram`, `VideoItem`, `VideoMarkup`, `LinearArticle`, and `PageSource` as immutable Dart models with exact TS/Kotlin parity.
  - Added `jsNum` serializer helper so whole numbers in `double` fields emit without trailing `.0` matching JavaScript `JSON.stringify`.
- **Open questions:** None.
- **Progress:**
  - Implemented all models in `lib/core/models/`.
  - Implemented URL normalization in `lib/core/algorithms/normalize.dart`.
  - All 39 unit tests in `test/core/models_test.dart` and `test/core/normalize_test.dart` passed 100%.
  - `flutter analyze` completed with 0 errors/warnings.
