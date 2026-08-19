package com.scholiast.android.domain.sync.drive

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.scholiast.android.domain.transcribe.Service
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device verification of the Android Keystore-backed storage (the acceptance criterion
 * that cannot run in CI: the Keystore is only available on a real Android runtime).
 * Run with `./gradlew :app:connectedDebugAndroidTest`.
 */
@RunWith(AndroidJUnit4::class)
class KeystoreStorageTest {

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun secretStorageRoundTripsEncryptedValues() {
        val storage = AndroidKeyStoreSecretStorage(context)
        storage.clear()
        try {
            assertNull(storage.get("test.key"))
            storage.put("test.key", "drive-refresh-token-123")
            assertEquals("drive-refresh-token-123", storage.get("test.key"))
            // Ciphertext, never plaintext, lands in the blob.
            val raw = storageBlob("test.key")
            assertTrue(raw != null && !raw.contains("drive-refresh-token-123"))
            storage.delete("test.key")
            assertNull(storage.get("test.key"))
        } finally {
            storage.clear()
        }
    }

    @Test
    fun tokenStoreRoundTripsThroughTheRealKeystore() = runBlocking {
        val storage = AndroidKeyStoreSecretStorage(context)
        storage.clear()
        try {
            val store = KeystoreTokenStore(storage)
            assertNull(store.load())
            val tokens = DriveTokens("access-1", 123_456L, "refresh-1")
            store.save(tokens)
            assertEquals(tokens, store.load())
            store.clear()
            assertNull(store.load())
        } finally {
            storage.clear()
        }
    }

    @Test
    fun keyProviderPersistsKeysAndLocks() = runBlocking {
        val storage = AndroidKeyStoreSecretStorage(context)
        storage.clear()
        try {
            val provider = KeystoreKeyProvider(storage)
            provider.unlock()
            assertNull(provider.apiKey(Service.GROQ))
            provider.setKey(Service.GROQ, "groq-real-key")
            provider.setKey(Service.GEMINI, "gemini-real-key")
            assertEquals("groq-real-key", provider.apiKey(Service.GROQ))
            provider.lock()
            assertFalse(provider.isUnlocked)
            assertNull(provider.apiKey(Service.GROQ))
            provider.unlock()
            assertEquals("groq-real-key", provider.apiKey(Service.GROQ))
            provider.setKey(Service.GROQ, null)
            assertNull(provider.apiKey(Service.GROQ))
        } finally {
            storage.clear()
        }
    }

    private fun storageBlob(key: String): String? {
        // The ciphertext blob lives in the shared prefs file the storage impl owns.
        return context.getSharedPreferences("scholiast_secrets", Context.MODE_PRIVATE)
            .getString(key, null)
    }
}