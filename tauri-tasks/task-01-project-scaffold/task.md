# Task 01: Project Scaffold & Toolchain

Status: DONE
Wave: 0
Depends on: —

## Scope & Owned Files
Creates `scholiast_tauri/` from scratch:
- `package.json` / `pnpm-lock.yaml` — React 18 + TypeScript strict, Vite 5, react-router, TanStack Query v5, Tailwind v4, vitest + RTL, ESLint+prettier
- Tauri v2 app: `src-tauri/` (`tauri.conf.json` window 1280×800 dark, CSP default; identifier `app.scholiast.desktop`)
- Cargo **workspace**: `src-tauri` (bin) + `crates/core` (pure domain lib) + `crates/server` (empty axum stub)
- Frontend skeleton: `src/main.tsx`, `src/App.tsx` router shell with routes `/home /player /reader /settings`, persistent left sidebar (264px, dark), content outlet
- `src/styles/tokens.css` — full token set from plan §7.1 + Tailwind wiring
- `src-tauri/src/state.rs` stub with sqlx pool init (WAL, `scholiast.db` in app-data dir); empty `commands/mod.rs`
- `tauri-plugin-store` + `tauri-plugin-deep-link` registered
- Linux startup sets `WEBKIT_DISABLE_COMPOSITING_MODE=1` before webview creation (plan §8.2)
- `AGENTS.md` for the folder: conventions, commands, domain-ownership rules summary
- CI-ish gates wired: `pnpm lint`, `pnpm typecheck`, `pnpm vitest run`, `cargo clippy -D warnings`, `cargo test`

## Acceptance Criteria
- `pnpm tauri dev` boots a dark-shelled window on Linux; sidebar navigates between placeholder routes
- `cargo test && cargo clippy -D warnings` green from workspace root
- One smoke vitest renders the shell

## Notes
- Do NOT add feature screens — later tasks own them.
- Record exact dependency versions + any build env fixes in LOG.md (later agents depend on it).
