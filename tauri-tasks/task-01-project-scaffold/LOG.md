# Task 01 — Log

## [2026-08-23 19:38] ox-alpha-s1
- **What I learned:** `pkg-config --exists webkit2gtk-4.1` → OK (deps present). The agent playbook §8 lives in `android/AGENTS.md` (mirrored in `scholiast_flutter/AGENTS.md`): report progress every response, minimal tests only, file ownership is sacred, log environment fixes for later agents.
- **Decisions made:** Scaffold layout follows plan §3.5 exactly. Cargo workspace root at `scholiast_tauri/Cargo.toml` with members `src-tauri`, `crates/core`, `crates/server`. Bundle target for gate 6 limited to `deb` (proves compile + bundling; avoids AppImage's linuxdeploy network fetch). Icons generated from repo `src/icons/logo.svg` via `pnpm tauri icon`. Frontend router: HashRouter (bulletproof on custom webview protocols; deep-link query parsing unaffected).
- **Open questions:** none.
- **Progress:** Setup verified; task.md → IN PROGRESS; this LOG created. Next: package.json + tsconfig/vite/eslint configs, then `pnpm install`.

## [2026-08-23 20:17] ox-alpha-s1
- **What I learned:** (1) pnpm 11 removed `onlyBuiltDependencies` — build-script allowlists live under `allowBuilds:` in `pnpm-workspace.yaml`; package.json `pnpm` field is ignored. (2) Vite walks up the directory tree for postcss configs and picked up the parent repo's Tailwind v3 `postcss.config.js`, breaking our v4 CSS — fixed with inline `css: { postcss: {} }` in vite.config.ts; vitest did NOT catch it because it stubs CSS, only the real vite build did. (3) axum 0.8 handlers must be `async`. (4) `cargo clippy -D warnings` must be written `cargo clippy -- -D warnings`.
- **Decisions made:** HashRouter (custom-protocol-proof); deb-only bundle target for gate 6; `app_health` probes the pool (`SELECT 1`) and returns `Result<Health,String>` so `AppState.pool` is genuinely read (no dead_code allow needed) while keeping the `{ok:true}` shape; commands/mod.rs left empty per task.md; capabilities/default.json grants `core:default`; window `backgroundColor #000000` in tauri.conf.
- **Open questions:** none.
- **Progress:** ALL GATES PASS.
  - Gate 1 `pnpm lint` → clean (eslint .)
  - Gate 2 `pnpm typecheck` → clean (tsc --noEmit)
  - Gate 3 `pnpm vitest run` → Test Files 1 passed (1), Tests 1 passed (1)
  - Gate 4 `cargo clippy --workspace --all-targets -- -D warnings` → Finished, zero warnings
  - Gate 5 `cargo test --workspace` → 8 suites, all `test result: ok` (0 tests — scaffold)
  - Gate 6 `pnpm tauri build --debug` → bundle at `target/debug/bundle/deb/Scholiast_0.1.0_amd64.deb`
  Locked versions (pnpm-lock.yaml / Cargo.lock): react 18.3.1, react-router-dom 6.30.6, @tanstack/react-query 5.101.4, tailwindcss 4.3.3 + @tailwindcss/vite 4.3.3, vite 5.4.21, vitest 2.1.9, typescript 5.7.3, eslint 9.39.5, typescript-eslint 8.67.0, jsdom 25.0.1, @testing-library/react 16.3.2 + jest-dom 6.10.0, @tauri-apps/api 2.11.1, @tauri-apps/cli 2.11.4; Rust: tauri 2.11.5, wry 0.55.1, tauri-plugin-store 2.4.4, tauri-plugin-deep-link 2.4.9, tauri-plugin-opener 2.5.4, sqlx 0.8.6, tokio 1.53.1, serde 1.0.229, axum 0.8.9. Icons generated from repo `src/icons/logo.svg` via `pnpm tauri icon`. Env fixes carried forward: pnpm `allowBuilds: esbuild`, vite `css.postcss: {}`, WEBKIT_DISABLE_COMPOSITING_MODE set in lib.rs before webview creation.

## [2026-08-23 20:55] orchestrator-integration-wave1
- **What I learned:** Wave-1 agents left lib.rs wiring deferred by design. Integrated: `mod stt; mod transcript;` + handler registration for voice_*, fetch_transcript, and cfg-gated stt_local_*/list/download models.
- **Decisions made:** `fetch_transcript` now resolves its cache dir from AppHandle (app_data/transcripts) instead of taking cache_dir from JS. `set_resume_at` takes plain `url` (hashes server-side via core::normalize) matching upsert_video convention; Player.tsx sends `{url, resumeAt}`. `with_player_endpoint` marked #[cfg(test)]. Dead-code allows added on model-install pipeline fns pending real callers (task-10/19).
- **Open questions:** STT partial events still log-only; wire real `stt://partial` emit when consumer UI lands (task-10).
- **Progress:** Workspace gates re-run post-integration: clippy -D warnings clean; cargo test 57 passed / 0 failed (23 with local-stt); pnpm lint/typecheck/vitest 17/17.
