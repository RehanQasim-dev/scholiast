# Task 03 — Work log

## [2026-08-19 10:05] agent-session-03
- **What I learned:**
  - `normalizeUrl` actually lives in `shared/url.ts` (not `highlighter.ts` — highlighter re-exports it from `url-utils.ts` → `shared/url.ts`). The canonical module is `shared/url.ts`, dependency-free, shared by extension + Obsidian plugin.
  - The TS `EPHEMERAL_PARAMS` set (19 params) is: `t`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `ref`, `ref_src`, `source`, `src`, `fbclid`, `gclid`, `dclid`, `msclkid`, `twclid`, `mc_cid`, `mc_eid`, `_ga`, `_gl`, `si`. **Not wildcard `utm_*`** — only the five named UTM params are stripped (a hypothetical `utm_foo` survives). **`start` is NOT stripped** — only `t`. Task prose says "t/start" and "utm_*"; per task instructions byte-compat with TS wins → port the exact set, log the difference.
  - `new URL()` semantics that matter: lowercased scheme+host, default port stripped, empty path → `/`, dot segments removed, fragment dropped, query re-serialized via `URLSearchParams` (x-www-form-urlencoded: space→`+`, everything except alnum `*-._~!'()` percent-encoded, `&`→`%26`), original param order preserved. Trailing slash on non-empty path KEPT (there's even a comment in shared/url.ts about this).
  - Video ID extraction in desktop repo: `youtube-detect.ts getVideoId()` = only `v` param from `location.search`, returns `''` not null. `yt-transcript-extractor.ts getVideoIdFromUrl()` = youtu.be → `pathname.slice(1)`; `/shorts/` → path segment; else `v` param, `''`. **No `embed/`/`live/` handling in TS** — task adds those; no 11-char validation anywhere in TS (lenient). `extractVideoId` is therefore a new app-level function: TS patterns + embed/live + null-for-non-YouTube (task spec).
  - Hash scheme (single source, `shared/merge.ts:371-377`): SHA-256 of the **normalized** URL string (UTF-8) → first **16 bytes** → lowercase hex (`b.toString(16).padStart(2,'0')`) → `page-<32hex>.json`. Drive path = `pages/` + that (folder is a separate concern in `google-drive.ts`; `pageFileName` itself returns no `pages/` prefix). sync-engine calls `pageFileName(normalizedUrl)` (page keys are already normalized).
- **Decisions made:**
  - `pageFileName(url)` returns exactly `page-<hex>.json` (TS byte-compat, per acceptance criterion "matches the TS output"), and a separate `pageFilePath(url)` = `pages/page-<hex>.json` covers the task's prose requirement. Both provided; Task 17 (Drive sync) should use `pageFilePath` for the Drive path.
  - `urlHash(url)` hashes the **normalized** URL (matches how sync-engine calls it).
  - Port uses `java.net.URI` + manual WHATWG-fidelity fixes (default-port strip, empty-path `/`, dot-segment normalize, query re-encode). Known residual divergence: WHATWG percent-encodes chars URI rejects (e.g. spaces in path) — URI throws → we return input unchanged, TS returns the encoded URL. Rare in practice (tab URLs); logged as open question.
  - Test file placed in `app/src/test/java/...` (canonical Gradle unit-test source set) rather than `app/src/main/...` the scope text literally lists — main-set can't hold JUnit tests. Package path matches the task (`data/normalize`).
  - No Gradle build exists yet (`android/` has only AGENTS.md + empty `src/main/java` dirs; Task 01 skeleton hasn't landed). Per instructions: write code + tests, verify hash fixtures independently with node, note build gap.
- **Open questions:**
  - Build gap: cannot run `./gradlew :app:testDebugUnitTest` until Task 01 lands.
  - WHATWG-vs-URI edge divergences above — decide in integration whether to add a fuller WHATWG parser.
- **Progress:**
  - Read all reference sources; confirmed exact TS behavior for all four functions.
  - Marked task.md IN PROGRESS; created `android/app/src/{main,test}/java/com/scholiast/android/data/normalize/` dirs.

## [2026-08-19 18:55] agent-session-03 (RESUME/FINISH)
- **What I learned:**
  - The TS `EPHEMERAL_PARAMS` set is **20 params, not 19** as I logged at 10:05 — the Kotlin port's set was already correct; only my comment said 19. Fixed the comment in `Normalize.kt` (20 params) and the test pins all 20. Verified by importing the real `shared/url.ts` in node (`--experimental-strip-types`).
  - Task 01's Gradle skeleton HAS landed since my earlier session (flavored module: `dev`/`prod`), so `./gradlew :app:testDebugUnitTest` is ambiguous — the real tasks are `:app:testDevDebugUnitTest` and `:app:testProdDebugUnitTest`.
  - The `:app:test*DebugUnitTest` build currently FAILS to compile on **Task 12's** `TranscriptClientTest.kt` (unresolved `mockwebserver`/`MockWebServer` — the `okhttp3.mockwebserver` test dep is missing from `app/build.gradle.kts`, which Task 01 owns). Not my file; left untouched per task ownership rules.
- **Decisions made:**
  - Verified fixtures with node against the REAL TS source (`shared/url.ts` normalizeUrl + `shared/merge.ts` hash scheme: SHA-256 of the normalized url → first 16 bytes → lowercase hex). All hard-coded hash/pageFileName values in `NormalizeTest.kt` come from that run, not from re-derivation.
  - Since the Gradle unit-test task is blocked by another task's file, I compiled `Normalize.kt` + `NormalizeTest.kt` standalone (kotlinc from `/tmp/opencode/t12/kotlinc`, JUnit 4.13.2 + hamcrest from the Gradle cache, JDK 17) and ran the suite on the JVM.
- **Open questions:**
  - Task 12 must add `testImplementation("com.squareup.okhttp3:mockwebserver:...")` (or Task 01 must) before `testDevDebugUnitTest`/`testProdDebugUnitTest` compiles — noted for the orchestrator; unrelated to this task's code.
- **Progress:**
  - Wrote `android/app/src/test/java/com/scholiast/android/data/normalize/NormalizeTest.kt` — 26 tests, all green (JVM run): the 20 EPHEMERAL_PARAMS each stripped (incl. bare `t`, percent-encoded `utm%5Fsource`), `t` stripped while `list=`/`si=`→kept list + `start` NOT stripped, unnamed `utm_foo` kept, fragment dropped, trailing slash kept, empty path → `/`, default ports dropped, dot segments resolved, URLSearchParams-style query re-encoding, unparseable input returned unchanged (incl. the documented raw-space divergence), all five videoId forms (`watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`, plus `m.youtube.com`), null for non-YouTube/invalid, and 18 node-verified `urlHash` fixtures + `pageFileName`/`pageFilePath` string checks (e.g. `https://example.com/article?x=1` → `page-bbeb724611106d499bfaeeae2808c1e8.json`, `...watch?v=..&list=PL123` → `page-459380db164cf39befe833994c12f996.json`).
  - Verified a second node batch (`utm%5Fsource=x` stripped, bare `t` stripped, `HTTPS://EXAMPLE.COM/` lowercased, `localhost:8080` kept) — all match the Kotlin port.
  - task.md → DONE. Divergence from task prose stands as logged at 10:05: `start` is NOT stripped, only the five named `utm_*` params — TS byte-compat wins.