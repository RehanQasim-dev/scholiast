  Scholiast: Android Native to Flutter (Android & Linux Desktop) Migration Plan                                                               
  ──────                                                                                                                                       
  ## 1. Executive Architecture & Tech Stack Mapping                                                                                            
                                                                                                                                               
  This plan migrates the native Kotlin/Jetpack Compose Android app (com.scholiast.android) to a unified Flutter (Android + Linux Desktop)      
  codebase.                                                                                                                                    
                                                                                                                                               
    ┌─────────────────────────────────────────────────────────────────────────────┐                                                            
    │                       SCHOLIAST FLUTTER CLIENT                              │                                                            
    ├──────────────────────────────────────┬──────────────────────────────────────┤                                                            
    │           ANDROID MOBILE             │            LINUX DESKTOP             │                                                            
    │   (Touch, BottomSheets, Camera/Mic)  │  (Mouse/Keyboard, Sidebar, Window)   │                                                            
    ├──────────────────────────────────────┴──────────────────────────────────────┤                                                            
    │                         FLUTTER UI & DESIGN SYSTEM                          │                                                            
    │        Material 3 + Scholiast Theme Tokens (Reader, Player, Canvas, Notes)  │                                                            
    ├─────────────────────────────────────────────────────────────────────────────┤                                                            
    │                     STATE MANAGEMENT (Riverpod 2.x)                         │                                                            
    │       ReaderNotifier | PlayerNotifier | NotesNotifier | SyncNotifier        │                                                            
    ├──────────────────────────────────┬──────────────────────────────────────────┤                                                            
    │         MEDIA & NATIVE FFI       │            STORAGE & SYNC                │                                                            
    │  - whisper.cpp (Dart FFI / GGML) │  - Drift SQLite (scholiast.db v2)        │                                                            
    │  - Audio Recorder (record)       │  - Google Drive REST (OAuth PKCE)        │                                                            
    │  - WebKit/InAppWebView Bridge    │  - 3-Way Merge Engine (MergePageRecord)  │                                                            
    │  - YouTube IFrame Player         │  - flutter_secure_storage (Keyring/Secret)│                                                           
    ├──────────────────────────────────┴──────────────────────────────────────────┤                                                            
    │                      PURE DART DOMAIN LAYER (Zero UI)                       │                                                            
    │    Data Models (Freezed) | URL Normalizer | Fuzzy Text Anchor | Cue Parser  │                                                            
    └─────────────────────────────────────────────────────────────────────────────┘                                                            
                                                                                                                                               
  ### Technology Matrix (Native Android vs Flutter Target)                                                                                     
                                                                                                                                               
   Concern                  │ Native Android (android/app)                     │ Flutter (Android & Linux Desktop)
  ──────────────────────────┼──────────────────────────────────────────────────┼───────────────────────────────────────────────────────────────
   Language & SDK           │ Kotlin 2.0 / Java 17 / Android SDK 35            │ Dart 3.x / Flutter 3.47+
   UI Framework             │ Jetpack Compose + Compose Navigation             │ Flutter Widgets + go_router
   State Management         │ Android ViewModel + StateFlow                    │ flutter_riverpod (StateNotifier / AsyncNotifier)
   Persistence (DB)         │ Room + KSP (scholiast.db v2)                     │ Drift (sqlite3_flutter_libs + Linux sqlite3)
   Secure Key Storage       │ Android Keystore (EncryptedSharedPreferences)    │ flutter_secure_storage (Android Keystore / Linux libsecret)
   Local STT (Whisper)      │ C++ NDK GGML (src/main/cpp/)                     │ Dart FFI binding to libwhisper.so
   Web Article Engine       │ android.webkit.WebView + android-reader.js       │ flutter_inappwebview (WebKitGTK on Linux, WebKit on Android)
   Video Player             │ WebView hosting player.html (YouTube IFrame)     │ Unified Webview host + Javascript message handlers
   Background Sync          │ Android WorkManager (SyncWorker.kt)              │ workmanager (Android) + periodic Timer/Isolate daemon (Linux)
   Cloud Sync & OAuth       │ OkHttp + Google Drive REST API                   │ dio / http + oauth2 with PKCE & Loopback HTTP Server
   Canvas Drawing           │ Android android.graphics.Canvas / Compose Canvas │ Flutter CustomPainter + Gesture pointer events
  ──────                                                                                                                                       
  ## 2. Multi-Agent Division of Labor & Scheduling Protocol                                                                                    
                                                                                                                                               
  To eliminate merge conflicts, concurrency deadlocks, and broken compilations, work is partitioned into sequential phases with strictly       
  separated agent roles.                                                                                                                       
                                                                                                                                               
      [Agent 1: Core Domain] ───► Passes all unit tests                                                                                        
                │                                                                                                                              
                ▼                                                                                                                              
      [Agent 2: Storage & DB] ──► Passes DB migration & CRUD tests                                                                             
                │                                                                                                                              
                ▼                                                                                                                              
      [Agent 3: Sync & Cloud] ──► Passes 3-way merge golden tests & Drive mock                                                                 
                │                                                                                                                              
                ▼                                                                                                                              
      [Agent 4: FFI & Native] ──► Builds libwhisper.so & WebView bridge                                                                        
                │                                                                                                                              
                ▼                                                                                                                              
      [Agent 5: UI & Screens] ──► Compiles Android APK + Linux Desktop binary                                                                  
                                                                                                                                               
  ### Agent Roles & Guardrails                                                                                                                 
                                                                                                                                               
   Agent                          │ Scope                             │ Files Owned                       │ Quality Gate
  ────────────────────────────────┼───────────────────────────────────┼───────────────────────────────────┼────────────────────────────────────
   Agent 1 (Domain & Models)      │ Pure Dart data structures,        │ lib/core/models/,                 │ 100% test coverage; 0 UI imports
                                  │ algorithms, parsers               │ lib/core/algorithms/,             │
                                  │                                   │ test/domain/                      │
   Agent 2 (Persistence & Auth)   │ Drift DB, DAOs, Migrations,       │ lib/core/database/,               │ Schema parity test against Room v2
                                  │ Keyring token store               │ lib/core/auth/, test/database/    │ fixtures
   Agent 3 (Sync & External APIs) │ Google Drive API, 3-Way merge     │ lib/services/sync/,               │ Byte-for-byte golden fixture match
                                  │ engine, YouTube cues              │ lib/services/youtube/, test/sync/ │ with TS/Kotlin
   Agent 4 (Native FFI & Media)   │ Whisper GGML C++ bindings, Audio  │ lib/native/whisper/,              │ FFI memory leak check, mock audio
                                  │ recorder, WebViews                │ lib/services/audio/,              │ input
                                  │                                   │ lib/widgets/webview/              │
   Agent 5 (Presentation & UI)    │ Riverpod states, Compose-to-      │ lib/presentation/, lib/theme/,    │ flutter analyze 0 warnings,
                                  │ Widget screens, Linux chrome      │ test/widget/                      │ responsive on both platforms
  ──────                                                                                                                                       
  ## 3. Comprehensive Step-by-Step Implementation Roadmap                                                                                      
  ──────                                                                                                                                       
  ### Phase 0: Flutter Workspace & Native Toolchain Setup                                                                                      
                                                                                                                                               
  • Goal: Establish the cross-platform Flutter project scaffold targeting Linux and Android.                                                   
                                                                                                                                               
  1. Scaffold Directory:                                                                                                                       
      • Create scholiast_flutter/ alongside the existing root.                                                                                 
      • Target platforms: flutter create --platforms=android,linux --org com.scholiast.app scholiast_flutter.                                  
  2. Dependencies (pubspec.yaml):                                                                                                              
      • State & Architecture: flutter_riverpod, riverpod_annotation, freezed_annotation, json_annotation, go_router.                           
      • Persistence: drift, sqlite3_flutter_libs, path_provider, flutter_secure_storage, shared_preferences.                                   
      • Networking & Sync: dio, http, crypto, uuid.                                                                                            
      • Web & Media: flutter_inappwebview, record, audioplayers, file_picker.                                                                  
      • Dev Tools: build_runner, freezed, json_serializable, drift_dev, riverpod_generator, lints.                                             
  3. Linux Prerequisites:                                                                                                                      
      • Verify GTK 3 development headers (libgtk-3-dev, libsecret-1-dev, pkg-config).                                                          
                                                                                                                                               
  ──────                                                                                                                                       
  ### Phase 1: Pure Domain Layer (100% Platform-Independent Dart)                                                                              
                                                                                                                                               
  • Goal: Port all domain models and pure algorithmic logic with zero UI/Android dependencies.                                                 
                                                                                                                                               
  1. URL Normalization:                                                                                                                        
      • Port Normalize.kt to lib/core/algorithms/normalize.dart.                                                                               
      • Implement SHA-256 urlHash(url) and tracking parameter stripping (utm_*, fbclid, etc.).                                                 
  2. Data Models (Freezed):                                                                                                                    
      • PageRecord.kt / PageRecord.kt → PageRecord with PageTombstones.                                                                        
      • PageHighlight.kt → PageHighlight with extra index signature preservation.                                                              
      • VideoItem.kt & VideoMarkup.kt → Normalized coordinate points (0.0..1.0).                                                               
      • LinearArticle.kt → Extracted article text & block nodes.                                                                               
  3. Cross-Surface Anchoring & Fuzzy Matcher:                                                                                                  
      • Port AnchorKt.kt to lib/core/algorithms/anchor.dart.                                                                                   
      • 3-Tier resolution: Exact indexOf → Whitespace-insensitive → Banded dynamic programming edit-distance (approxMatch).                    
      • Sentence boundary scan + range hygiene (trimRange, mergeOverlappingRanges).                                                            
  4. YouTube Caption Parser & Chunker:                                                                                                         
      • Port CueParser.kt and TranscriptChunker.kt to lib/core/algorithms/transcript_parser.dart.                                              
  5. 3-Way Reconciliation Engine:                                                                                                              
      • Port MergePageRecord.kt to lib/core/algorithms/merge_page_record.dart.                                                                 
      • Reconcile base, local, and remote records with tombstone retention (30 days).                                                          
  6. Testing Gate:                                                                                                                             
      • Port all unit test fixtures from android/app/src/test/java/... to test/core/.                                                          
      • Run dart test → must pass 100%.                                                                                                        
                                                                                                                                               
  ──────                                                                                                                                       
  ### Phase 2: Persistence & Local Storage Layer                                                                                               
                                                                                                                                               
  • Goal: Implement cross-platform Drift SQLite and secure token storage.                                                                      
                                                                                                                                               
  1. Drift Schema (lib/core/database/database.dart):                                                                                           
      • Match Room schema v2:                                                                                                                  
          • video_pages (urlHash PK, url, videoId, title, itemsJson, updatedAt, snapJson, fileId, headRevisionId, highlightsJson, readerJson). 
          • sync_meta (key PK, value, updatedAt).                                                                                              
          • ocr_texts (frameId PK, text, updatedAt).                                                                                           
                                                                                                                                               
  2. DAOs & Repositories:                                                                                                                      
      • VideoPageDao: getPage(urlHash), upsertPage(), getAllPages(), deletePage().                                                             
      • SyncMetaDao: getMeta(key), setMeta(key, value).                                                                                        
      • PageHighlightRepository & VideoItemRepository: Reactive Dart streams (watchHighlights(url), watchVideoItems(url)).                     
  3. Secure Auth Store:                                                                                                                        
      • Wrap flutter_secure_storage for storing Google OAuth tokens:                                                                           
          • Android: Hardware-backed Android Keystore.                                                                                         
          • Linux: Linux Secret Service (libsecret).                                                                                           
                                                                                                                                               
                                                                                                                                               
  ──────                                                                                                                                       
  ### Phase 3: Cloud Sync & External Services                                                                                                  
                                                                                                                                               
  • Goal: Implement Google Drive AppData sync and content extraction.                                                                          
                                                                                                                                               
  1. Google Drive REST Client:                                                                                                                 
      • Port DriveApi.kt to lib/services/sync/drive_api.dart.                                                                                  
      • Implement AppData folder operations: pages/page-<urlhash>.json, frames/frame-<id>.jpg.                                                 
      • Support Content-Addressable Storage (CAS) with headRevisionId and If-Match headers.                                                    
  2. OAuth 2.0 PKCE Flow:                                                                                                                      
      • On Android: Custom Tabs / InAppBrowser redirect loop.                                                                                  
      • On Linux: Open system default browser with local loopback server (http://127.0.0.1:<port>/oauth2callback).                             
  3. Sync Engine Orchestrator:                                                                                                                 
      • Port SyncEngine.kt & SyncScheduler.kt.                                                                                                 
      • Dirty queue management, exponential backoff, background periodic synchronization.                                                      
  4. Article Extractor:                                                                                                                        
      • Port Extractor.kt & Linearizer.kt using Dart html parser.                                                                              
                                                                                                                                               
  ──────                                                                                                                                       
  ### Phase 4: Media, Audio & Native FFI Engines                                                                                               
                                                                                                                                               
  • Goal: Build Whisper STT bindings, audio recording, and WebView JavaScript bridges.                                                         
                                                                                                                                               
  1. Whisper C++ GGML (Dart FFI):                                                                                                              
      • Compile src/main/cpp/ggml/ as dynamic shared libraries:                                                                                
          • Android: libwhisper.so (arm64-v8a, x86_64).                                                                                        
          • Linux Desktop: libwhisper.so (x86_64 ELF).                                                                                         
      • Expose C bindings via dart:ffi: whisper_init_from_file, whisper_full, whisper_full_get_segment_text.                                   
      • Implement WhisperEngine in Dart running inside a background Isolate.                                                                   
  2. Cloud Transcription Fallbacks:                                                                                                            
      • Port Gemini, Groq, and FUTO STT endpoints ().                                                                                          
  3. Audio Recorder:                                                                                                                           
      • Integrate record package for streaming 16kHz mono WAV audio on both Android and Linux.                                                 
  4. WebView In-Page Bridges:                                                                                                                  
      • Reader: Bundle android-reader.js and inject into InAppWebView. Register JavaScript handlers for onHighlightCreated, onHighlightUpdated,
      onSelectionState.                                                                                                                        
      • YouTube Player: Host player.html with two-way message passing for video state, playback time, and frame capture requests.              
                                                                                                                                               
  ──────                                                                                                                                       
  ### Phase 5: State Management (Riverpod)                                                                                                     
                                                                                                                                               
  • Goal: Replace Android ViewModels with reactive Riverpod providers.                                                                         
                                                                                                                                               
  1. ReaderNotifier: Manages article extraction, active highlights, selection rects, font size/serif preferences.                              
  2. PlayerNotifier: Manages YouTube playback state, currentTime, active transcript cue index.                                                 
  3. NotesNotifier: Manages threaded notes, inline comment edits, tag index updates.                                                           
  4. SyncNotifier: Manages connection state, last-synced timestamp, sync progress, manual trigger.                                             
  5. FrameCaptureNotifier: Manages video screenshot blob, active tool (pen, highlight, eraser), undo/redo stroke stack.                        
  ──────                                                                                                                                       
  ### Phase 6: UI Design System & Component Library                                                                                            
                                                                                                                                               
  • Goal: Translate Jetpack Compose theme and design tokens into Flutter widgets.                                                              
                                                                                                                                               
  1. Theme Tokens:                                                                                                                             
      • Port Color.kt, Theme.kt, Shape.kt to lib/theme/.                                                                                       
      • Support Dark/Light modes with high-contrast highlight colors (#FDE047, #FCA5A5, #86EFAC).                                              
  2. Reusable Components:                                                                                                                      
      • SyncStatusBar: Pill indicator for idle, syncing, error, and offline states.                                                            
      • CommentEditorField: Markdown-aware text editor with #tag suggestion overlay and voice recording slot.                                  
      • ColorSwatchBar: Floating highlight recoloring popup.                                                                                   
      • VoiceBubble: Recording waveform and real-time transcription preview.                                                                   
                                                                                                                                               
  ──────                                                                                                                                       
  ### Phase 7: Screens & Feature Modules                                                                                                       
                                                                                                                                               
  #### 1. Home / Library Screen                                                                                                                
                                                                                                                                               
  • Port HomeScreen.kt.                                                                                                                        
  • Recent article list + annotated YouTube videos + sync status bar.                                                                          
  • Responsive: Single-column list on Android; Multi-column card grid on Linux Desktop.                                                        
                                                                                                                                               
  #### 2. Reader Screen                                                                                                                        
                                                                                                                                               
  • Port ReaderScreen.kt.                                                                                                                      
  • InAppWebView rendering extracted readability HTML + android-reader.js.                                                                     
  • Floating action bar over text selection → Highlight / Note / Voice note.                                                                   
  • Side thread drawer on desktop; Bottom sheet on mobile.                                                                                     
                                                                                                                                               
  #### 3. YouTube Player & Transcript Screen                                                                                                   
                                                                                                                                               
  • Port PlayerScreen.kt.                                                                                                                      
  • Split layout: Video player on top (mobile) or left (desktop) + synchronized transcript & notes on right/bottom.                            
  • Cue click → seek video; Video progress → auto-scroll active cue.                                                                           
                                                                                                                                               
  #### 4. Frame Markup Screen                                                                                                                  
                                                                                                                                               
  • Port FrameDrawScreen.kt and MarkupView.kt.                                                                                                 
  • Flutter CustomPainter with normalized coordinates (x/w,y/h).                                                                               
  • Pen, highlighter, text labels, undo/redo stack, and frame JPEG export.                                                                     
                                                                                                                                               
  #### 5. Settings Screen                                                                                                                      
                                                                                                                                               
  • Port SettingsScreen.kt.                                                                                                                    
  • Google Drive connect/disconnect, Whisper model download manager, STT engine picker (Local vs Cloud).                                       
  ──────                                                                                                                                       
  ### Phase 8: Linux Desktop Adaptation & Integration                                                                                          
                                                                                                                                               
  • Goal: Optimize for Linux desktop environment (mouse, keyboard, windowing).                                                                 
                                                                                                                                               
  1. Window Sizing & Min Dimensions:                                                                                                           
      • Integrate window_manager to set minimum window size (800x600) and remember previous window geometry.                                   
  2. Keyboard Shortcuts (LogicalKeySet):                                                                                                       
      • Ctrl+H: Toggle highlighter mode.                                                                                                       
      • Ctrl+N: New note.                                                                                                                      
      • Space: Play/pause video.                                                                                                               
      • J / K: Seek -5s / +5s.                                                                                                                 
      • Esc: Close drawers/modals.                                                                                                             
  3. Adaptive Layouts:                                                                                                                         
      • Replace bottom navigation with a collapsible desktop sidebar (NavigationRail).                                                         
      • Multi-pane split views (Expanded / Flex) taking advantage of wide desktop monitors.                                                    
                                                                                                                                               
  ──────                                                                                                                                       
  ## 4. Complete Code & Module Mapping Reference                                                                                               
                                                                                                                                               
   Kotlin Source Path                           │ Proposed Flutter (Dart) Target Path            │ Layer
  ──────────────────────────────────────────────┼────────────────────────────────────────────────┼─────────────────────────────────────────────
   data/model/PageRecord.kt                     │ lib/core/models/page_record.dart               │ Pure Domain
   data/model/PageHighlight.kt                  │ lib/core/models/page_highlight.dart            │ Pure Domain
   data/model/VideoItem.kt                      │ lib/core/models/video_item.dart                │ Pure Domain
   data/model/LinearArticle.kt                  │ lib/core/models/linear_article.dart            │ Pure Domain
   data/normalize/Normalize.kt                  │ lib/core/algorithms/normalize.dart             │ Pure Domain
   domain/reader/AnchorKt.kt                    │ lib/core/algorithms/anchor.dart                │ Pure Domain
   domain/sync/merge/MergePageRecord.kt         │ lib/core/algorithms/merge_page_record.dart     │ Pure Domain
   domain/transcript/CueParser.kt               │ lib/core/algorithms/cue_parser.dart            │ Pure Domain
   data/db/AppDatabase.kt                       │ lib/core/database/app_database.dart            │ Persistence
   data/db/VideoPageDao.kt                      │ lib/core/database/daos/video_page_dao.dart     │ Persistence
   data/db/SyncMetaDao.kt                       │ lib/core/database/daos/sync_meta_dao.dart      │ Persistence
   domain/sync/drive/DriveApi.kt                │ lib/services/sync/drive_api.dart               │ Network & Sync
   domain/sync/drive/DriveOAuth.kt              │ lib/services/auth/oauth_service.dart           │ Network & Sync
   domain/sync/SyncEngine.kt                    │ lib/services/sync/sync_engine.dart             │ Network & Sync
   domain/reader/Extractor.kt                   │ lib/services/reader/extractor.dart             │ Network & Sync
   domain/voice/local/WhisperGGML.kt            │ lib/native/whisper/whisper_ffi.dart            │ Native / FFI
   ui/reader/ReaderViewModel.kt                 │ lib/presentation/reader/reader_controller.dart │ State (Riverpod)
   player/PlayerViewModel.kt                    │ lib/presentation/player/player_controller.dart │ State (Riverpod)
   ui/reader/ReaderScreen.kt                    │ lib/presentation/reader/reader_screen.dart     │ Presentation
   ui/player/PlayerScreen.kt                    │ lib/presentation/player/player_screen.dart     │ Presentation
   ui/frame/FrameDrawScreen.kt                  │ lib/presentation/frame/frame_draw_screen.dart  │ Presentation
   ui/frame/MarkupView.kt                       │ lib/presentation/frame/markup_painter.dart     │ Presentation
   ui/home/HomeScreen.kt                        │ lib/presentation/home/home_screen.dart         │ Presentation
   ui/settings/SettingsScreen.kt                │ lib/presentation/settings/settings_screen.dart │ Presentation
  ──────
  ## 5. Verification & Quality Gates
  
  Every milestone must pass these automated verification checks:
  
  1. Static Analysis: flutter analyze → 0 issues found.
  2. Domain Unit Tests: flutter test test/core/ → 100% pass (testing 3-way merge, URL normalization, fuzzy quote anchoring against TypeScript  
  golden fixtures).
  3. Database Migration Test: Drift migration test verifying schema parity with Room scholiast.db v2.
  4. Android Build: ./gradlew assembleDevDebug / flutter build apk --debug.
  5. Linux Build: flutter build linux --debug verified on Ubuntu.
  ──────

