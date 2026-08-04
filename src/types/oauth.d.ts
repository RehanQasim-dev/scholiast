// Google OAuth client values, injected at build time by webpack's DefinePlugin from
// `oauth.local.json` or the GOOGLE_OAUTH_* environment variables.
//
// They are not committed: the desktop-app client *secret* has to ship inside the
// extension (Google's token endpoint rejects the exchange without it), but shipping
// it and publishing it in a public repository are different things — a published
// secret gets scraped, and GitHub blocks the push. See oauth.local.example.json.
//
// A build with no config defines them as empty strings, which surfaces as
// "sync not configured" rather than a compile error.

declare const OAUTH_WEB_CLIENT_ID: string;
declare const OAUTH_NATIVE_CLIENT_ID: string;
declare const OAUTH_NATIVE_CLIENT_SECRET: string;
