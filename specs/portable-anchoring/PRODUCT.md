# Product Spec: Cross-Surface Portable Anchoring

## Summary
Cross-surface dual-anchoring schema enabling identical highlight persistence, serialization, and fuzzy resolution across browser extension, companion app, and Obsidian plugins.

## Behavior

1. **Every highlight records both an XPath locator and a text-quote context object** (`exact`, `prefix`, `suffix`, `occurrence`).
2. **Resolution operates through a 3-tiered fallback ladder**: exact match -> whitespace-collapsed match -> fuzzy edit-distance match within configurable tolerance.
3. **Anchor serialization is 100% byte-compatible** between TypeScript (`shared/anchor.ts`) and Rust (`scholiast_tauri/src/lib/anchor/`).
