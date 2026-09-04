# Task 32: Reader Integration & Verification

Status: DONE
Wave: 10
Depends on: task-30, task-31

## Scope & Owned Files
- End-to-end integration pass over the Reader feature:
  - full loop: add URL → extract → read → highlight (3 colors) → comment by voice + keyboard → reply → recolor → delete-with-undo → sync to Drive → verify in **desktop extension dashboard** (pull via its Drive client) → re-merge back into the app without loss
  - deep-link entry, restart persistence, offline capture→annotate→later-sync scenario
- Motion/a11y audit: focus rings, reduced-motion, aria labels on rail/panels; fix findings
- Performance sanity: 300-highlight article repaint < frame budget (log numbers)
- Final builds: `pnpm tauri build` Linux bundle smoke + Flatpak manifest validation (`flatpak-builder --run` shell test)
- Update `../tauri-tasks/README.md` verification summary + set statuses

## Acceptance Criteria
- Checklist above fully logged with evidence in LOG.md
- No regressions in video-side suites (`cargo test`, `vitest` all green)

## Notes
Cross-client verification is THE exit criterion — data compat is the product promise.
