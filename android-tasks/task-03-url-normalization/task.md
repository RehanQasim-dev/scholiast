# Task 03 — URL normalization, videoId extraction, urlHash

Status: DONE

## Objective
Port the desktop extension's URL handling so the app stores and references pages exactly the same way: same normalized URL, same SHA-256-prefix urlHash for Drive file names.

## Scope — files you OWN (in `../android/app/src/main/java/com/scholiast/android/`)
- `data/normalize/Normalize.kt` — `normalizeUrl(url): String`, `extractVideoId(url): String?`, `urlHash(url): String`, `pageFileName(url): String`
- Unit tests alongside: `data/normalize/NormalizeTest.kt`

## References (read first)
- `../scholiast_mobile_app_plan.md`: §4.4 (normalization + hash), §4.5 (Drive layout, `pages/page-<urlhash>.json`)
- Desktop sources to port: `../src/utils/highlighter.ts` (`normalizeUrl`), `../shared/merge.ts` (`pageFileName`), `../src/utils/video/youtube-detect.ts` (videoId extraction patterns)

## Requirements
- `normalizeUrl`: strip fragment; strip tracking params (`utm_*`, `fbclid`, `_ga`, and YouTube's `t`/`start`); keep everything else byte-identical to the TS implementation (port the logic, don't re-derive).
- `extractVideoId`: handle `watch?v=`, `youtu.be/`, `shorts/`, `embed/`, `live/`; return null for non-YouTube URLs.
- `urlHash`: SHA-256 of the normalized URL, first N hex chars — match the desktop repo's scheme exactly (check `shared/merge.ts`/`google-drive.ts` for the prefix length and case).
- `pageFileName(url) = "pages/page-<urlhash>.json"` — same string the TS computes.
- Pure functions, no Android deps, JVM-testable.

## Acceptance criteria
- Tests cover: URL with `utm_source` + `utm_medium` + `fbclid` + `_ga` stripped; URL with `?t=123` removed but `?list=` kept; youtu.be → videoId; shorts → videoId; invalid/non-YouTube → null; hash matches a fixture computed by the TS code (run the TS function via `node` against the repo's `dist` build or its test fixtures and hard-code the expected value).
- `pageFileName` matches the TS output for the same URL.

## Agent notes
- If you find the TS strips more or fewer params than the plan lists, port what the TS actually does and note the difference in LOG.md — byte-compat wins over the plan's prose.
- Write your log to `LOG.md` as you work.