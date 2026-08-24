# AGENTS.md — scholiast_tauri

Conventions and hard rules for every agent working in `scholiast_tauri/`. The plan
(`../scholiast_tauri_app_plan.md`) is the authority; the task board (`../tauri-tasks/`)
assigns work. Log per-task progress in your `tauri-tasks/<task>/LOG.md`.

## Domain ownership — the No-Overlap Rule (plan §3.2, binding)

React owns **ephemeral UI state only**: playback position/state, transcript active-cue index,
open menus/sheets, selection rectangles, Excalidraw in-progress scenes, form drafts.

Rust owns **all persistent state**: SQLite rows, image/model/temp files, tokens, the sync
scheduler. React never holds arrays of saved notes/videos in component state — it renders
whatever TanStack Query fetched, invalidated by Rust events.

Violations to watch for (call them out in reviews):

- Keeping `items[]` in a React reducer after mutation instead of invalidating the query.
- Writing prefs from Rust without emitting the store-change event (or vice versa).
- Passing whole page records around in React context "for convenience".

## File ownership

Each task's `task.md` lists its owned files. **Do not edit files owned by another task** —
if integration into a shared file (e.g. this scaffold's `lib.rs`, `tokens.css`, root Cargo
manifests) is needed, note it in your LOG.md and let the orchestrator/integration task do it.
Feature screens live under `src/routes/`, `src/player/`, `src/reader/`, `src/frame/`,
`src/voice/`, `src/components/`; domain logic under `crates/core/src/` (pure), commands under
`src-tauri/src/commands/`.

## Commands (run from `scholiast_tauri/`)

| Command | Purpose |
|---|---|
| `pnpm dev` | Vite dev server (port 1420, strict) |
| `pnpm tauri dev` | Full desktop app in dev mode |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm vitest run` | Frontend tests |
| `cargo clippy -- -D warnings` | Rust lint gate (workspace root) |
| `cargo test` | Rust tests (workspace root) |
| `pnpm tauri build --debug` | Bundle (deb target on Linux) |

Per-task gates: frontend tasks run lint + typecheck + vitest; Rust/domain tasks run clippy +
test; integration tasks also smoke-boot `pnpm tauri dev`.

## Environment notes

- Linux needs `libwebkit2gtk-4.1-dev`, `libgtk-3-dev` to compile.
- `WEBKIT_DISABLE_COMPOSITING_MODE=1` is set programmatically in `src-tauri/src/lib.rs`
  before any webview/window creation — keep it there.
- pnpm 11: build-script allowlist lives in `pnpm-workspace.yaml` under `allowBuilds`
  (esbuild is already allowed). `.npmrc` is auth/registry only.

## Style

- TypeScript strict, no unused vars; Tailwind v4 utilities over the token variables in
  `src/styles/tokens.css` (never hardcode hex values that a token already covers).
- No code comments unless essential; match surrounding style.
- Minimal tests only — the most necessary ones, no test-suite growth for its own sake.
- Never commit secrets (`*.local.json` is gitignored); OAuth client values stay out of git.
- IPC contract style (plan §3.3): `snake_case` Rust commands, camelCase TS wrappers, every
  command returns `Result<T, ScholiastError>` serialized as `{ ok, data | error }`.
