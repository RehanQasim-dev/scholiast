# Product Spec: Tauri Shell Foundation & Core Models

## Summary
Desktop and mobile native shell foundation for Scholiast Companion built on Tauri v2, React 18, and Rust with SQLite WAL.

## Behavior

1. **Desktop window initializes in dark theme** (`#000000` / `#0b0d14`) with persistent left sidebar navigation.
2. **Strict domain ownership**: React owns ephemeral UI state only; Rust owns all persistent data in SQLite.
3. **Database operates in Write-Ahead Logging (WAL) mode** with foreign-key cascade deletes.
