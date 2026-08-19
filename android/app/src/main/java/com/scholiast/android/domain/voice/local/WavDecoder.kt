package com.scholiast.android.domain.voice.local

import java.io.File
import java.io.IOException

/**
 * Pure wav→f32 decoder (JVM-testable, no Android deps).
 *
 * Reads the RIFF chunks and converts PCM samples to the float-normalized [-1, 1) format the
 * whisper engine expects. Handles the WAVs our own [com.scholiast.android.ui.voice.WavWriter]
 * produces (16 kHz mono 16-bit PCM) plus stereo 16-bit (left channel only) and 32-bit float.
 * Anything else (A-law, mu-law, compressed) → [WavFormatException] with a user-facing message.
 */
object WavDecoder {

    /** Thrown when the file isn't a PCM WAV we can feed to whisper. */
    class WavFormatException(message: String) : IOException(message)

    /** Decode [file] to 16 kHz mono float samples. */
    fun decode(file: File): FloatArray = decode(file.readBytes())

    fun decode(bytes: ByteArray): FloatArray {
        require(bytes.size >= 44) { "Not a WAV file (too short)" }
        require(String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF") { "Not a RIFF file" }
        require(String(bytes, 8, 4, Charsets.US_ASCII) == "WAVE") { "Not a WAVE file" }

        var offset = 12
        var audioFormat = -1
        var channels = -1
        var sampleRate = -1
        var bitsPerSample = -1
        var dataOffset = -1
        var dataSize = 0

        while (offset + 8 <= bytes.size) {
            val chunkId = String(bytes, offset, 4, Charsets.US_ASCII)
            val chunkSize = leInt(bytes, offset + 4)
            val chunkStart = offset + 8
            if (chunkSize < 0 || chunkStart + chunkSize > bytes.size) break

            when (chunkId) {
                "fmt " -> {
                    audioFormat = leShort(bytes, chunkStart)
                    channels = leShort(bytes, chunkStart + 2)
                    sampleRate = leInt(bytes, chunkStart + 4)
                    bitsPerSample = leShort(bytes, chunkStart + 14)
                }
                "data" -> {
                    dataOffset = chunkStart
                    dataSize = chunkSize
                }
            }
            offset = chunkStart + chunkSize + (chunkSize % 2) // chunks are word-aligned
        }

        if (dataOffset < 0) throw WavFormatException("WAV has no data chunk")
        if (audioFormat !in intArrayOf(1, 3)) {
            throw WavFormatException("Unsupported WAV encoding (format $audioFormat); need PCM or IEEE float")
        }
        if (channels <= 0 || sampleRate <= 0) {
            throw WavFormatException("WAV has no valid format chunk")
        }

        val sampleBytes = bitsPerSample / 8
        if (sampleBytes <= 0) throw WavFormatException("Unsupported bits per sample: $bitsPerSample")

        val count = dataSize / (sampleBytes * channels)
        val samples = FloatArray(count)

        for (i in 0 until count) {
            val base = dataOffset + i * sampleBytes * channels
            val value = when (audioFormat) {
                1 -> { // PCM
                    when (bitsPerSample) {
                        8 -> (bytes[base].toInt() and 0xFF) / 128f - 1f
                        16 -> {
                            val s = leShort(bytes, base)
                            s.toFloat() / Short.MAX_VALUE.toFloat()
                        }
                        else -> throw WavFormatException("Unsupported PCM bit depth: $bitsPerSample")
                    }
                }
                else -> { // 3 = IEEE float (32-bit)
                    if (bitsPerSample != 32) throw WavFormatException("Unsupported float bit depth: $bitsPerSample")
                    java.nio.ByteBuffer.wrap(bytes, base, 4).order(java.nio.ByteOrder.LITTLE_ENDIAN).float
                }
            }
            samples[i] = value
        }

        return samples
    }

    private fun leShort(bytes: ByteArray, offset: Int): Int {
        val lo = bytes[offset].toInt() and 0xFF
        val hi = bytes[offset + 1].toInt() and 0xFF
        return ((hi shl 8) or lo).toShort().toInt()
    }

    private fun leInt(bytes: ByteArray, offset: Int): Int {
        return (bytes[offset].toInt() and 0xFF) or
            ((bytes[offset + 1].toInt() and 0xFF) shl 8) or
            ((bytes[offset + 2].toInt() and 0xFF) shl 16) or
            ((bytes[offset + 3].toInt() and 0xFF) shl 24)
    }
}