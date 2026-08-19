package com.scholiast.android.domain.voice.local

/**
 * Model catalogue, ported from the FUTO Keyboard's `Models.kt` (FUTO Source First License 1.1).
 * Checksums are verbatim from the FUTO repo.
 *
 * DOWNLOAD NOTE (verified 2026-08-19): the base URL comes from the keyboard's
 * `ImportResourceActivity.kt` (`getAddonUrlForLocale(VoiceInput)`). The current live page no
 * longer serves the `*_acft_q8_0.bin` files (curl: 404) — it now points at newer models
 * (`keyboard.futo.org/voice-input-english-{39,74,244}.bin`). The checksums below therefore
 * pin the FUTO-repo files, which may no longer be downloadable; the downloader reports a clear
 * checksum/404 error and Settings offers manual import instead. Refreshing the catalogue with
 * current checksums is a user decision (see task-11 LOG.md).
 */

object Models {
    /** Directory-page base verified from `ImportResourceActivity.kt` (FileKind.VoiceInput). */
    const val MODELS_PAGE_URL: String = "https://keyboard.futo.tech/voice-input-models"

    /** Attempted direct-download base for the pinned `ggmlFile` names. */
    const val DOWNLOAD_BASE_URL: String = "$MODELS_PAGE_URL/"

    /** URL the downloader tries for [model]. */
    fun downloadUrlFor(model: ModelLoader): String =
        when (model) {
            is ModelDownloadable -> DOWNLOAD_BASE_URL + model.ggmlFile
            is ModelBuiltInAsset -> DOWNLOAD_BASE_URL + model.ggmlFile
            is ModelFileFile -> "" // manually imported, nothing to download
            else -> "" // future loader types have no download URL
        }
}

/** English-only models (best accuracy for English; no other language). */
val ENGLISH_MODELS: List<ModelLoader> = listOf(
    ModelDownloadable(
        name = "Tiny (English) — fastest",
        ggmlFile = "tiny_en_acft_q8_0.bin",
        // FUTO ships tiny_en as an UNchecksummed built-in asset (uninitialized submodule in
        // this repo) — no hash exists to pin, so downloads of it are not checksum-verified.
        // Prefer base_en (pinned below) when a verified model is required.
        checksum = "",
    ),
    ModelDownloadable(
        name = "Base (English)",
        ggmlFile = "base_en_acft_q8_0.bin",
        checksum = "e9b4b7b81b8a28769e8aa9962aa39bb9f21b622cf6a63982e93f065ed5caf1c8",
    ),
    ModelDownloadable(
        name = "Small (English) — most accurate",
        ggmlFile = "small_en_acft_q8_0.bin",
        checksum = "58fbe949992dafed917590d58bc12ca577b08b9957f0b3e0d7ee71b64bed3aa8",
    ),
)

/** Multilingual models (all languages, quality varies by training data). */
val MULTILINGUAL_MODELS: List<ModelLoader> = listOf(
    ModelDownloadable(
        name = "Tiny (Multilingual) — fastest",
        ggmlFile = "tiny_acft_q8_0.bin",
        checksum = "07aa4d514144deacf5ffec5cacb36c93dee272fda9e64ac33a801f8cd5cbd953",
    ),
    ModelDownloadable(
        name = "Base (Multilingual)",
        ggmlFile = "base_acft_q8_0.bin",
        checksum = "e44f352c9aa2c3609dece20c733c4ad4a75c28cd9ab07d005383df55fa96efc4",
    ),
    ModelDownloadable(
        name = "Small (Multilingual) — most accurate",
        ggmlFile = "small_acft_q8_0.bin",
        checksum = "15ef255465a6dc582ecf1ec651a4618c7ee2c18c05570bbe46493d248d465ac4",
    ),
)

val ALL_MODELS: List<ModelLoader> = ENGLISH_MODELS + MULTILINGUAL_MODELS

/** Offline default: the English tiny model. */
val DEFAULT_MODEL: ModelDownloadable = ENGLISH_MODELS[0] as ModelDownloadable