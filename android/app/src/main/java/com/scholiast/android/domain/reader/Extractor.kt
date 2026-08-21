package com.scholiast.android.domain.reader

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.dankito.readability4j.Article
import net.dankito.readability4j.extended.Readability4JExtended
import net.dankito.readability4j.extended.processor.PostprocessorExtended
import net.dankito.readability4j.extended.util.RegExUtilExtended
import net.dankito.readability4j.model.ReadabilityOptions
import net.dankito.readability4j.processor.MetadataParser
import net.dankito.readability4j.processor.Preprocessor
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.nodes.Element
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.charset.Charset
import java.util.concurrent.TimeUnit

/**
 * Fetches a URL and runs it through the Read You extended Readability pipeline
 * (OkHttp fetch + ICU charset fallback -> Readability4JExtended -> article Element).
 * Pure JVM: no android.util.Log anywhere on this path.
 */
sealed interface ExtractResult {
    /** Clean article DOM ready for linearization (Task 26 consumes [article]). */
    data class Success(val article: Element, val title: String?, val byline: String?) : ExtractResult

    /** Page fetched fine but holds no real article (CSR/garbage/paywall stub) -> WebView fallback. */
    data class Shell(val reason: String) : ExtractResult

    /** Network or HTTP failure -> error card. */
    data class Failed(val error: String) : ExtractResult
}

class Extractor(private val baseClient: OkHttpClient) {

    suspend fun extract(url: String): ExtractResult = withContext(Dispatchers.IO) {
        val request = try {
            Request.Builder()
                .url(url)
                .header("User-Agent", USER_AGENT)
                .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
                .header("Accept-Language", "en-US,en;q=0.9")
                .build()
        } catch (e: IllegalArgumentException) {
            return@withContext ExtractResult.Failed("Invalid URL: ${e.message}")
        }

        // Spec'd 15s budgets regardless of what the shared client was built with.
        val client = baseClient.newBuilder()
            .connectTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .readTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .writeTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .callTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()

        val response = try {
            client.newCall(request).execute()
        } catch (e: IOException) {
            return@withContext ExtractResult.Failed("Network error: ${e.message ?: e.javaClass.simpleName}")
        }

        response.use { resp ->
            if (resp.isSuccessful.not()) {
                return@use ExtractResult.Failed("HTTP ${resp.code} for $url")
            }
            val body = resp.body ?: return@use ExtractResult.Failed("Empty response body for $url")
            val bytes = try {
                readCapped(body.byteStream(), MAX_BYTES)
            } catch (e: IOException) {
                return@use ExtractResult.Failed("Read error: ${e.message ?: e.javaClass.simpleName}")
            }
            extractArticle(url, decodeHtml(bytes, body.contentType()?.charset()))
        }
    }

    private fun extractArticle(url: String, html: String): ExtractResult {
        val article: Article = try {
            buildReader(url, html).parse()
        } catch (e: Exception) {
            return ExtractResult.Shell("Extraction failed: ${e.message ?: e.javaClass.simpleName}")
        }
        val content = article.articleContent
            ?: return ExtractResult.Shell("No article content found on $url")

        val textLength = content.text().trim().length
        val textBlocks = content.select("p").size
        return if (textLength < MIN_TEXT_CHARS || textBlocks < MIN_TEXT_BLOCKS) {
            ExtractResult.Shell("Thin content on $url ($textLength chars, $textBlocks blocks)")
        } else {
            ExtractResult.Success(content, article.title?.trim(), article.byline?.trim())
        }
    }

    // Mirrors Read You infrastructure/html/Readability.kt wiring: the extended reader with our
    // vendored grabber injected so DIV-wrapped paragraphs survive scoring.
    private fun buildReader(uri: String, html: String): Readability4JExtended {
        val options = ReadabilityOptions()
        val regExUtil = RegExUtilExtended()
        return Readability4JExtended(
            uri = uri,
            html = html,
            options = options,
            regExUtil = regExUtil,
            preprocessor = Preprocessor(regExUtil),
            metadataParser = MetadataParser(regExUtil),
            articleGrabber = RYArticleGrabberExtended(options, regExUtil),
            postprocessor = PostprocessorExtended(),
        )
    }

    /**
     * Header charset wins unless it lies (decodes to U+FFFD) or is absent — then ICU detects
     * from the bytes (Feeder pattern). android.icu only exists on-device; on the JVM test
     * classpath its stub throws, and we fall back to the header/UTF-8.
     */
    private fun decodeHtml(bytes: ByteArray, declared: Charset?): String {
        val decoded = String(bytes, declared ?: Charsets.UTF_8)
        return if (declared != null && !decoded.contains(REPLACEMENT_CHAR)) {
            decoded
        } else {
            detectCharset(bytes)?.let { String(bytes, it) } ?: decoded
        }
    }

    /**
     * android.icu.text.CharsetDetector is a hidden libcore API (absent from the public
     * android.jar and from the JVM test classpath), so it is reached reflectively: real
     * platform ICU on-device, null elsewhere -> header/UTF-8 stays authoritative.
     */
    private fun detectCharset(bytes: ByteArray): Charset? = try {
        val cls = Class.forName("android.icu.text.CharsetDetector")
        val detector = cls.getDeclaredConstructor().newInstance()
        cls.getMethod("setText", InputStream::class.java)
            .invoke(detector, ByteArrayInputStream(bytes))
        val match = cls.getMethod("detect").invoke(detector) ?: return null
        val name = match.javaClass.getMethod("getName").invoke(match) as? String
        name?.let { Charset.forName(it) }
    } catch (_: Throwable) {
        null
    }

    private fun readCapped(input: InputStream, maxBytes: Int): ByteArray {
        input.use { stream ->
            val out = ByteArrayOutputStream(minOf(maxBytes, 256 * 1024))
            val buf = ByteArray(64 * 1024)
            var read: Int
            while (stream.read(buf).also { read = it } != -1) {
                if (out.size() + read > maxBytes) {
                    out.write(buf, 0, maxBytes - out.size())
                    break
                }
                out.write(buf, 0, read)
            }
            return out.toByteArray()
        }
    }

    private companion object {
        const val TIMEOUT_SECONDS = 15L
        const val MAX_BYTES = 3 * 1024 * 1024
        const val MIN_TEXT_CHARS = 200
        const val MIN_TEXT_BLOCKS = 3
        const val REPLACEMENT_CHAR = '\uFFFD'
        const val USER_AGENT =
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Chrome/126.0.0.0 Safari/537.36"
    }
}
