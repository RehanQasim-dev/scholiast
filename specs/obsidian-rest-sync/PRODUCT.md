# Product Spec: Obsidian Local REST API Sync

## Summary
Direct vault synchronization via the Obsidian Local REST API, translating web annotations and video notes into structured Markdown callouts.

## Behavior

1. **Extension connects to local Obsidian vault** via Local REST API using configured port and HTTPS API token.
2. **Annotations synchronize to dedicated page notes** formatted with structured callouts (`> [!quote]`, `> [!note]`).
3. **Existing user content outside managed callout zones** is strictly preserved across note updates.
