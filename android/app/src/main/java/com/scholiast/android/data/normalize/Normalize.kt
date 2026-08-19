package com.scholiast.android.data.normalize

import java.net.URI
import java.security.MessageDigest
import java.io.ByteArrayOutputStream

/**
 * URL handling ported from the desktop repo so the app stores and references
 * pages exactly the same way as the extension and the Obsidian plugin.
 *
 * Sources:
 *  - `shared/url.ts`  — `normalizeUrl` + `EPHEMERAL_PARAMS` (the canonical,
 *    dependency-free copy shared by every desktop client)
 *  - `shared/merge.ts:371` — `pageFileName` (SHA-256 of the NORMALIZED url,
 *    first 16 bytes, lowercase hex, `page-<hex>.json` under `pages/`)
 *  - `src/utils/video/youtube-detect.ts` / `yt-transcript-extractor.ts` —
 *    videoId extraction (`v` param, youtu.be path, `/shorts/`), extended per
 *    the app plan with `/embed/` and `/live/`, and null for non-YouTube URLs.
 *
 * Known, deliberate divergences from WHATWG `new URL()` (java.net.URI is the
 * base parser — see task LOG.md):
 *  - A URL that URI rejects (e.g. a raw space in the path) is returned
 *    unchanged, where WHATWG would percent-encode it.
 *  - IPv6 host compression (`[0:0:0:0:0:0:0:1]` stays uncompressed) and
 *    IDN→punycode are not performed.
 * These only surface on malformed/unusual URLs; page tab URLs are unaffected.
 */
object Normalize {

    /** Byte-identical to `EPHEMERAL_PARAMS` in `shared/url.ts` (20 params). */
    private val EPHEMERAL_PARAMS = setOf(
        "t", // YouTube timestamp
        "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", // UTM tracking
        "ref", "ref_src", "source", "src", // Referral
        "fbclid", "gclid", "dclid", "msclkid", "twclid", // Ad click IDs
        "mc_cid", "mc_eid", // Mailchimp
        "_ga", "_gl", // Google Analytics
        "si", // YouTube share tracking
    )

    private const val PAGE_PREFIX = "page-"
    private const val PAGE_SUFFIX = ".json"

    /** Drive appdata folder holding one page record per normalized URL. */
    const val PAGES_FOLDER = "pages"

    private const val HEX = "0123456789ABCDEF"

    private val YOUTUBE_HOSTS = setOf("youtube.com", "www.youtube.com", "m.youtube.com")

    /**
     * Canonical URL for storage keys, Drive files and sync. Strips the fragment
     * and the ephemeral params above; everything else is kept byte-identical to
     * the WHATWG serialization the TS produces (scheme/host lowercased, default
     * port dropped, empty path → `/`, dot segments resolved, query params
     * preserved in order and re-encoded exactly like `URLSearchParams`).
     * Returns the input unchanged when it cannot be parsed (matches the TS
     * try/catch).
     */
    fun normalizeUrl(url: String): String {
        val uri = try {
            URI(url)
        } catch (e: Exception) {
            return url
        }
        val scheme = uri.scheme?.lowercase() ?: return url
        val host = uri.host?.lowercase() ?: return url

        val port = uri.port
        val portOut = if (port > 0 && !isDefaultPort(scheme, port)) port else null

        val rawPath = uri.normalize().rawPath
        val path = if (rawPath.isEmpty()) "/" else rawPath

        val query = filterQuery(uri.rawQuery)

        val sb = StringBuilder(url.length + 8)
        sb.append(scheme).append("://")
        uri.rawUserInfo?.let { sb.append(it).append('@') }
        sb.append(host)
        if (portOut != null) sb.append(':').append(portOut)
        sb.append(path)
        if (query.isNotEmpty()) sb.append('?').append(query)
        return sb.toString()
    }

    /**
     * Extracts the YouTube video id from any common URL form:
     * `watch?v=`, `youtu.be/<id>`, `/shorts/<id>`, `/embed/<id>`, `/live/<id>`.
     * Returns null for non-YouTube hosts, unparseable URLs, or URLs without an
     * id. Lenient like the desktop code — no 11-char format validation.
     */
    fun extractVideoId(url: String): String? {
        val uri = try {
            URI(url)
        } catch (e: Exception) {
            return null
        }
        val host = uri.host?.lowercase() ?: return null
        val path = uri.rawPath ?: ""
        return when {
            host == "youtu.be" ->
                path.trim('/').substringBefore('/').takeIf { it.isNotEmpty() }
            host in YOUTUBE_HOSTS -> when {
                path == "/watch" -> queryValue(uri.rawQuery, "v")?.takeIf { it.isNotEmpty() }
                path.startsWith("/shorts/") -> path.removePrefix("/shorts/").substringBefore('/').takeIf { it.isNotEmpty() }
                path.startsWith("/embed/") -> path.removePrefix("/embed/").substringBefore('/').takeIf { it.isNotEmpty() }
                path.startsWith("/live/") -> path.removePrefix("/live/").substringBefore('/').takeIf { it.isNotEmpty() }
                else -> null
            }
            else -> null
        }
    }

    /**
     * SHA-256 of the url string (UTF-8), first 16 bytes, lowercase hex — the
     * exact prefix scheme `shared/merge.ts:pageFileName` uses for Drive file
     * names. Callers MUST pass the NORMALIZED url (the desktop repo hashes the
     * url as given; it never normalizes inside the hash).
     */
    fun urlHash(url: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(url.toByteArray(Charsets.UTF_8))
        return digest.take(16).joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    }

    /** `page-<urlhash>.json` — byte-identical to the TS `pageFileName`. */
    fun pageFileName(url: String): String = PAGE_PREFIX + urlHash(url) + PAGE_SUFFIX

    /** Full Drive appdata path: `pages/page-<urlhash>.json`. */
    fun pageFilePath(url: String): String = "$PAGES_FOLDER/$PAGE_PREFIX${urlHash(url)}$PAGE_SUFFIX"

    private fun isDefaultPort(scheme: String, port: Int): Boolean =
        (scheme == "http" && port == 80) || (scheme == "https" && port == 443)

    /**
     * Filters the ephemeral params and re-serializes the rest exactly like
     * WHATWG `URLSearchParams` (`new URLSearchParams(parsed.search)` → delete →
     * `toString()`): name/value pairs percent-encoded with the
     * application/x-www-form-urlencoded set, space → `+`, everything except
     * alphanumerics and `* - . _` encoded, uppercase hex, original order kept.
     */
    private fun filterQuery(rawQuery: String?): String {
        if (rawQuery == null || rawQuery.isEmpty()) return ""
        return rawQuery.split('&')
            .filter { it.isNotEmpty() }
            .mapNotNull { pair ->
                val eq = pair.indexOf('=')
                val rawName = if (eq == -1) pair else pair.substring(0, eq)
                val rawValue = if (eq == -1) "" else pair.substring(eq + 1)
                val name = formDecode(rawName)
                if (name in EPHEMERAL_PARAMS) null
                else formEncode(name) + "=" + formEncode(formDecode(rawValue))
            }
            .joinToString("&")
    }

    private fun queryValue(rawQuery: String?, key: String): String? {
        if (rawQuery == null || rawQuery.isEmpty()) return null
        for (pair in rawQuery.split('&')) {
            val eq = pair.indexOf('=')
            val name = if (eq == -1) pair else pair.substring(0, eq)
            val value = if (eq == -1) "" else pair.substring(eq + 1)
            if (formDecode(name) == key) return formDecode(value)
        }
        return null
    }

    /** application/x-www-form-urlencoded encode: alnum + `*-._` safe, space → `+`. */
    private fun formEncode(s: String): String {
        val sb = StringBuilder(s.length)
        for (b in s.toByteArray(Charsets.UTF_8)) {
            val v = b.toInt() and 0xff
            when {
                v in 'a'.code..'z'.code || v in 'A'.code..'Z'.code || v in '0'.code..'9'.code ||
                    v == '*'.code || v == '-'.code || v == '.'.code || v == '_'.code -> sb.append(v.toChar())
                v == ' '.code -> sb.append('+')
                else -> sb.append('%').append(HEX[v ushr 4]).append(HEX[v and 0xf])
            }
        }
        return sb.toString()
    }

    /** application/x-www-form-urlencoded decode: `+` → space, `%XX` → byte, UTF-8. */
    private fun formDecode(s: String): String {
        val bytes = ByteArrayOutputStream(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '+' -> bytes.write(' '.code)
                c == '%' && i + 2 < s.length && isHex(s[i + 1]) && isHex(s[i + 2]) -> {
                    bytes.write(Integer.parseInt(s.substring(i + 1, i + 3), 16))
                    i += 2
                }
                c.code < 0x80 -> bytes.write(c.code)
                else -> {
                    val n = if (c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate()) 2 else 1
                    val charBytes = s.substring(i, i + n).toByteArray(Charsets.UTF_8)
                    bytes.write(charBytes, 0, charBytes.size)
                    if (n == 2) i++
                }
            }
            i++
        }
        return String(bytes.toByteArray(), Charsets.UTF_8)
    }

    private fun isHex(c: Char): Boolean =
        c in '0'..'9' || c in 'a'..'f' || c in 'A'..'F'
}