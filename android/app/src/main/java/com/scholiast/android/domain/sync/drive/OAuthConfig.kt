package com.scholiast.android.domain.sync.drive

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/**
 * Drive OAuth client configuration. Field names mirror the desktop's
 * `oauth.local.example.json` (`nativeClientId`, `nativeClientSecret`); real values
 * are injected at build time or typed in Settings at runtime (Task 19) — never
 * hardcoded here. The placeholder defaults make [isConfigured] false, so the build
 * and the app work unconfigured, exactly like the desktop's empty-injection builds.
 */
data class OAuthConfig(
    val nativeClientId: String = PLACEHOLDER_CLIENT_ID,
    val nativeClientSecret: String = PLACEHOLDER_CLIENT_SECRET,
    val redirectUri: String = DEFAULT_REDIRECT_URI,
    val authorizeEndpoint: String = "https://accounts.google.com/o/oauth2/v2/auth",
    val tokenEndpoint: String = "https://oauth2.googleapis.com/token",
    val revokeEndpoint: String = "https://oauth2.googleapis.com/revoke",
) {

    /** False while the build carries the placeholder values (plan §2: no hardcoded secrets). */
    val isConfigured: Boolean
        get() = nativeClientId.isNotBlank() && !nativeClientId.startsWith("000000000000") &&
            nativeClientSecret.isNotBlank() && !nativeClientSecret.startsWith("GOCSPX-")

    companion object {
        /** The appdata scope — the narrowest Drive access, mirrors the desktop's `SCOPE`. */
        const val SCOPE_DRIVE_APPDATA = "https://www.googleapis.com/auth/drive.appdata"

        /** The app's custom-scheme redirect (task.md's example; Task 01 registers the intent filter). */
        const val DEFAULT_REDIRECT_URI = "scholiast://oauth2redirect"

        /** Placeholders mirrored from `oauth.local.example.json` — the repo ships no real values. */
        const val PLACEHOLDER_CLIENT_ID =
            "000000000000-yyyyyyyyyyyyyyyyyyyyyyyyyyyy.apps.googleusercontent.com"
        const val PLACEHOLDER_CLIENT_SECRET = "GOCSPX-zzzzzzzzzzzzzzzzzzzzzzzz"
    }
}

/**
 * RFC 7636 PKCE helpers. The verifier is 96 random bytes base64url-encoded = **exactly
 * 128 characters** (the RFC's maximum); the challenge is the S256 hash, base64url,
 * unpadded (43 chars). Task.md's "128 bytes" is not directly usable — 128 raw bytes
 * would be a 170-char string, outside the RFC range.
 */
object Pkce {

    private val rng = SecureRandom()

    /** A fresh verifier: 96 random bytes → exactly 128 URL-safe characters. */
    fun verifier(): String {
        val bytes = ByteArray(96)
        rng.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    /** The S256 challenge for [verifier] (RFC 7636 §4.2). */
    fun challenge(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(verifier.toByteArray(Charsets.US_ASCII))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }
}