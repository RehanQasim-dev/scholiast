# 16-drive-oauth-keystore — Agent log

Log entries appended while working on this task (see README.md, "Agent logging protocol").

## [2026-08-19 18:55] task-16 agent
- **What I learned:**
  - Task 17 has NOT written anything yet (`domain/sync/` absent) — coded against task.md's
    DriveApi surface; Task 17's task.md says it fakes "Task 16's interface", so `DriveApi` is
    an interface with an `OkHttpDriveApi` impl.
  - The desktop's `google-drive.ts` is the wire contract: appdata folder ids resolved via
    `q: name='X' and mimeType='application/vnd.google-apps.folder'`, files listed with
    `fields=nextPageToken,files(id,name,modifiedTime,headRevisionId)`, multipart uploads with
    `multipart/related` (NOT form-data), media PATCH for updates, `If-Match` CAS on
    headRevisionId, 401 → invalidate + refresh + retry once.
  - Custom-scheme redirect note from plan §5.8.1: "custom URI scheme" must be enabled in the
    Google OAuth client's Advanced settings (2023 restriction).
  - `oauth.local.example.json` field names: `webClientId`, `nativeClientId`,
    `nativeClientSecret` — mirrored into `OAuthConfig`. Placeholders make `isConfigured=false`
    (build works unconfigured, like the desktop's empty-injection builds).
  - androidx customtabs live in artifact `androidx.browser:browser` (there is no
    `customtabs` artifact); 1.8.0 stable resolves from dl.google.com.
  - PKCE RFC 7636: verifier must be 43–128 chars. Task.md says "128 bytes" — 128 raw bytes
    base64url = 170 chars (invalid). Implemented 96 random bytes → **exactly 128 chars**
    (the RFC max), tested against the RFC 7636 Appendix B known vector.
  - Existing test style: JUnit4 + MockWebServer, backtick test names, `runBlocking`, manual
    server enqueue/shutdown.
- **Decisions made:**
  - All files in `domain/sync/drive/` per task.md (orchestrator's `domain/auth/` is overridden
    by task.md's explicit file list).
  - `TokenStore` is an interface (`save/load/clear`) + `KeystoreTokenStore` (logic over a
    `SecretStorage` seam) + `AndroidKeyStoreSecretStorage` (AES-256-GCM key in AndroidKeyStore,
    ciphertext+IV in SharedPreferences `scholiast_secrets`). JVM tests fake `SecretStorage` —
    the keystore itself is only exercisable on-device (instrumented test provided).
  - `KeystoreKeyProvider` implements Task 10's `ApiKeyProvider` (GROQ/GEMINI/GEMMA) with
    explicit `unlock()`/`lock()` (in-memory cache of decrypted values; `apiKey()` returns null
    while locked). Task 19 should call `unlock()` on app start and wire `setKey` to its fields.
  - PKCE pending state (verifier+state) persisted in a temp pref (`oauth_pending`) keyed by
    state; redirect result also persisted there (`oauth_redirect:<state>`), so a process kill
    during the Custom Tab round-trip recovers: `awaitRedirect` polls the pref while the
    in-memory `OAuthRedirects` bus covers the same-process case. Single-flight per connect.
  - OAuth redirect URI: `scholiast://oauth2redirect` (task.md's example). `OAuthRedirectActivity`
    (in DriveOAuth.kt) is the catch-all; manifest entry is Task 01's — exact XML in this log.
  - No OAuth values injected at build time (build.gradle.kts is another task's file) —
    `OAuthConfig` holds placeholder defaults (mirroring `oauth.local.example.json`); runtime
    override via constructor. Build-time injection from `oauth.local.json` left to the
    integration pass.
  - Added `androidx.browser:browser:1.8.0` to libs.versions.toml + app/build.gradle.kts
    (needed for CustomTabsIntent; precedent: Task 11's ndk/cmake edits to the same file).
  - 401 handling: `DriveApi` invalidates the cached access token (keeps refresh token, mirrors
    desktop `expiresAt: 0` trick) and re-mints once; failure maps to `DriveException.Unauthorized`.
  - Typed errors: `OAuthException` (NotConfigured/NotConnected/UserDenied/StateMismatch/NoCode/
    TokenRequestFailed/Network/Timeout) and `DriveException` (Unauthorized/Forbidden/NotFound/
    Conflict(412)/Http/Network).
- **Open questions:**
  - Manifest entry below must be applied by Task 01 (or integration) for the redirect to land.
  - Whether real client ids should be injected at build time from `../oauth.local.json`
    (like the desktop webpack build) or typed at runtime in Settings — left open for Task 19.
- **Progress:**
  - Wrote OAuthConfig.kt (config + Pkce S256), TokenStore.kt (TokenStore/PendingAuthStore/
    SecretStorage + Keystore impls), KeystoreKeyProvider.kt, DriveOAuth.kt (flow + Custom Tab +
    OAuthRedirectActivity), DriveApi.kt (interface + OkHttpDriveApi), DriveOAuthTest.kt (JVM),
    KeystoreStorageTest.kt (androidTest, compiled not run).
  - Verified: `:app:assembleDebug` clean, `:app:testDevDebugUnitTest` all green.

### Manifest additions Task 01 must apply (OAuthRedirectActivity)
```xml
<activity
    android:name=".domain.sync.drive.OAuthRedirectActivity"
    android:exported="true"
    android:launchMode="singleTask"
    android:theme="@android:style/Theme.NoDisplay"
    android:excludeFromRecents="true">
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="scholiast" android:host="oauth2redirect" />
    </intent-filter>
</activity>
```
Register `scholiast://oauth2redirect` as an Authorized redirect URI on the **native/installed-app
OAuth client** and enable "Custom URI scheme" in its Advanced settings (plan §5.8.1).

### Manual test steps (Custom Tab round-trip, not CI-testable)
1. Settings → Sync → Connect (Task 19 wires this to `DriveOAuth.connect(context)`).
2. Consent page opens in the Custom Tab → approve → redirect to `scholiast://oauth2redirect?code=…&state=…`.
3. `OAuthRedirectActivity` catches it (needs the manifest entry) → `DriveOAuth.complete()` exchanges
   and stores tokens; Settings shows Connected.
4. Kill the app while the tab is open → approve anyway → relaunch → `connect()`/`resume` path
   recovers from the persisted `oauth_redirect:<state>` pref and completes.
5. Disconnect revokes the token (best-effort) and clears the store.
## [2026-08-20 00:52] task-16 agent (continued — verification round)
- **Context:** The previous session's main files had been wiped from the tree (only the test
  survived); they were re-created in this session. Task 17 (00:18–00:22) and Task 18 (00:29–00:34)
  landed in `domain/sync/` meanwhile, so `OkHttpDriveApi` implements **Task 16's own**
  `domain/sync/drive/DriveApi` (test contract: `DriveBlob(bytes, mimeType)`, `DrivePage`) and a thin
  adapter `SyncEngineDriveApi : com.scholiast.android.domain.sync.DriveApi` maps `DriveException.Conflict
  → SyncConflictException` for Task 17's consumer interface (return-type clash prevents implementing
  both with one class; Task 17's hand-off note explicitly allowed a "thin adapter in Task 16's package").
- **Concurrency incident:** Task 18's agent quarantined my `drive/` dir to
  `/tmp/opencode/task18/quarantine/drive/` (twice: 00:35, 00:40 — its watcher sweeps
  `main/.../domain/sync/drive/` while it runs). Files were restored byte-identical; verification was
  done in an isolated copy at `/tmp/opencode/task16-verify/android` (rsync of `android/`, my files +
  test copied in) so the two agents' builds can't interfere. Final restore to the tree done at 00:48;
  if the watcher sweeps again, the files are intact in `/tmp/opencode/task16-backup/`.
- **Bugs found & fixed (all Task-16 files):**
  - `DriveOAuth.kt`: Kotlin requires constructor parens on exceptions — `throw OAuthException.X` →
    `X()` for `NoCode`, `NotConfigured`, `NotConnected` (×2), `StateMismatch`, `UserDenied`,
    `Timeout` (7 spots).
  - `DriveApi.kt`: `authed()` called the suspend `oauth.getAccessToken()` inside a non-suspend
    `execute { }` lambda → hoisted token fetch out of the lambda (both the first call and the 401
    retry); `buildJsonArray { add("appDataFolder") / add(parent) }` → `add(JsonPrimitive(...))`
    (3 spots) + `import JsonPrimitive`.
  - `DriveOAuthTest.kt`: MockWebServer `takeRequest()` order — `ensureFolder`/list requests precede
    the request under test in `findInFolder`, `uploadBlob` (skip one), `wipeAppData` (assert the 2
    list GETs before the 3 DELETEs); dropped `RecordedRequest.code` (doesn't exist — 401 is implied
    by enqueue order); removed a now-superfluous second `folderResponse` enqueue that the folder-id
    cache (per-instance, by design) leaked into the second `findInFolder`.
- **Verification (isolated copy, fresh daemon, `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`):**
  - `:app:assembleDebug` → BUILD SUCCESSFUL.
  - `:app:testDevDebugUnitTest` → `DriveOAuthTest`: 35/35 pass (PKCE vector, full OAuth flows,
    token store round-trips, drive-api MockWebServer tests incl. 401-refresh-retry, wipeAppData).
  - `:app:compileDevDebugAndroidTestKotlin` → BUILD SUCCESSFUL (`KeystoreStorageTest` compiles
    against my classes; it's on-device, runtime not run here).
  - Remaining failures are **Task 18's own** `SyncSchedulerTest`/`SyncStatusRepositoryTest` (their
    state machine emits only `[IDLE, IDLE]`; unrelated to `domain.sync.drive` — noted for Task 18).
- **Open hand-offs:** manifest entry + launcher activity for `OAuthRedirectActivity` = Task 01's
  file; `connect()` wiring + Settings button = Task 19; `SyncEngineDriveApi` adoption (swap
  `SyncGraph.engineFactory`) = integration. `disconnect()` is best-effort revoke
  (POST `?token=`, errors swallowed). `awaitRedirect` uses wall-clock, not the injected `now`.
