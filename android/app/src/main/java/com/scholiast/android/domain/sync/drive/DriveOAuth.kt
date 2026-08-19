package com.scholiast.android.domain.sync.drive

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import java.io.IOException
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import java.util.Base64
import kotlinx.coroutines.delay
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import okhttp3.FormBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Typed failures of the OAuth flow. */
sealed class OAuthException(message: String, cause: Throwable? = null) : Exception(message, cause) {

    /** True for a refresh answer of `invalid_grant` — the refresh token is dead. */
    open val invalidGrant: Boolean get() = false

    /** The build carries placeholder client values — the connect UI should say so. */
    class NotConfigured : OAuthException("Drive OAuth is not configured (placeholder client values)")

    /** No usable tokens; the user must (re-)connect. */
    class NotConnected(cause: Throwable? = null) : OAuthException("Drive is not connected", cause)

    /** The user declined the consent screen. */
    class UserDenied : OAuthException("OAuth consent was denied")

    /** The redirect's `state` did not match the pending authorization. */
    class StateMismatch : OAuthException("OAuth state did not match")

    /** The redirect carried no `code` (and no error). */
    class NoCode : OAuthException("OAuth redirect carried no authorization code")

    /** The token endpoint answered with an error. */
    class TokenRequestFailed(
        val error: String?,
        override val invalidGrant: Boolean,
        detail: String? = null,
    ) : OAuthException(
        "OAuth token request failed" +
            (error?.let { " ($it)" } ?: "") +
            (detail?.let { ": $it" } ?: ""),
    )

    /** The token endpoint was unreachable. */
    class Network(cause: Throwable? = null) : OAuthException("OAuth network error", cause)

    /** No redirect arrived within the deadline. */
    class Timeout : OAuthException("Timed out waiting for the OAuth redirect")
}

/**
 * Same-process redirect delivery: [OAuthRedirectActivity] forwards the redirect URI
 * here (and to the persisted [PendingAuthStore]); [DriveOAuth.awaitRedirect] consumes
 * from both. Static because the redirect activity can't share an instance with the
 * awaiting flow (and the process may even have restarted between the two).
 */
object OAuthRedirects {
    private val byState = HashMap<String, String>()

    fun dispatch(state: String, uri: String) {
        byState[state] = uri
    }

    /** Consumes: a given state is delivered at most once. */
    fun take(state: String): String? = byState.remove(state)

    fun clear() = byState.clear()
}

/**
 * The PKCE OAuth flow (plan §5.8.1): build the consent URL, launch it in a Custom Tab,
 * wait for the redirect (in-process via [OAuthRedirects], cross-process via the
 * persisted [PendingAuthStore]), exchange the code for tokens, and renew silently.
 *
 * Pure JVM apart from the launch/redirect glue in [CustomTabAuth] and
 * [OAuthRedirectActivity]. The connect flow (Task 19 wires it to Settings):
 * `beginAuth()` → `CustomTabAuth.launch(context, buildAuthUrl(...))` →
 * `awaitRedirect(state)` → `complete(uri, pending)`.
 */
class DriveOAuth(
    private val config: OAuthConfig,
    private val tokenStore: TokenStore,
    private val pendingStore: PendingAuthStore,
    private val httpClient: OkHttpClient,
    private val now: () -> Long = { System.currentTimeMillis() },
) {

    private val json = Json { ignoreUnknownKeys = true }

    /** True when the build carries real client values (Settings shows "configured"). */
    fun isConfigured(): Boolean = config.isConfigured

    // --- Auth URL / pending state ---------------------------------------------------

    /** The consent URL for the given PKCE pair (plan §5.8.1 step 1). */
    fun buildAuthUrl(verifier: String, state: String): String {
        val params = listOf(
            "client_id" to config.nativeClientId,
            "response_type" to "code",
            "redirect_uri" to config.redirectUri,
            "scope" to OAuthConfig.SCOPE_DRIVE_APPDATA,
            "code_challenge" to Pkce.challenge(verifier),
            "code_challenge_method" to "S256",
            "access_type" to "offline",
            "prompt" to "consent",
            "state" to state,
        )
        return config.authorizeEndpoint + "?" +
            params.joinToString("&") { (k, v) -> "$k=${urlEncode(v)}" }
    }

    /** Start a fresh authorization: unique state + fresh PKCE pair, persisted. */
    fun beginAuth(): PendingAuth {
        val pending = PendingAuth(state = randomState(), verifier = Pkce.verifier())
        pendingStore.save(pending)
        return pending
    }

    /**
     * Wait for the redirect for [state] — polls the in-process bus first, then the
     * persisted store (covering a process restart during the tab round-trip). Throws
     * [OAuthException.Timeout] after [timeoutMs]. Uses wall-clock time, not the
     * injected [now], so the timeout is real.
     */
    suspend fun awaitRedirect(state: String, timeoutMs: Long): String {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (true) {
            OAuthRedirects.take(state)?.let { return it }
            pendingStore.takeRedirect(state)?.let { return it }
            val remaining = deadline - System.currentTimeMillis()
            if (remaining <= 0) throw OAuthException.Timeout()
            delay(minOf(remaining, 100L))
        }
    }

    // --- Token endpoint --------------------------------------------------------------

    /** Exchange an authorization code for tokens (POST /token, form-encoded). */
    suspend fun exchangeCode(code: String, verifier: String): DriveTokens {
        val form = FormBody.Builder()
            .add("grant_type", "authorization_code")
            .add("code", code)
            .add("redirect_uri", config.redirectUri)
            .add("client_id", config.nativeClientId)
            .add("client_secret", config.nativeClientSecret)
            .add("code_verifier", verifier)
            .build()
        return postToken(form)
    }

    /** Renew with a refresh token; a response that omits it carries the old one forward. */
    suspend fun refresh(refreshToken: String): DriveTokens {
        val form = FormBody.Builder()
            .add("grant_type", "refresh_token")
            .add("refresh_token", refreshToken)
            .add("client_id", config.nativeClientId)
            .add("client_secret", config.nativeClientSecret)
            .build()
        return postToken(form, fallbackRefreshToken = refreshToken)
    }

    private suspend fun postToken(form: FormBody, fallbackRefreshToken: String? = null): DriveTokens {
        val request = Request.Builder().url(config.tokenEndpoint).post(form).build()
        val response = try {
            httpClient.newCall(request).execute()
        } catch (e: IOException) {
            throw OAuthException.Network(e)
        }
        response.use {
            val body = it.body?.string().orEmpty()
            if (!it.isSuccessful) {
                val error = errorField(body, "error")
                val description = errorField(body, "error_description")
                throw OAuthException.TokenRequestFailed(
                    error = error,
                    invalidGrant = error == "invalid_grant",
                    detail = description ?: body.ifBlank { null },
                )
            }
            val obj = try {
                json.parseToJsonElement(body).jsonObject
            } catch (e: Exception) {
                throw OAuthException.TokenRequestFailed(
                    error = null, invalidGrant = false, detail = "Malformed token response",
                )
            }
            val accessToken = obj["access_token"]?.jsonPrimitive?.contentOrNull
                ?: throw OAuthException.TokenRequestFailed(
                    error = null, invalidGrant = false, detail = "No access_token in response",
                )
            val expiresIn = obj["expires_in"]?.jsonPrimitive?.longOrNull ?: 3600L
            val refreshToken = obj["refresh_token"]?.jsonPrimitive?.contentOrNull
                ?: fallbackRefreshToken
            return DriveTokens(
                accessToken = accessToken,
                // Refresh a minute early, like the desktop, so the token never expires mid-request.
                expiresAt = now() + (expiresIn - 60) * 1000L,
                refreshToken = refreshToken,
            )
        }
    }

    private fun errorField(body: String, name: String): String? = try {
        json.parseToJsonElement(body).jsonObject[name]?.jsonPrimitive?.contentOrNull
    } catch (e: Exception) {
        null
    }

    // --- Flow completion --------------------------------------------------------------

    /**
     * Finish the flow from the redirect URI: validate the state, then exchange and
     * persist. Throws [OAuthException.StateMismatch] / [OAuthException.UserDenied] /
     * [OAuthException.NoCode] before any network call.
     */
    suspend fun complete(redirectUri: String, pending: PendingAuth): DriveTokens {
        val params = queryParams(redirectUri)
        val state = params["state"]
        if (state == null || state != pending.state) throw OAuthException.StateMismatch()
        val error = params["error"]
        if (error != null) {
            if (error == "access_denied") throw OAuthException.UserDenied()
            throw OAuthException.TokenRequestFailed(
                error = error, invalidGrant = false, detail = "OAuth error: $error",
            )
        }
        val code = params["code"] ?: throw OAuthException.NoCode()
        val tokens = exchangeCode(code, pending.verifier)
        tokenStore.save(tokens)
        pendingStore.clear(pending.state)
        return tokens
    }

    // --- Token lifecycle ---------------------------------------------------------------

    /**
     * A valid access token: returns the stored one while fresh, otherwise refreshes
     * silently. An `invalid_grant` answer means the refresh token is dead — the store
     * is cleared and [OAuthException.NotConnected] thrown. With an empty store the
     * placeholder client reports [OAuthException.NotConfigured] instead.
     */
    suspend fun getAccessToken(): String {
        val stored = tokenStore.load()
        if (stored == null) {
            if (!config.isConfigured) throw OAuthException.NotConfigured()
            throw OAuthException.NotConnected()
        }
        if (stored.expiresAt > now()) return stored.accessToken
        val refreshToken = stored.refreshToken ?: throw OAuthException.NotConnected()
        val fresh = try {
            refresh(refreshToken)
        } catch (e: OAuthException.TokenRequestFailed) {
            if (e.invalidGrant) {
                tokenStore.clear()
                throw OAuthException.NotConnected(e)
            }
            throw e
        }
        tokenStore.save(fresh)
        return fresh.accessToken
    }

    /**
     * Force the next [getAccessToken] to refresh (the desktop's `expiresAt: 0` trick),
     * used by the Drive client after a 401. Without a refresh token the connection is
     * dead, so the store is cleared instead.
     */
    suspend fun invalidateAccessToken() {
        val stored = tokenStore.load() ?: return
        if (stored.refreshToken == null) {
            tokenStore.clear()
        } else {
            tokenStore.save(stored.copy(expiresAt = 0L))
        }
    }

    /**
     * Revoke the refresh token (best-effort — a revocation failure never blocks the
     * disconnect) and wipe the store.
     */
    suspend fun disconnect() {
        val stored = tokenStore.load()
        tokenStore.clear()
        val refreshToken = stored?.refreshToken ?: return
        try {
            val request = Request.Builder()
                .url(config.revokeEndpoint + "?token=" + urlEncode(refreshToken))
                .post("".toRequestBody(null))
                .build()
            httpClient.newCall(request).execute().close()
        } catch (e: IOException) {
            // Best-effort: the local disconnect is what matters.
        }
    }

    // --- Helpers ----------------------------------------------------------------------

    private fun randomState(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun queryParams(uri: String): Map<String, String> {
        val query = try {
            URI(uri).rawQuery
        } catch (e: Exception) {
            return emptyMap()
        } ?: return emptyMap()
        return query.split('&').mapNotNull { pair ->
            val eq = pair.indexOf('=')
            val name = if (eq == -1) pair else pair.substring(0, eq)
            val value = if (eq == -1) "" else pair.substring(eq + 1)
            urlDecode(name) to urlDecode(value)
        }.toMap()
    }

    private fun urlEncode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name()).replace("+", "%20")

    private fun urlDecode(value: String): String =
        URLDecoder.decode(value, StandardCharsets.UTF_8.name())
}

/**
 * Launches the consent URL in a Custom Tab, falling back to the plain browser when no
 * Custom Tab provider is installed. The redirect is caught by [OAuthRedirectActivity]
 * (needs the manifest entry Task 01 must apply — see task LOG.md).
 */
object CustomTabAuth {
    fun launch(context: Context, url: String) {
        if (!CustomTabsClient.getPackageName(context, null).isNullOrEmpty()) {
            CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url))
        } else {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }
    }
}

/**
 * Catch-all for `scholiast://oauth2redirect`. Forwards the redirect URI to the
 * in-process bus and the persisted pending store so [DriveOAuth.awaitRedirect] can
 * complete it — including after a process restart. **Manifest entry (Task 01's file):
 * see `android-tasks/task-16-drive-oauth-keystore/LOG.md`.**
 */
class OAuthRedirectActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent) {
        val uri = intent.data?.toString()
        if (uri != null) {
            val state = queryParam(uri, "state")
            if (state != null) {
                val pendingStore = SharedPrefsPendingAuthStore(applicationContext)
                pendingStore.saveRedirect(state, uri)
                OAuthRedirects.dispatch(state, uri)
            }
        }
        finish()
    }

    private fun queryParam(uri: String, name: String): String? {
        val query = try { URI(uri).rawQuery } catch (e: Exception) { return null } ?: return null
        for (pair in query.split('&')) {
            val eq = pair.indexOf('=')
            val key = if (eq == -1) pair else pair.substring(0, eq)
            if (key == name) {
                val value = if (eq == -1) "" else pair.substring(eq + 1)
                return URLDecoder.decode(value, StandardCharsets.UTF_8.name())
            }
        }
        return null
    }
}