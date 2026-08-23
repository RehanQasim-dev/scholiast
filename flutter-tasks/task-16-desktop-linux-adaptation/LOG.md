# Task 16 Work Log

## [2026-08-22 23:52] Task 16 Agent — Linux Desktop Adaptation (start)
- **What I learned:**
  - Wave-4 screens are done and committed: ReaderScreen (NativeArticleView + WebView + thread sheet), PlayerScreen (landscape split with 320dp min panel, 0.38 share clamped), FrameDrawScreen (MarkupSession undo/redo, MarkupMath), HomeScreen (900px grid), SettingsScreen (capped 600dp). All wired through Riverpod families keyed by normalized URL.
  - AppColors tokens: background #0B0D14, accentPurple #8B7CF6, hairline #232733, surfaceElevated #151822. ScholiastTheme.darkTheme is the canonical ThemeData.
  - main.dart is still Flutter default counter template — NOT to be edited; router wiring must be documented for final integration.
  - No ui/navigation folder exists yet; go_router 14.8.1 is in pubspec. No window_manager dependency — must implement window hooks as pure Dart config without native plugin.
- **Decisions made:**
  - File ownership: lib/ui/layout/{desktop_breakpoints,responsive,desktop_sidebar,desktop_scaffold,wide_layout,keyboard_shortcuts}, lib/ui/screens/desktop/{desktop_shell,desktop_routes}, lib/core/platform/window_config, test/ui/desktop_layout_test.dart. No edits outside.
- **Open questions:**
  - Whether to add window_manager pub dependency now or keep window hooks pure-Dart (will keep pure-Dart to avoid native channel in tests).
- **Progress:**
  - Created task.md IN PROGRESS, scaffolded layout/platform/desktop directories.

## [2026-08-23 02:09] WebView-platform agent — Option A: flutter_inappwebview 6.2.x-beta + Linux (WPE) adoption spike
- **What I learned:**
  - System libs: `libwebkit2gtk-4.1` installed; NO WPE WebKit packages (`wpewebkit`, `wpe-platform-2.0`, `wpebackend-fdo`) present. `libgtk-3-dev` headers MISSING (only runtime `libgtk-3-0t64`). Did NOT sudo-install anything.
  - pub.dev versions: `flutter_inappwebview` latest stable 6.1.5, prerelease **6.2.0-beta.3**; endorsed **flutter_inappwebview_linux 0.1.0-beta.1** (WPE WebKit, unverified publisher), platform_interface 1.4.0-beta.3. Min Dart ^3.8.0 / Flutter >=3.32.0 — our Flutter 3.47.1 OK.
  - Changelog 6.2.0-beta.1→.3: NO breaking changes to addJavaScriptHandler / evaluateJavascript / initialFile / InAppWebViewSettings signatures used by us. "Linux: Initial implementation" is the only relevant line.
  - Feature parity (pub-cache source inspection of flutter_inappwebview_linux-0.1.0-beta.1):
    - Dart `addJavaScriptHandler/removeJavaScriptHandler/hasJavaScriptHandler`: IMPLEMENTED (in-memory `_javaScriptHandlersMap`; onCallJsHandler path dispatches + jsonEncodes return value).
    - Native JS bridge injected via user script (`plugin_scripts_js/javascript_bridge_js.h`) wiring `window.flutter_inappwebview.callHandler` → WPE `webkit_user_content_manager` script message handler `"callHandler"` WITH reply (`setScriptMessageWithReplyHandler`). JS→Dart contract intact, including return values.
    - `evaluateJavascript`: implemented natively (in_app_webview.cc:1894); result JSON-decoded on Dart side. `getArticleText` pattern (returns string) should work.
    - `loadData`: implemented (native loadData, in_app_webview.cc:1538). `initialFile`: implemented → native `loadFile` resolves relative to executable dir (in_app_webview.cc:299/1554). `loadUrl`: implemented.
    - `onLoadStop`: fires on WEBKIT_LOAD_FINISHED (load-changed signal) — the evaluateJavascript-until-onLoadStop queue pattern works.
    - `onConsoleMessage`: supported natively (console-message signal).
    - Settings: ONLY `javaScriptEnabled` honored natively (grep found just jsEnabled reads). `transparentBackground`, `mediaPlaybackRequiresUserGesture`, `allowFileAccessFromFileURLs`, `allowUniversalAccessFromFileURLs`, `mixedContentMode`, `supportZoom`, `domStorageEnabled` are ACCEPTED-BUT-IGNORED on Linux. ⚠️ player.html relies on file:// XHR to youtube.com (universal access) and autoplay-without-gesture — both must be re-verified live on a real WPE build.
    - PrintJobController not supported on Linux (null paths in controller).
  - flutter analyze baseline check: 6.1.5 also produced the same 10 errors (strict-inference on untyped `(args)` handler callbacks) — the upgrade introduced ZERO new analyzer issues.
- **Decisions made:**
  - pubspec.yaml: `flutter_inappwebview: ^6.1.5` → `^6.2.0-beta` + added `flutter_inappwebview_linux: ^0.1.0-beta`. Resolved: 6.2.0-beta.3 / 0.1.0-beta.1 / platform_interface 1.4.0-beta.3. Linux package stays explicit even though endorsed (documents intent).
  - Minimal fixes (owned files only): typed all `addJavaScriptHandler` callbacks as `(List<dynamic> args)` per documented JavaScriptHandlerCallback signature — player_web_view.dart (1 site), reader_web_view_host.dart (7 sites). Analyzer errors 10→0, total issues 54→37. No API migration changes were required by 6.2 itself.
  - Spike strategy: real WPE view can't run headless in `flutter test` (no GTK main loop/DMA-BUF) → tests verify (a) bridge CONTRACT statically (every callHandler name in assets/player.html + android-reader.js matches registered handlers) and (b) graceful degradation under TargetPlatform.linux (ReaderWebViewHost fake path renders placeholder; PlayerScreen controllerOverride path never builds a WebView).
- **Progress:**
  - test/ui/webview_linux_spike_test.dart created: 5 tests, ALL PASS.
  - Targeted suites green: player_screen_test.dart + reader_screen_test.dart + webview_linux_spike_test.dart = 20 passed.
  - flutter analyze: 0 errors (37 pre-existing infos/warnings outside my files).
  - `flutter build linux --debug`: FAILS at CMake configure — `gtk+-3.0` pkg-config not found (needs libgtk-3-dev), and would next fail on missing WPE deps. Plugin requires dev packages: libgtk-3-dev, libepoxy-dev, libwpewebkit-1.0-dev (+ wpebackend-fdo or wpe-platform-headless). NOT installed here; needs sudo approval.
- **Open questions:**
  - Approval to run: `sudo apt install libgtk-3-dev libepoxy-dev libwpewebkit-1.0-dev wpebackend-fdo` (or newer wpe-platform packages) to complete the link verification of Option A.
  - Even after WPE builds: settings ignored on Linux mean player autoplay/file-XHR behavior needs a LIVE smoke test before declaring the player bridge done.
- **Verdict:** Option A is GO from a code/API standpoint (one codebase, zero breaking API changes, full JS-bridge parity on Linux for everything we use except ignored settings). Conditional GO overall pending (1) system dev-package install + successful `flutter build linux --debug`, (2) live WPE smoke test of capture/autoplay.
