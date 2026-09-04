# Domain Docs

Rules for reading and updating domain documentation in this repository.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: defines the project's canonical glossary. Use these terms without drifting into synonyms.
- **`docs/adr/`**: read ADRs touching the subsystem you are modifying. Respect the locked decisions.
- **`docs/architecture/`**: read subsystem architecture reference on demand via context pointers.

## Flag ADR conflicts

If proposed changes contradict an existing ADR, surface it explicitly:
> *Contradicts ADR-0001 (per-page storage sharding), but worth reopening because...*

