package com.scholiast.android.domain.sync.drive

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** The OAuth token pair, with the access token's expiry (epoch ms). */
@Serializable
data class DriveTokens(
    val accessToken: String,
    val expiresAt: Long,
    val refreshToken: String? = null,
)

/**
 * Where the OAuth tokens live. [KeystoreTokenStore] is the real impl (encrypted at
 * rest via [SecretStorage]); JVM tests fake this seam (see `DriveOAuthTest.kt`).
 */
interface TokenStore {
    suspend fun save(tokens: DriveTokens)
    suspend fun load(): DriveTokens?
    suspend fun clear()
}

/** A single in-flight PKCE authorization (persisted so a process restart can recover). */
data class PendingAuth(val state: String, val verifier: String)

/**
 * PKCE bookkeeping keyed by `state`: the pending verifier and the redirect result
 * once it lands. The Custom Tab round-trip can kill the app process, so both are
 * persisted ([SharedPrefsPendingAuthStore]); the in-memory [OAuthRedirects] bus covers
 * the same-process path. JVM tests fake this seam.
 */
interface PendingAuthStore {
    fun save(pending: PendingAuth)
    fun load(state: String): PendingAuth?
    fun clear(state: String)
    fun clearRedirects()
    fun saveRedirect(state: String, uri: String)
    fun takeRedirect(state: String): String?
}

/**
 * Plaintext-in/plaintext-out secret storage seam. [AndroidKeyStoreSecretStorage]
 * encrypts values (AES-256-GCM, key held by the Android Keystore) before writing them
 * to SharedPreferences; JVM tests fake this seam — the Keystore itself is only
 * exercisable on-device (`androidTest/…/KeystoreStorageTest.kt`).
 */
interface SecretStorage {
    fun put(key: String, value: String)
    fun get(key: String): String?
    fun delete(key: String)
    fun clear()
}

/**
 * [TokenStore] over a [SecretStorage] seam: one JSON blob under `drive.tokens`.
 * Corrupt blobs read back as null (a wiped keystore key is a disconnect, not a crash).
 */
class KeystoreTokenStore(private val storage: SecretStorage) : TokenStore {

    private val json = Json { ignoreUnknownKeys = true }

    override suspend fun save(tokens: DriveTokens) {
        storage.put(KEY, json.encodeToString(DriveTokens.serializer(), tokens))
    }

    override suspend fun load(): DriveTokens? {
        val raw = storage.get(KEY) ?: return null
        return try {
            json.decodeFromString(DriveTokens.serializer(), raw)
        } catch (e: Exception) {
            null
        }
    }

    override suspend fun clear() = storage.delete(KEY)

    companion object {
        const val KEY = "drive.tokens"
    }
}

/**
 * [PendingAuthStore] in SharedPreferences (`oauth_pending`), keyed by state — the
 * cross-process fallback for the Custom Tab round-trip. The redirect activity writes
 * the URI here (and to the in-memory bus); [DriveOAuth.awaitRedirect] consumes either.
 */
class SharedPrefsPendingAuthStore(context: Context) : PendingAuthStore {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("oauth_pending", Context.MODE_PRIVATE)

    override fun save(pending: PendingAuth) {
        prefs.edit().putString(PENDING_PREFIX + pending.state, pending.verifier).apply()
    }

    override fun load(state: String): PendingAuth? {
        val verifier = prefs.getString(PENDING_PREFIX + state, null) ?: return null
        return PendingAuth(state = state, verifier = verifier)
    }

    override fun clear(state: String) {
        prefs.edit()
            .remove(PENDING_PREFIX + state)
            .remove(REDIRECT_PREFIX + state)
            .apply()
    }

    override fun clearRedirects() {
        val editor = prefs.edit()
        prefs.all.keys.filter { it.startsWith(REDIRECT_PREFIX) }.forEach { editor.remove(it) }
        editor.apply()
    }

    override fun saveRedirect(state: String, uri: String) {
        prefs.edit().putString(REDIRECT_PREFIX + state, uri).apply()
    }

    override fun takeRedirect(state: String): String? {
        val key = REDIRECT_PREFIX + state
        val uri = prefs.getString(key, null) ?: return null
        prefs.edit().remove(key).apply()
        return uri
    }

    private companion object {
        const val PENDING_PREFIX = "pending:"
        const val REDIRECT_PREFIX = "redirect:"
    }
}

/**
 * AES-256-GCM encryption at rest. The key lives in the Android Keystore
 * (`AndroidKeyStore`, non-extractable); each value's ciphertext + IV land in
 * SharedPreferences `scholiast_secrets` as `base64(iv):base64(ciphertext)` — the
 * ciphertext blob never contains the plaintext (verified by the androidTest).
 */
class AndroidKeyStoreSecretStorage(context: Context) : SecretStorage {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("scholiast_secrets", Context.MODE_PRIVATE)

    override fun put(key: String, value: String) {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val blob = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" +
            Base64.encodeToString(encrypted, Base64.NO_WRAP)
        prefs.edit().putString(key, blob).apply()
    }

    override fun get(key: String): String? {
        val blob = prefs.getString(key, null) ?: return null
        return try {
            val sep = blob.indexOf(':')
            if (sep <= 0) return null
            val iv = Base64.decode(blob.substring(0, sep), Base64.NO_WRAP)
            val ciphertext = Base64.decode(blob.substring(sep + 1), Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, iv))
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (e: Exception) {
            null // corrupt blob or a wiped keystore entry — treat as absent
        }
    }

    override fun delete(key: String) = prefs.edit().remove(key).apply()

    override fun clear() = prefs.edit().clear().apply()

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val ALIAS = "scholiast_secrets"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val TAG_BITS = 128
    }
}