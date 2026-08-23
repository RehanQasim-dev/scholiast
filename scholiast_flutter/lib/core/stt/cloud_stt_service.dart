import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../auth/secure_token_store.dart';
import 'stt_models.dart';

/// High-speed cloud transcription service for Groq, OpenAI, and Google Gemini.
class CloudSttService {
  final Dio _dio;
  final SecureTokenStore? tokenStore;

  static const String groqTranscriptionsUrl =
      'https://api.groq.com/openai/v1/audio/transcriptions';
  static const String openAiTranscriptionsUrl =
      'https://api.openai.com/v1/audio/transcriptions';
  static const String geminiBaseUrl =
      'https://generativelanguage.googleapis.com';

  static const String defaultGroqModel = 'whisper-large-v3-turbo';
  static const String defaultOpenAiModel = 'whisper-1';
  static const String defaultGeminiModel = 'gemini-1.5-flash';

  static const String defaultGeminiPrompt =
      'Accurately transcribe the spoken audio recording verbatim. Output only the transcribed text without any timestamps, explanation, or markdown formatting.';

  CloudSttService({
    Dio? dio,
    this.tokenStore,
  }) : _dio = dio ??
            Dio(
              BaseOptions(
                connectTimeout: const Duration(seconds: 15),
                receiveTimeout: const Duration(seconds: 60),
                sendTimeout: const Duration(seconds: 60),
              ),
            );

  /// Transcribes audio bytes using Groq Whisper.
  Future<SttResult> transcribeGroq(
    Uint8List audioBytes, {
    String? apiKey,
    String model = defaultGroqModel,
    String? language,
    String? prompt,
    String fileName = 'audio.wav',
  }) async {
    final key = apiKey ?? await _getApiKey('groq');
    if (key == null || key.trim().isEmpty) {
      throw const SttException(
        SttErrorType.notConfigured,
        'Groq API key not found. Please set your Groq API key in Settings.',
        provider: SttProvider.groq,
      );
    }

    if (audioBytes.isEmpty) {
      return const SttResult(
        text: '',
        provider: SttProvider.groq,
        isFinal: true,
      );
    }

    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(audioBytes, filename: fileName),
      'model': model,
      'response_format': 'verbose_json',
      if (language != null && language.isNotEmpty && language != 'auto')
        'language': language,
      if (prompt != null && prompt.isNotEmpty) 'prompt': prompt,
    });

    try {
      final sw = Stopwatch()..start();
      final response = await _dio.post<dynamic>(
        groqTranscriptionsUrl,
        data: formData,
        options: Options(
          headers: {
            'Authorization': 'Bearer $key',
          },
        ),
      );
      sw.stop();

      return _parseOpenAiCompatibleResponse(
        response.data,
        provider: SttProvider.groq,
        elapsed: sw.elapsed,
      );
    } on DioException catch (e) {
      throw _mapDioError(e, SttProvider.groq);
    } catch (e) {
      if (e is SttException) rethrow;
      throw SttException(
        SttErrorType.unknown,
        'Unexpected Groq transcription error: $e',
        provider: SttProvider.groq,
        cause: e,
      );
    }
  }

  /// Transcribes audio bytes using OpenAI Whisper.
  Future<SttResult> transcribeOpenAi(
    Uint8List audioBytes, {
    String? apiKey,
    String model = defaultOpenAiModel,
    String? language,
    String? prompt,
    String fileName = 'audio.wav',
  }) async {
    final key = apiKey ?? await _getApiKey('openai');
    if (key == null || key.trim().isEmpty) {
      throw const SttException(
        SttErrorType.notConfigured,
        'OpenAI API key not found. Please set your OpenAI API key in Settings.',
        provider: SttProvider.openAi,
      );
    }

    if (audioBytes.isEmpty) {
      return const SttResult(
        text: '',
        provider: SttProvider.openAi,
        isFinal: true,
      );
    }

    final formData = FormData.fromMap({
      'file': MultipartFile.fromBytes(audioBytes, filename: fileName),
      'model': model,
      'response_format': 'verbose_json',
      if (language != null && language.isNotEmpty && language != 'auto')
        'language': language,
      if (prompt != null && prompt.isNotEmpty) 'prompt': prompt,
    });

    try {
      final sw = Stopwatch()..start();
      final response = await _dio.post<dynamic>(
        openAiTranscriptionsUrl,
        data: formData,
        options: Options(
          headers: {
            'Authorization': 'Bearer $key',
          },
        ),
      );
      sw.stop();

      return _parseOpenAiCompatibleResponse(
        response.data,
        provider: SttProvider.openAi,
        elapsed: sw.elapsed,
      );
    } on DioException catch (e) {
      throw _mapDioError(e, SttProvider.openAi);
    } catch (e) {
      if (e is SttException) rethrow;
      throw SttException(
        SttErrorType.unknown,
        'Unexpected OpenAI transcription error: $e',
        provider: SttProvider.openAi,
        cause: e,
      );
    }
  }

  /// Transcribes audio bytes using Google Gemini Generative Language API.
  Future<SttResult> transcribeGemini(
    Uint8List audioBytes, {
    String? apiKey,
    String model = defaultGeminiModel,
    String? prompt,
    String mimeType = 'audio/wav',
  }) async {
    final key = apiKey ?? await _getApiKey('gemini');
    if (key == null || key.trim().isEmpty) {
      throw const SttException(
        SttErrorType.notConfigured,
        'Gemini API key not found. Please set your Gemini API key in Settings.',
        provider: SttProvider.gemini,
      );
    }

    if (audioBytes.isEmpty) {
      return const SttResult(
        text: '',
        provider: SttProvider.gemini,
        isFinal: true,
      );
    }

    final url = '$geminiBaseUrl/v1beta/models/$model:generateContent?key=$key';
    final base64Audio = base64Encode(audioBytes);
    final promptText = prompt ?? defaultGeminiPrompt;

    final requestPayload = {
      'contents': [
        {
          'parts': [
            {
              'inlineData': {
                'mimeType': mimeType,
                'data': base64Audio,
              },
            },
            {
              'text': promptText,
            },
          ],
        },
      ],
    };

    try {
      final sw = Stopwatch()..start();
      final response = await _dio.post<dynamic>(
        url,
        data: requestPayload,
        options: Options(
          headers: {
            'Content-Type': 'application/json',
          },
        ),
      );
      sw.stop();

      return _parseGeminiResponse(
        response.data,
        elapsed: sw.elapsed,
      );
    } on DioException catch (e) {
      throw _mapDioError(e, SttProvider.gemini);
    } catch (e) {
      if (e is SttException) rethrow;
      throw SttException(
        SttErrorType.unknown,
        'Unexpected Gemini transcription error: $e',
        provider: SttProvider.gemini,
        cause: e,
      );
    }
  }

  /// Unified dispatcher for cloud transcription requests.
  Future<SttResult> transcribe(
    Uint8List audioBytes,
    SttProvider provider, {
    String? apiKey,
    String? model,
    String? language,
    String? prompt,
    String fileName = 'audio.wav',
    String mimeType = 'audio/wav',
  }) async {
    switch (provider) {
      case SttProvider.groq:
        return transcribeGroq(
          audioBytes,
          apiKey: apiKey,
          model: model ?? defaultGroqModel,
          language: language,
          prompt: prompt,
          fileName: fileName,
        );
      case SttProvider.openAi:
        return transcribeOpenAi(
          audioBytes,
          apiKey: apiKey,
          model: model ?? defaultOpenAiModel,
          language: language,
          prompt: prompt,
          fileName: fileName,
        );
      case SttProvider.gemini:
        return transcribeGemini(
          audioBytes,
          apiKey: apiKey,
          model: model ?? defaultGeminiModel,
          prompt: prompt,
          mimeType: mimeType,
        );
      case SttProvider.localWhisper:
        throw const SttException(
          SttErrorType.invalidAudio,
          'CloudSttService cannot process local Whisper requests directly',
          provider: SttProvider.localWhisper,
        );
    }
  }

  // --- Response Parsing ---

  SttResult _parseOpenAiCompatibleResponse(
    dynamic data, {
    required SttProvider provider,
    required Duration elapsed,
  }) {
    final map = data is Map<String, dynamic>
        ? data
        : (data is String ? jsonDecode(data) as Map<String, dynamic> : <String, dynamic>{});

    final text = (map['text'] as String? ?? '').trim();
    final language = map['language'] as String?;

    final segments = <SttWordTimestamp>[];
    if (map['segments'] is List) {
      for (final s in map['segments'] as List) {
        if (s is Map<String, dynamic>) {
          segments.add(SttWordTimestamp.fromJson(s));
        }
      }
    }

    final durationSeconds = (map['duration'] as num?)?.toDouble();
    final duration = durationSeconds != null
        ? Duration(milliseconds: (durationSeconds * 1000).toInt())
        : elapsed;

    return SttResult(
      text: text,
      language: language,
      duration: duration,
      provider: provider,
      timestamps: segments.isNotEmpty ? segments : null,
      isFinal: true,
      rawMetadata: map,
    );
  }

  SttResult _parseGeminiResponse(
    dynamic data, {
    required Duration elapsed,
  }) {
    final map = data is Map<String, dynamic>
        ? data
        : (data is String ? jsonDecode(data) as Map<String, dynamic> : <String, dynamic>{});

    final candidates = map['candidates'] as List<dynamic>?;
    if (candidates == null || candidates.isEmpty) {
      final promptFeedback = map['promptFeedback'] as Map<String, dynamic>?;
      final blockReason = promptFeedback?['blockReason'] as String?;
      if (blockReason != null) {
        throw SttException(
          SttErrorType.invalidAudio,
          'Gemini audio transcription was blocked by safety policy: $blockReason',
          provider: SttProvider.gemini,
        );
      }
      throw const SttException(
        SttErrorType.serverError,
        'Gemini returned an empty candidate list',
        provider: SttProvider.gemini,
      );
    }

    final firstCandidate = candidates.first as Map<String, dynamic>;
    final content = firstCandidate['content'] as Map<String, dynamic>?;
    final parts = content?['parts'] as List<dynamic>?;

    final textBuffer = StringBuffer();
    if (parts != null) {
      for (final part in parts) {
        if (part is Map<String, dynamic>) {
          final text = part['text'] as String?;
          if (text != null && text.isNotEmpty) {
            textBuffer.write(text);
          }
        }
      }
    }

    final fullText = textBuffer.toString().trim();

    return SttResult(
      text: fullText,
      duration: elapsed,
      provider: SttProvider.gemini,
      isFinal: true,
      rawMetadata: map,
    );
  }

  // --- API Key & Error Handling ---

  Future<String?> _getApiKey(String provider) async {
    final store = tokenStore;
    if (store == null) return null;
    return store.getApiKey(provider);
  }

  SttException _mapDioError(DioException error, SttProvider provider) {
    final response = error.response;
    final statusCode = response?.statusCode;

    String? serverMessage;
    final resData = response?.data;
    if (resData != null) {
      if (resData is Map<String, dynamic>) {
        serverMessage = (resData['error'] is Map)
            ? resData['error']['message'] as String?
            : resData['message'] as String?;
      } else if (resData is String) {
        serverMessage = resData;
      }
    }

    if (statusCode == 401 || statusCode == 403) {
      return SttException(
        SttErrorType.unauthorized,
        serverMessage ?? 'Invalid API key or unauthorized request for ${provider.displayName}.',
        provider: provider,
        cause: error,
      );
    }

    if (statusCode == 429) {
      return SttException(
        SttErrorType.rateLimited,
        serverMessage ?? 'Rate limit exceeded for ${provider.displayName}. Please try again later.',
        provider: provider,
        cause: error,
      );
    }

    if (statusCode != null && statusCode >= 400 && statusCode < 500) {
      return SttException(
        SttErrorType.invalidAudio,
        serverMessage ?? 'Bad request (${provider.displayName} HTTP $statusCode).',
        provider: provider,
        cause: error,
      );
    }

    if (statusCode != null && statusCode >= 500) {
      return SttException(
        SttErrorType.serverError,
        serverMessage ?? 'Internal server error from ${provider.displayName} (HTTP $statusCode).',
        provider: provider,
        cause: error,
      );
    }

    if (error.type == DioExceptionType.connectionTimeout ||
        error.type == DioExceptionType.receiveTimeout ||
        error.type == DioExceptionType.sendTimeout ||
        error.type == DioExceptionType.connectionError) {
      return SttException(
        SttErrorType.network,
        'Network error connecting to ${provider.displayName}: ${error.message}',
        provider: provider,
        cause: error,
      );
    }

    return SttException(
      SttErrorType.unknown,
      serverMessage ?? error.message ?? 'Unknown communication error with ${provider.displayName}',
      provider: provider,
      cause: error,
    );
  }
}
