package com.scholiast.android.domain.sync.drive

import com.scholiast.android.domain.transcribe.Service
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM tests for the Drive OAuth + token-storage layer (no Android deps). Everything
 * up to the Custom Tab launch is covered: PKCE (RFC 7636 known vector), auth-URL
 * construction, code exchange and refresh against MockWebServer, the 401-refresh-retry
 * cycle in the Drive client, typed errors, and the token stores round-tripping through
 * a faked [SecretStorage] (the Android Keystore itself is on-device-only — see
 * `androidTest/…/KeystoreStorageTest.kt`).
 */
class DriveOAuthTest {

    // --- Fakes -------------------------------------------------------------------

    private class FakeTokenStore : TokenStore {
        var stored: DriveTokens? = null
        override suspend fun save(tokens: DriveTokens) { stored = tokens }
        override suspend fun load(): DriveTokens? = stored
        override suspend fun clear() { stored = null }
    }

    private class FakeSecretStorage : SecretStorage {
        val map = mutableMapOf<String, String>()
        override fun put(key: String, value: String) { map[key] = value }
        override fun get(key: String): String? = map[key]
        override fun delete(key: String) { map.remove(key) }
        override fun clear() { map.clear() }
    }

    private class FakePendingAuthStore : PendingAuthStore {
        val pendings = mutableMapOf<String, PendingAuth>()
        val redirects = mutableMapOf<String, String>()
        override fun save(pending: PendingAuth) { pendings[pending.state] = pending }
        override fun load(state: String): PendingAuth? = pendings[state]
        override fun clear(state: String) { pendings.remove(state); redirects.remove(state) }
        override fun clearRedirects() { redirects.clear() }
        override fun saveRedirect(state: String, uri: String) { redirects[state] = uri }
        override fun takeRedirect(state: String): String? = redirects.remove(state)
    }

    private fun oauth(
        server: MockWebServer? = null,
        now: Long = 1_000_000L,
        config: OAuthConfig = OAuthConfig(),
        tokenStore: TokenStore = FakeTokenStore(),
        pendingStore: PendingAuthStore = FakePendingAuthStore(),
    ): DriveOAuth {
        val effective = if (server == null) {
            config
        } else {
            config.copy(
                tokenEndpoint = server.url("/token").toString(),
                revokeEndpoint = server.url("/revoke").toString(),
            )
        }
        return DriveOAuth(
            config = effective,
            tokenStore = tokenStore,
            pendingStore = pendingStore,
            httpClient = OkHttpClient(),
            now = { now },
        )
    }

    private fun parseQuery(query: String): Map<String, String> =
        query.split('&').mapNotNull { pair ->
            val eq = pair.indexOf('=')
            val name = if (eq == -1) pair else pair.substring(0, eq)
            val value = if (eq == -1) "" else pair.substring(eq + 1)
            URLDecoder.decode(name, StandardCharsets.UTF_8) to
                URLDecoder.decode(value, StandardCharsets.UTF_8)
        }.toMap()

    // --- PKCE ---------------------------------------------------------------------

    @Test
    fun `pkce challenge matches the RFC 7636 appendix B known vector`() {
        val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        val expectedChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        assertEquals(expectedChallenge, Pkce.challenge(verifier))
    }

    @Test
    fun `pkce verifier is exactly 128 url-safe characters, inside the RFC range, unique`() {
        val a = Pkce.verifier()
        val b = Pkce.verifier()
        assertEquals(128, a.length)
        assertTrue("base64url charset only: $a", a.matches(Regex("^[A-Za-z0-9_-]{128}$")))
        assertFalse(a.contains("+") || a.contains("/") || a.contains("="))
        assertTrue("RFC 7636 range 43..128", a.length in 43..128)
        assertNotEquals(a, b)
    }

    // --- Auth URL ----------------------------------------------------------------

    @Test
    fun `buildAuthUrl carries the PKCE and offline params`() {
        val config = OAuthConfig(
            nativeClientId = "client-123",
            nativeClientSecret = "secret",
            redirectUri = "scholiast://oauth2redirect",
        )
        val o = oauth(config = config)
        val verifier = Pkce.verifier()
        val params = parseQuery(o.buildAuthUrl(verifier, "state-1").substringAfter('?'))

        assertEquals("client-123", params["client_id"])
        assertEquals("code", params["response_type"])
        assertEquals("scholiast://oauth2redirect", params["redirect_uri"])
        assertEquals(OAuthConfig.SCOPE_DRIVE_APPDATA, params["scope"])
        assertEquals(Pkce.challenge(verifier), params["code_challenge"])
        assertEquals("S256", params["code_challenge_method"])
        assertEquals("offline", params["access_type"])
        assertEquals("consent", params["prompt"])
        assertEquals("state-1", params["state"])
    }

    // --- beginAuth / pending state ------------------------------------------------

    @Test
    fun `beginAuth persists a fresh PKCE pair with a unique state`() {
        val pendingStore = FakePendingAuthStore()
        val o = oauth(pendingStore = pendingStore)
        val a = o.beginAuth()
        val b = o.beginAuth()
        assertNotEquals(a.state, b.state)
        assertEquals(a, pendingStore.load(a.state))
        assertEquals(128, a.verifier.length)
        assertEquals(Pkce.challenge(a.verifier).length, 43)
    }

    @Test
    fun `awaitRedirect recovers a persisted redirect (process-death path)`() = runBlocking {
        val pendingStore = FakePendingAuthStore()
        val o = oauth(pendingStore = pendingStore)
        val pending = o.beginAuth()
        val redirectUri = "scholiast://oauth2redirect?code=c1&state=${pending.state}"
        pendingStore.saveRedirect(pending.state, redirectUri)

        val uri = o.awaitRedirect(pending.state, timeoutMs = 2_000)
        assertEquals(redirectUri, uri)
        assertNull("redirect consumed", pendingStore.takeRedirect(pending.state))
    }

    @Test
    fun `awaitRedirect times out when no redirect arrives`() = runBlocking {
        val o = oauth()
        val pending = o.beginAuth()
        val e = try {
            o.awaitRedirect(pending.state, timeoutMs = 600)
            null
        } catch (e: OAuthException) {
            e
        }
        assertTrue("expected Timeout, got $e", e is OAuthException.Timeout)
    }

    @Test
    fun `oauth redirect bus delivers and consumes per state`() {
        OAuthRedirects.clear()
        OAuthRedirects.dispatch("s1", "uri1")
        OAuthRedirects.dispatch("s2", "uri2")
        assertNull(OAuthRedirects.take("s3"))
        assertEquals("uri2", OAuthRedirects.take("s2"))
        assertEquals("uri1", OAuthRedirects.take("s1"))
        assertNull(OAuthRedirects.take("s1"))
    }

    // --- Code exchange + refresh --------------------------------------------------

    @Test
    fun `token exchange parses tokens and computes expiry with a minute buffer`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val o = oauth(
                server = server,
                now = 1_000_000L,
                config = OAuthConfig(nativeClientId = "client-123", nativeClientSecret = "secret"),
            )
            server.enqueue(
                MockResponse().setBody("""{"access_token":"at-1","expires_in":3600,"refresh_token":"rt-1","token_type":"Bearer"}"""),
            )

            val tokens = o.exchangeCode("code-1", "verifier-1")

            assertEquals("at-1", tokens.accessToken)
            assertEquals("rt-1", tokens.refreshToken)
            assertEquals(1_000_000L + 3_540_000L, tokens.expiresAt)

            val req = server.takeRequest()
            assertEquals("/token", req.path)
            assertEquals("POST", req.method)
            val form = req.body.readUtf8()
            assertTrue(form.contains("grant_type=authorization_code"))
            assertTrue(form.contains("code=code-1"))
            assertTrue(form.contains("code_verifier=verifier-1"))
            assertTrue(form.contains("client_id=client-123"))
            assertTrue(form.contains("client_secret=secret"))
            assertTrue(form.contains("redirect_uri=scholiast%3A%2F%2Foauth2redirect"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `refresh carries the existing refresh token forward when the response omits it`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val o = oauth(server = server)
            server.enqueue(MockResponse().setBody("""{"access_token":"at-2","expires_in":1800}"""))

            val tokens = o.refresh("rt-1")

            assertEquals("at-2", tokens.accessToken)
            assertEquals("rt-1", tokens.refreshToken)
            val req = server.takeRequest()
            val form = req.body.readUtf8()
            assertTrue(form.contains("grant_type=refresh_token"))
            assertTrue(form.contains("refresh_token=rt-1"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `token request surfaces a typed error with the description`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val o = oauth(server = server)
            server.enqueue(
                MockResponse().setResponseCode(400)
                    .setBody("""{"error":"invalid_grant","error_description":"Token has been expired or revoked."}"""),
            )

            val e = try {
                o.refresh("dead-token")
                null
            } catch (e: OAuthException) {
                e
            }

            assertTrue("expected TokenRequestFailed, got $e", e is OAuthException.TokenRequestFailed)
            assertEquals("invalid_grant", (e as OAuthException.TokenRequestFailed).error)
            assertTrue(e.invalidGrant)
            assertTrue(e.message!!.contains("expired or revoked"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `token request maps a connection failure to Network`() = runBlocking {
        val server = MockWebServer()
        server.start()
        val deadPort = server.port
        server.shutdown() // connection refused

        val o = oauth(config = OAuthConfig(tokenEndpoint = "http://127.0.0.1:$deadPort/token"))
        val e = try {
            o.refresh("rt")
            null
        } catch (e: OAuthException) {
            e
        }
        assertTrue("expected Network, got $e", e is OAuthException.Network)
    }

    // --- complete() ----------------------------------------------------------------

    @Test
    fun `complete exchanges the code and stores the tokens`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val store = FakeTokenStore()
            val pendingStore = FakePendingAuthStore()
            val o = oauth(server = server, tokenStore = store, pendingStore = pendingStore)
            server.enqueue(MockResponse().setBody("""{"access_token":"at-3","expires_in":3600,"refresh_token":"rt-3"}"""))

            val pending = o.beginAuth()
            val tokens = o.complete("scholiast://oauth2redirect?code=abc123&state=${pending.state}", pending)

            assertEquals("at-3", tokens.accessToken)
            assertEquals("rt-3", tokens.refreshToken)
            assertEquals(tokens, store.stored)
            assertNull("pending cleared after exchange", pendingStore.load(pending.state))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `complete rejects a state mismatch`() = runBlocking {
        val o = oauth()
        val pending = o.beginAuth()
        val e = try {
            o.complete("scholiast://oauth2redirect?code=x&state=other-state", pending)
            null
        } catch (e: OAuthException) {
            e
        }
        assertTrue("expected StateMismatch, got $e", e is OAuthException.StateMismatch)
    }

    @Test
    fun `complete throws UserDenied on access_denied`() = runBlocking {
        val o = oauth()
        val pending = o.beginAuth()
        val e = try {
            o.complete("scholiast://oauth2redirect?error=access_denied&state=${pending.state}", pending)
            null
        } catch (e: OAuthException) {
            e
        }
        assertTrue("expected UserDenied, got $e", e is OAuthException.UserDenied)
    }

    @Test
    fun `complete throws NoCode when the code is missing`() = runBlocking {
        val o = oauth()
        val pending = o.beginAuth()
        val e = try {
            o.complete("scholiast://oauth2redirect?state=${pending.state}", pending)
            null
        } catch (e: OAuthException) {
            e
        }
        assertTrue("expected NoCode, got $e", e is OAuthException.NoCode)
    }

    // --- getAccessToken lifecycle ---------------------------------------------------

    @Test
    fun `getAccessToken returns the cached token while valid`() = runBlocking {
        val store = FakeTokenStore().apply { stored = DriveTokens("at-ok", 2_000_000L, "rt-1") }
        val o = oauth(tokenStore = store, now = 1_000_000L)
        assertEquals("at-ok", o.getAccessToken())
    }

    @Test
    fun `getAccessToken refreshes silently when expired`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val store = FakeTokenStore().apply { stored = DriveTokens("at-old", 500_000L, "rt-1") }
            val o = oauth(server = server, tokenStore = store, now = 1_000_000L)
            server.enqueue(MockResponse().setBody("""{"access_token":"at-new","expires_in":3600}"""))

            assertEquals("at-new", o.getAccessToken())
            assertEquals("rt-1", store.stored?.refreshToken) // carried forward
            val req = server.takeRequest()
            assertTrue(req.body.readUtf8().contains("grant_type=refresh_token"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `getAccessToken clears the store on invalid_grant and throws NotConnected`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val store = FakeTokenStore().apply { stored = DriveTokens("at", 500_000L, "rt-dead") }
            val o = oauth(server = server, tokenStore = store, now = 1_000_000L)
            server.enqueue(MockResponse().setResponseCode(400).setBody("""{"error":"invalid_grant"}"""))

            val e = try {
                o.getAccessToken()
                null
            } catch (e: OAuthException) {
                e
            }
            assertTrue("expected NotConnected, got $e", e is OAuthException.NotConnected)
            assertNull("store cleared on revocation", store.stored)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `getAccessToken throws NotConnected when an expired token has no refresh token`() = runBlocking {
        val store = FakeTokenStore().apply { stored = DriveTokens("at", 500_000L, null) }
        val o = oauth(tokenStore = store, now = 1_000_000L)
        val e = try {
            o.getAccessToken()
            null
        } catch (e: OAuthException) {
            e
        }
        assertTrue("expected NotConnected, got $e", e is OAuthException.NotConnected)
    }

    @Test
    fun `getAccessToken throws NotConfigured for the placeholder client`() = runBlocking {
        val o = oauth()
        val e = try {
            o.getAccessToken()
            null
        } catch (e: OAuthException) {
            e
        }
        assertTrue("expected NotConfigured, got $e", e is OAuthException.NotConfigured)
    }

    @Test
    fun `invalidateAccessToken expires access but keeps the refresh token`() = runBlocking {
        val store = FakeTokenStore().apply { stored = DriveTokens("at", 2_000_000L, "rt-1") }
        val o = oauth(tokenStore = store)
        o.invalidateAccessToken()
        assertEquals(0L, store.stored?.expiresAt)
        assertEquals("rt-1", store.stored?.refreshToken)
    }

    @Test
    fun `invalidateAccessToken clears when there is no refresh token`() = runBlocking {
        val store = FakeTokenStore().apply { stored = DriveTokens("at", 2_000_000L, null) }
        val o = oauth(tokenStore = store)
        o.invalidateAccessToken()
        assertNull(store.stored)
    }

    @Test
    fun `disconnect clears the store and revokes best-effort`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val store = FakeTokenStore().apply { stored = DriveTokens("at", 2_000_000L, "rt-1") }
            val o = oauth(server = server, tokenStore = store)
            server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

            o.disconnect()

            assertNull(store.stored)
            val req = server.takeRequest()
            assertTrue(req.path!!.contains("/revoke"))
            assertTrue(req.path!!.contains("token=rt-1"))
        } finally {
            server.shutdown()
        }
    }

    // --- Token stores ---------------------------------------------------------------

    @Test
    fun `keystore token store round-trips through the secret storage seam`() = runBlocking {
        val storage = FakeSecretStorage()
        val store = KeystoreTokenStore(storage)

        assertNull(store.load())
        store.save(DriveTokens("at-1", 123L, "rt-1"))
        assertEquals(DriveTokens("at-1", 123L, "rt-1"), store.load())

        // The seam stores the serialized value; encryption is the storage impl's job.
        assertTrue(storage.map["drive.tokens"]!!.contains("\"accessToken\""))
        assertEquals(1, storage.map.size)

        store.clear()
        assertNull(store.load())
    }

    @Test
    fun `keystore token store survives a corrupted blob`() = runBlocking {
        val storage = FakeSecretStorage().apply { put("drive.tokens", "{not json") }
        assertNull(KeystoreTokenStore(storage).load())
    }

    @Test
    fun `keystore key provider sets locks and unlocks service keys`() = runBlocking {
        val storage = FakeSecretStorage()
        val provider = KeystoreKeyProvider(storage)

        assertFalse(provider.isUnlocked)
        assertNull(provider.apiKey(Service.GROQ))
        provider.unlock()
        assertTrue(provider.isUnlocked)
        assertNull(provider.apiKey(Service.GROQ))

        provider.setKey(Service.GROQ, "groq-key")
        provider.setKey(Service.GEMINI, "gemini-key")
        assertEquals("groq-key", provider.apiKey(Service.GROQ))
        assertEquals("gemini-key", provider.apiKey(Service.GEMINI))
        assertNull(provider.apiKey(Service.GEMMA))

        provider.lock()
        assertFalse(provider.isUnlocked)
        assertNull("no secrets in memory while locked", provider.apiKey(Service.GROQ))

        provider.unlock()
        assertEquals("rehydrated from storage", "groq-key", provider.apiKey(Service.GROQ))

        provider.setKey(Service.GROQ, null)
        assertNull(provider.apiKey(Service.GROQ))
    }

    // --- DriveApi --------------------------------------------------------------------

    private suspend fun driveApi(server: MockWebServer): OkHttpDriveApi {
        val store = FakeTokenStore().apply { stored = DriveTokens("at-1", Long.MAX_VALUE, "rt-1") }
        val o = DriveOAuth(
            config = OAuthConfig(
                nativeClientId = "client",
                tokenEndpoint = server.url("/token").toString(),
            ),
            tokenStore = store,
            pendingStore = FakePendingAuthStore(),
            httpClient = OkHttpClient(),
            now = { 1_000_000L },
        )
        return OkHttpDriveApi(
            oauth = o,
            httpClient = OkHttpClient(),
            filesBaseUrl = server.url("/drive/files").toString(),
            uploadBaseUrl = server.url("/upload/files").toString(),
        )
    }

    private fun folderResponse(folderId: String) =
        MockResponse().setBody("""{"files":[{"id":"$folderId","name":"pages"}]}""")

    @Test
    fun `drive api refreshes and retries once on 401`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val store = FakeTokenStore().apply { stored = DriveTokens("at-old", 2_000_000L, "rt-1") }
            val o = DriveOAuth(
                config = OAuthConfig(nativeClientId = "client", tokenEndpoint = server.url("/token").toString()),
                tokenStore = store,
                pendingStore = FakePendingAuthStore(),
                httpClient = OkHttpClient(),
                now = { 1_000_000L },
            )
            val api = OkHttpDriveApi(
                oauth = o,
                httpClient = OkHttpClient(),
                filesBaseUrl = server.url("/drive/files").toString(),
                uploadBaseUrl = server.url("/upload/files").toString(),
            )
            server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":"unauthorized"}"""))
            server.enqueue(MockResponse().setBody("""{"access_token":"at-new","expires_in":3600}"""))
            server.enqueue(MockResponse().setBody("hello"))

            assertEquals("hello", api.downloadText("file-1"))

            val first = server.takeRequest()
            val refresh = server.takeRequest()
            val retry = server.takeRequest()
            assertEquals("Bearer at-old", first.getHeader("Authorization"))
            assertTrue(refresh.body.readUtf8().contains("grant_type=refresh_token"))
            assertEquals("Bearer at-new", retry.getHeader("Authorization"))
            assertEquals("at-new", store.stored?.accessToken)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `drive api lists a folder with pagination`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = driveApi(server)
            server.enqueue(folderResponse("folder-1"))
            server.enqueue(
                MockResponse().setBody(
                    """{"files":[{"id":"f1","name":"page-a.json","headRevisionId":"r1"},{"id":"f2","name":"page-b.json","headRevisionId":"r2"}],"nextPageToken":"tok-2"}""",
                ),
            )
            server.enqueue(
                MockResponse().setBody("""{"files":[{"id":"f3","name":"page-c.json","headRevisionId":"r3"}]}"""),
            )

            val page = api.listFolder(DriveFolder.PAGES)
            assertEquals(3, page.files.size)
            assertEquals(listOf("page-a.json", "page-b.json", "page-c.json"), page.files.map { it.name })
            assertEquals(null, page.nextPageToken)

            val folderReq = server.takeRequest()
            assertTrue(folderReq.path!!.contains("appDataFolder"))
            assertTrue(folderReq.path!!.contains("pages"))
            val list1 = server.takeRequest()
            assertTrue(list1.path!!.contains("folder-1"))
            assertTrue(list1.path!!.contains("pageSize=1000"))
            val list2 = server.takeRequest()
            assertTrue(list2.path!!.contains("pageToken=tok-2"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `drive api finds a file by name and returns null when absent`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = driveApi(server)
            server.enqueue(folderResponse("folder-1"))
            server.enqueue(MockResponse().setBody("""{"files":[{"id":"f1","name":"page-a.json","headRevisionId":"r9"}]}"""))
            server.enqueue(MockResponse().setBody("""{"files":[]}"""))

            val found = api.findInFolder(DriveFolder.PAGES, "page-a.json")
            assertEquals("f1", found?.id)
            assertEquals("r9", found?.headRevisionId)
            server.takeRequest() // the ensureFolder list call
            val findReq = server.takeRequest()
            assertTrue(findReq.path!!.contains("page-a.json"))
            assertTrue(findReq.path!!.contains("trashed%3Dfalse"))

            assertNull(api.findInFolder(DriveFolder.PAGES, "nope.json"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `drive api creates a page file via multipart and parses the metadata`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = driveApi(server)
            server.enqueue(folderResponse("folder-1"))
            server.enqueue(
                MockResponse().setBody("""{"id":"new-1","name":"page-abc.json","modifiedTime":"2026-08-19T00:00:00.000Z","headRevisionId":"r-new"}"""),
            )

            val meta = api.createTextFile(DriveFolder.PAGES, "page-abc.json", """{"version":2,"url":"https://x"}""")

            assertEquals("new-1", meta.id)
            assertEquals("r-new", meta.headRevisionId)
            val folderReq = server.takeRequest()
            assertTrue(folderReq.path!!.contains("name%3D%27pages%27"))
            val createReq = server.takeRequest()
            assertEquals("POST", createReq.method)
            assertTrue(createReq.path!!.contains("uploadType=multipart"))
            assertTrue(createReq.getHeader("Content-Type")!!.contains("multipart/related"))
            val body = createReq.body.readUtf8()
            assertTrue(body.contains("\"name\":\"page-abc.json\""))
            assertTrue(body.contains("\"parents\":[\"folder-1\"]"))
            assertTrue(body.contains("{\"version\":2,\"url\":\"https://x\"}"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `drive api update sends the If-Match CAS header`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = driveApi(server)
            server.enqueue(MockResponse().setBody("""{"id":"f1","name":"page-a.json","headRevisionId":"r2"}"""))

            val meta = api.updateFile("f1", """{"version":2}""", ifMatchRevision = "r1")

            assertEquals("r2", meta.headRevisionId)
            val req = server.takeRequest()
            assertEquals("PATCH", req.method)
            assertEquals("r1", req.getHeader("If-Match"))
            assertTrue(req.path!!.contains("uploadType=media"))
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `drive api maps 412 to Conflict, 403 to Forbidden, 404 to NotFound`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = driveApi(server)
            server.enqueue(MockResponse().setResponseCode(412).setBody("""{"error":"conditionNotMet"}"""))
            server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":"forbidden"}"""))
            server.enqueue(MockResponse().setResponseCode(404).setBody("Not Found"))

            val conflict = try {
                api.updateFile("f1", "x", ifMatchRevision = "r-old")
                null
            } catch (e: DriveException) {
                e
            }
            assertTrue("expected Conflict, got $conflict", conflict is DriveException.Conflict)

            val forbidden = try {
                api.downloadText("f1")
                null
            } catch (e: DriveException) {
                e
            }
            assertTrue("expected Forbidden, got $forbidden", forbidden is DriveException.Forbidden)

            val notFound = try {
                api.downloadText("gone")
                null
            } catch (e: DriveException) {
                e
            }
            assertTrue("expected NotFound, got $notFound", notFound is DriveException.NotFound)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `drive api uploads and downloads a blob`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = driveApi(server)
            server.enqueue(folderResponse("folder-1"))
            server.enqueue(MockResponse().setBody("""{"id":"blob-1","name":"frame-x.jpg"}"""))
            server.enqueue(MockResponse().setBody("fakejpeg").setHeader("Content-Type", "image/jpeg"))

            val uploaded = api.uploadBlob(DriveFolder.FRAMES, "frame-x.jpg", byteArrayOf(1, 2, 3), "image/jpeg")
            assertEquals("blob-1", uploaded.id)
            server.takeRequest() // the ensureFolder list call
            val uploadReq = server.takeRequest()
            assertTrue(uploadReq.path!!.contains("uploadType=multipart"))
            assertTrue(uploadReq.body.readUtf8().contains("\"name\":\"frame-x.jpg\""))

            val blob = api.downloadBlob("blob-1")
            assertEquals("fakejpeg", String(blob.bytes))
            assertEquals("image/jpeg", blob.mimeType)
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `drive api wipeAppData deletes every root child and returns the count`() = runBlocking {
        val server = MockWebServer()
        server.start()
        try {
            val api = driveApi(server)
            server.enqueue(MockResponse().setBody("""{"files":[{"id":"folder-1"},{"id":"legacy.json"}],"nextPageToken":"t2"}"""))
            server.enqueue(MockResponse().setBody("""{"files":[{"id":"folder-2"}]}"""))
            server.enqueue(MockResponse().setResponseCode(204))
            server.enqueue(MockResponse().setResponseCode(204))
            server.enqueue(MockResponse().setResponseCode(204))

            val count = api.wipeAppData()

            assertEquals(3, count)
            val lists = (0 until 2).map { server.takeRequest() }
            assertTrue(lists.all { it.method == "GET" })
            val deletes = (0 until 3).map { server.takeRequest() }
            assertTrue(deletes.all { it.method == "DELETE" })
            assertEquals(listOf("folder-1", "legacy.json", "folder-2"), deletes.map { it.path!!.removePrefix("/drive/files/") })
        } finally {
            server.shutdown()
        }
    }
}