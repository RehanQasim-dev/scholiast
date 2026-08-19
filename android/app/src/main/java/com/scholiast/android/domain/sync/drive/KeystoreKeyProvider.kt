package com.scholiast.android.domain.sync.drive

import com.scholiast.android.domain.transcribe.ApiKeyProvider
import com.scholiast.android.domain.transcribe.Service

/**
 * Task 10's [ApiKeyProvider] backed by the same Keystore [SecretStorage] as the Drive
 * tokens (plan §2: Groq/Gemini/Gemma keys live in the Keystore). Decrypted values are
 * cached in memory **only while unlocked** — Task 19 should call [unlock] once at app
 * start and [lock] on background/exit so no plaintext survives in memory longer than
 * needed. `apiKey()` returns null while locked.
 */
class KeystoreKeyProvider(private val storage: SecretStorage) : ApiKeyProvider {

    var isUnlocked: Boolean = false
        private set

    private val cache = mutableMapOf<Service, String>()

    /** Decrypt every stored key into memory. No-op when already unlocked. */
    fun unlock() {
        if (isUnlocked) return
        cache.clear()
        for (service in Service.entries) {
            storage.get(keyFor(service))?.let { cache[service] = it }
        }
        isUnlocked = true
    }

    /** Drop the in-memory plaintexts. Stored ciphertexts are untouched. */
    fun lock() {
        cache.clear()
        isUnlocked = false
    }

    /** Persist (or clear with `null`) a service key; the in-memory cache follows. */
    fun setKey(service: Service, key: String?) {
        val storageKey = keyFor(service)
        if (key == null) {
            storage.delete(storageKey)
            cache.remove(service)
        } else {
            storage.put(storageKey, key)
            if (isUnlocked) cache[service] = key
        }
    }

    override suspend fun apiKey(service: Service): String? =
        if (isUnlocked) cache[service] else null

    private fun keyFor(service: Service): String = when (service) {
        Service.GROQ -> "api.groq"
        Service.GEMINI -> "api.gemini"
        Service.GEMMA -> "api.gemma"
    }

    companion object {
        /**
         * The app-wide instance, unlocked once at startup (MainActivity). Task 19's
         * Settings screen edits keys through the same instance so the transcribers
         * read live values.
         */
        @Volatile
        private var appInstance: KeystoreKeyProvider? = null

        fun unlockForApp(context: android.content.Context): KeystoreKeyProvider =
            appInstance ?: synchronized(this) {
                appInstance ?: KeystoreKeyProvider(
                    AndroidKeyStoreSecretStorage(context.applicationContext),
                ).also { it.unlock() }
            }
    }
}