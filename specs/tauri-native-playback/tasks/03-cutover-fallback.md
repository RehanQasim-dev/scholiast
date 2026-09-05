# Task 03 — Cutover + iframe fallback (batch 3)

Depends on 02 (native verified on desktop `tauri dev` smoke).

## Owned files

- `scholiast_tauri/src/routes/Player.tsx` (cutover wiring only)
- `scholiast_tauri/src/player/PlayerHost.tsx` (fallback mount only)
- `scholiast_tauri/src/player/Chrome.tsx` (shield retention for fallback)
- `scholiast_tauri/specs` docs (PRODUCT/TECH invariant audit)

## Steps

1. Default native on for VOD; route by content kind: upcoming → scheduled
   state (no player); live → HLS path; VOD → batch-2 engine.
2. Automatic fallback: extraction-failure classes (cipher rotation, unknown
   itag, network, DRM/paid/geo/login where iframe embeds still serve) mount
   the legacy iframe with shields intact; each fallback emits its failure
   class (log + triage event, no user-facing jargon beyond the honest
   message per PRODUCT 6).
3. Fresh-URL discipline: never persist stream URLs; expired-URL errors
   re-resolve transparently and resume at the last clock position.
4. Full gates: `pnpm vitest run` (whole suite), `pnpm typecheck`,
   Pre-CI Local Gates (host + 3 Android `cargo check`), `cargo clippy`,
   `cargo test`.
5. Audits: `check-impl-against-spec` (every PRODUCT invariant), `code-review`
   (standards + spec), then `write-pr-description`.
6. Manual matrix before merge: desktop deb (progressive/HD/captions/seek/
   capture/notes), Android (same + rotation/reload), fallback kill-switch
   (force extraction failure → iframe plays).

## LOG

- (append: audit outcomes, matrix results)
