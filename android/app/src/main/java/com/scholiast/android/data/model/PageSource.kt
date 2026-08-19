package com.scholiast.android.data.model

import kotlinx.serialization.Serializable

/**
 * The readable page captured as Markdown, for the Obsidian note body. Mirrors
 * `PageSource` in `src/utils/page-source.ts` byte-for-byte (`url`, `title`,
 * `markdown`, `capturedAt` ms). The app does not create these in v1 (no Obsidian
 * export path); the DTO exists so a future sync/export can carry one unchanged.
 */
@Serializable
data class PageSource(
    val url: String,
    val title: String,
    val markdown: String,
    val capturedAt: Long,
)