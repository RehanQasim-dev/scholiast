# Product Spec: Tauri Settings & Preferences

## Summary
Comprehensive configuration panel for speech engines, sync credentials, playback defaults, appearance tokens, and storage purge options.

## Behavior

1. **Preferences are organized into distinct categories**: Speech / STT, Cloud Sync, Playback, Appearance, and Data Management.
2. **API keys and sensitive tokens are stored securely in the OS keyring** rather than plaintext configuration files.
3. **Data purge operations require typed confirmation** before executing irreversible deletion of SQLite records or cached media.
