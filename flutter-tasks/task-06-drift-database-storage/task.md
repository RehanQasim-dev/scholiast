# Task 06: Drift/SQLite Database & Keyring Storage

Status: DONE
Wave: 1
Depends on: task-02-core-domain-models

## Scope & Owned Files
- `scholiast_flutter/lib/core/database/database.dart` (`AppDatabase` schema v2, `ensureSqliteInitialized`)
- `scholiast_flutter/lib/core/database/entities/video_page_entity.dart` (`VideoPageEntity`)
- `scholiast_flutter/lib/core/database/entities/sync_meta_entity.dart` (`SyncMetaEntity`)
- `scholiast_flutter/lib/core/database/entities/ocr_text_entity.dart` (`OcrTextEntity`)
- `scholiast_flutter/lib/core/database/daos/video_page_dao.dart` (`VideoPageDao` with reactive streams)
- `scholiast_flutter/lib/core/database/daos/sync_meta_dao.dart` (`SyncMetaDao` with reactive streams)
- `scholiast_flutter/lib/core/database/daos/ocr_text_dao.dart` (`OcrTextDao` with reactive streams)
- `scholiast_flutter/lib/core/auth/secure_token_store.dart` (`SecureTokenStore`, `DriveTokens`)
- `scholiast_flutter/test/core/database_test.dart`

## Acceptance Criteria
- Full CRUD operations and reactive Streams on `VideoPages`, `SyncMeta`, and `OcrTexts`.
- In-memory database support for unit testing.
- `SecureTokenStore` backing OAuth tokens and API keys across Android Keystore and Linux Keyring.
- `flutter test` and `flutter analyze` pass with 0 errors/warnings.
