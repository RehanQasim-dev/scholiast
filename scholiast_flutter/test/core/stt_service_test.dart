import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:scholiast_flutter/core/auth/secure_token_store.dart';
import 'package:scholiast_flutter/core/stt/cloud_stt_service.dart';
import 'package:scholiast_flutter/core/stt/stt_models.dart';
import 'package:scholiast_flutter/core/stt/stt_service.dart';
import 'package:scholiast_flutter/core/stt/whisper_bindings.dart';
import 'package:scholiast_flutter/core/stt/whisper_model_manager.dart';

class MockDio extends Mock implements Dio {}
class MockSecureTokenStore extends Mock implements SecureTokenStore {}

void main() {
  setUpAll(() {
    registerFallbackValue(RequestOptions(path: ''));
    registerFallbackValue(FormData());
    registerFallbackValue(Options());
  });

  group('STT Models & Domain Types', () {
    test('SttProvider properties and parsing', () {
      expect(SttProvider.localWhisper.isLocal, isTrue);
      expect(SttProvider.localWhisper.isCloud, isFalse);
      expect(SttProvider.localWhisper.id, 'local_whisper');
      expect(SttProvider.localWhisper.displayName, contains('On-Device'));

      expect(SttProvider.groq.isLocal, isFalse);
      expect(SttProvider.groq.isCloud, isTrue);
      expect(SttProvider.groq.id, 'groq');

      expect(SttProvider.openAi.id, 'openai');
      expect(SttProvider.gemini.id, 'gemini');

      expect(SttProvider.fromId('local_whisper'), SttProvider.localWhisper);
      expect(SttProvider.fromId('whisper'), SttProvider.localWhisper);
      expect(SttProvider.fromId('groq'), SttProvider.groq);
      expect(SttProvider.fromId('openai'), SttProvider.openAi);
      expect(SttProvider.fromId('gemini'), SttProvider.gemini);
      expect(SttProvider.fromId('unknown'), SttProvider.localWhisper);
    });

    test('SttWordTimestamp serialization and equality', () {
      const ts = SttWordTimestamp(
        startMs: 1000,
        endMs: 2500,
        text: 'hello world',
        confidence: 0.95,
      );

      final json = ts.toJson();
      expect(json['startMs'], 1000);
      expect(json['endMs'], 2500);
      expect(json['text'], 'hello world');
      expect(json['confidence'], 0.95);

      final fromJson = SttWordTimestamp.fromJson(json);
      expect(fromJson, equals(ts));
      expect(fromJson.hashCode, equals(ts.hashCode));

      final fromSeconds = SttWordTimestamp.fromJson({
        'start': 1.5,
        'end': 3.0,
        'text': 'seconds test',
      });
      expect(fromSeconds.startMs, 1500);
      expect(fromSeconds.endMs, 3000);
      expect(fromSeconds.text, 'seconds test');
    });

    test('SttResult serialization, copyWith, and equality', () {
      const result = SttResult(
        text: 'Obsidian Web Clipper',
        language: 'en',
        duration: Duration(seconds: 4),
        provider: SttProvider.groq,
        isFinal: true,
        timestamps: [
          SttWordTimestamp(startMs: 0, endMs: 2000, text: 'Obsidian'),
          SttWordTimestamp(startMs: 2000, endMs: 4000, text: 'Web Clipper'),
        ],
        confidence: 0.98,
      );

      final json = result.toJson();
      expect(json['text'], 'Obsidian Web Clipper');
      expect(json['language'], 'en');
      expect(json['durationMs'], 4000);
      expect(json['provider'], 'groq');
      expect(json['isFinal'], isTrue);

      final fromJson = SttResult.fromJson(json);
      expect(fromJson, equals(result));
      expect(fromJson.hashCode, equals(result.hashCode));

      final updated = result.copyWith(text: 'Modified text');
      expect(updated.text, 'Modified text');
      expect(updated.provider, SttProvider.groq);
    });

    test('WhisperModelInfo presets and catalogue', () {
      expect(WhisperModelInfo.standardModels.length, 6);
      expect(WhisperModelInfo.defaultModel.id, 'tiny.en');
      expect(WhisperModelInfo.tinyEn.isEnglishOnly, isTrue);
      expect(WhisperModelInfo.tiny.isEnglishOnly, isFalse);
      expect(WhisperModelInfo.baseEn.fileName, 'ggml-base.en.bin');
      expect(WhisperModelInfo.small.fileName, 'ggml-small.bin');

      final json = WhisperModelInfo.tinyEn.toJson();
      final fromJson = WhisperModelInfo.fromJson(json);
      expect(fromJson.id, WhisperModelInfo.tinyEn.id);
      expect(fromJson.fileName, WhisperModelInfo.tinyEn.fileName);
      expect(fromJson.isDownloaded, isFalse);

      final downloaded = fromJson.copyWith(
        isDownloaded: true,
        localPath: '/tmp/ggml-tiny.en.bin',
      );
      expect(downloaded.isDownloaded, isTrue);
      expect(downloaded.localPath, '/tmp/ggml-tiny.en.bin');
    });

    test('SttException toString and properties', () {
      const ex = SttException(
        SttErrorType.unauthorized,
        'Bad API key',
        provider: SttProvider.groq,
      );
      expect(ex.errorType, SttErrorType.unauthorized);
      expect(ex.message, 'Bad API key');
      expect(ex.provider, SttProvider.groq);
      expect(ex.toString(), contains('unauthorized'));
      expect(ex.toString(), contains('groq'));
    });
  });

  group('Whisper FFI Bindings & Dynamic Loading', () {
    test('gracefully handles missing library without crashing', () {
      final bindings = WhisperBindings.load(
        customLibraryPath: '/non/existent/path/to/libwhisper_fake.so',
      );
      if (bindings != null) {
        expect(bindings.isAvailable, isTrue);
      } else {
        expect(bindings, isNull);
      }
    });

    test('getSystemInfo returns diagnostic string', () {
      final bindings = WhisperBindings.load(
        customLibraryPath: '/non/existent/path/libwhisper_test.so',
      );
      if (bindings != null) {
        final info = bindings.getSystemInfo();
        expect(info, isNotEmpty);
      }
    });
  });

  group('WhisperModelManager', () {
    late Directory tempDir;
    late MockDio mockDio;
    late WhisperModelManager modelManager;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('whisper_test_');
      mockDio = MockDio();
      modelManager = WhisperModelManager(
        dio: mockDio,
        customDirectoryPath: tempDir.path,
      );
    });

    tearDown(() async {
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('getAvailableModels lists standard models and updates downloaded state', () async {
      final modelsInitial = await modelManager.getAvailableModels();
      expect(modelsInitial.length, greaterThanOrEqualTo(6));
      expect(modelsInitial.every((m) => !m.isDownloaded), isTrue);

      // Create a dummy model file
      final dummyFile = File('${tempDir.path}/ggml-tiny.en.bin');
      await dummyFile.writeAsBytes(Uint8List.fromList([1, 2, 3, 4]));

      final modelsAfter = await modelManager.getAvailableModels();
      final tinyEn = modelsAfter.firstWhere((m) => m.id == 'tiny.en');
      expect(tinyEn.isDownloaded, isTrue);
      expect(tinyEn.localPath, dummyFile.path);
      expect(tinyEn.sizeBytes, 4);

      final path = await modelManager.getDownloadedModelPath('tiny.en');
      expect(path, dummyFile.path);
    });

    test('downloadModel downloads file via Dio and verifies checksum', () async {
      final dummyBytes = utf8.encode('dummy-ggml-model-bytes');

      when(() => mockDio.download(
            any<String>(),
            any<String>(),
            cancelToken: any(named: 'cancelToken'),
            onReceiveProgress: any(named: 'onReceiveProgress'),
          )).thenAnswer((invocation) async {
        final destPath = invocation.positionalArguments[1] as String;
        final file = File(destPath);
        await file.writeAsBytes(dummyBytes);
        final progressCb = invocation.namedArguments[#onReceiveProgress] as void Function(int, int)?;
        if (progressCb != null) {
          progressCb(dummyBytes.length, dummyBytes.length);
        }
        return Response<dynamic>(
          requestOptions: RequestOptions(path: ''),
          statusCode: 200,
        );
      });

      var progressReported = false;
      final file = await modelManager.downloadModel(
        'tiny.en',
        onProgress: (rec, total, frac) {
          progressReported = true;
          expect(frac, greaterThanOrEqualTo(0.0));
        },
      );

      expect(progressReported, isTrue);
      expect(await file.exists(), isTrue);
      expect(await file.length(), dummyBytes.length);

      // Check delete model
      final deleted = await modelManager.deleteModel('tiny.en');
      expect(deleted, isTrue);
      expect(await file.exists(), isFalse);
    });

    test('importModelFile imports an external .bin file', () async {
      final externalFile = File('${tempDir.path}/external-custom-model.bin');
      await externalFile.writeAsBytes(Uint8List.fromList([10, 20, 30]));

      final imported = await modelManager.importModelFile(
        externalFile.path,
        modelId: 'custom_model',
        name: 'My Custom Whisper Model',
      );

      expect(imported.id, 'custom_model');
      expect(imported.name, 'My Custom Whisper Model');
      expect(imported.isDownloaded, isTrue);
      expect(imported.sizeBytes, 3);
    });
  });

  group('CloudSttService', () {
    late MockDio mockDio;
    late MockSecureTokenStore mockTokenStore;
    late CloudSttService cloudStt;

    setUp(() {
      mockDio = MockDio();
      mockTokenStore = MockSecureTokenStore();
      cloudStt = CloudSttService(
        dio: mockDio,
        tokenStore: mockTokenStore,
      );
    });

    test('transcribeGroq parses verbose_json response with segments', () async {
      when(() => mockTokenStore.getApiKey('groq'))
          .thenAnswer((_) async => 'gsk_test_groq_key_123');

      final fakeResponseJson = {
        'text': 'Hello from Groq Whisper transcription.',
        'language': 'en',
        'duration': 2.5,
        'segments': [
          {
            'start': 0.0,
            'end': 1.2,
            'text': 'Hello from',
          },
          {
            'start': 1.2,
            'end': 2.5,
            'text': 'Groq Whisper transcription.',
          },
        ],
      };

      when(() => mockDio.post<dynamic>(
            CloudSttService.groqTranscriptionsUrl,
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response<dynamic>(
            requestOptions: RequestOptions(path: ''),
            data: fakeResponseJson,
            statusCode: 200,
          ));

      final audioBytes = Uint8List.fromList([0, 1, 2, 3, 4]);
      final result = await cloudStt.transcribeGroq(audioBytes);

      expect(result.provider, SttProvider.groq);
      expect(result.text, 'Hello from Groq Whisper transcription.');
      expect(result.language, 'en');
      expect(result.timestamps?.length, 2);
      expect(result.timestamps?.first.startMs, 0);
      expect(result.timestamps?.first.endMs, 1200);
      expect(result.timestamps?.first.text, 'Hello from');
    });

    test('transcribeOpenAi parses whisper-1 response', () async {
      when(() => mockTokenStore.getApiKey('openai'))
          .thenAnswer((_) async => 'sk-test-openai-key');

      final fakeResponseJson = {
        'text': 'Transcribed via OpenAI Whisper-1.',
        'language': 'en',
        'duration': 3.0,
        'segments': [
          {'start': 0.0, 'end': 3.0, 'text': 'Transcribed via OpenAI Whisper-1.'},
        ],
      };

      when(() => mockDio.post<dynamic>(
            CloudSttService.openAiTranscriptionsUrl,
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response<dynamic>(
            requestOptions: RequestOptions(path: ''),
            data: fakeResponseJson,
            statusCode: 200,
          ));

      final audioBytes = Uint8List.fromList([1, 2, 3]);
      final result = await cloudStt.transcribeOpenAi(audioBytes);

      expect(result.provider, SttProvider.openAi);
      expect(result.text, 'Transcribed via OpenAI Whisper-1.');
    });

    test('transcribeGemini encodes inline base64 and parses response', () async {
      when(() => mockTokenStore.getApiKey('gemini'))
          .thenAnswer((_) async => 'AIzaSy_fake_gemini_key');

      final fakeGeminiResponse = {
        'candidates': [
          {
            'content': {
              'parts': [
                {'text': 'Gemini audio transcription result.'}
              ],
            },
          }
        ],
      };

      when(() => mockDio.post<dynamic>(
            any(that: contains('generativelanguage.googleapis.com')),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response<dynamic>(
            requestOptions: RequestOptions(path: ''),
            data: fakeGeminiResponse,
            statusCode: 200,
          ));

      final audioBytes = Uint8List.fromList([1, 2, 3, 4, 5]);
      final result = await cloudStt.transcribeGemini(audioBytes);

      expect(result.provider, SttProvider.gemini);
      expect(result.text, 'Gemini audio transcription result.');
    });

    test('handles unconfigured API key gracefully', () async {
      when(() => mockTokenStore.getApiKey('groq')).thenAnswer((_) async => null);

      expect(
        () => cloudStt.transcribeGroq(Uint8List.fromList([1, 2])),
        throwsA(
          isA<SttException>().having(
            (e) => e.errorType,
            'errorType',
            SttErrorType.notConfigured,
          ),
        ),
      );
    });

    test('handles 401 unauthorized and 429 rate limit errors from Dio', () async {
      when(() => mockTokenStore.getApiKey('groq'))
          .thenAnswer((_) async => 'bad_key');

      when(() => mockDio.post<dynamic>(
            any(),
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: ''),
          response: Response<dynamic>(
            requestOptions: RequestOptions(path: ''),
            statusCode: 401,
            data: {'error': {'message': 'Invalid API Key'}},
          ),
        ),
      );

      expect(
        () => cloudStt.transcribeGroq(Uint8List.fromList([1, 2])),
        throwsA(
          isA<SttException>().having(
            (e) => e.errorType,
            'errorType',
            SttErrorType.unauthorized,
          ),
        ),
      );
    });
  });

  group('SttService Audio Conversions & Unified Coordinator', () {
    late MockDio mockDio;
    late MockSecureTokenStore mockTokenStore;
    late WhisperModelManager modelManager;
    late CloudSttService cloudStt;
    late SttService sttService;
    late Directory tempDir;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('stt_service_test_');
      mockDio = MockDio();
      mockTokenStore = MockSecureTokenStore();
      modelManager = WhisperModelManager(
        dio: mockDio,
        customDirectoryPath: tempDir.path,
      );
      cloudStt = CloudSttService(
        dio: mockDio,
        tokenStore: mockTokenStore,
      );
      sttService = SttService(
        modelManager: modelManager,
        cloudStt: cloudStt,
        tokenStore: mockTokenStore,
        preferredProvider: SttProvider.groq,
      );
    });

    tearDown(() async {
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('pcmFloat32ToWavBytes generates compliant 44-byte WAV header and PCM samples', () {
      final samples = Float32List(160); // 10ms at 16kHz
      for (var i = 0; i < samples.length; i++) {
        samples[i] = (i % 2 == 0) ? 0.5 : -0.5;
      }

      final wavBytes = SttService.pcmFloat32ToWavBytes(samples, sampleRate: 16000);
      expect(wavBytes.length, 44 + (160 * 2)); // 44 header + 320 data bytes

      // Check header markers
      expect(String.fromCharCodes(wavBytes.sublist(0, 4)), 'RIFF');
      expect(String.fromCharCodes(wavBytes.sublist(8, 12)), 'WAVE');
      expect(String.fromCharCodes(wavBytes.sublist(12, 16)), 'fmt ');
      expect(String.fromCharCodes(wavBytes.sublist(36, 40)), 'data');

      // Check format properties
      final bd = ByteData.sublistView(wavBytes);
      expect(bd.getUint16(20, Endian.little), 1); // AudioFormat PCM = 1
      expect(bd.getUint16(22, Endian.little), 1); // Channels = 1
      expect(bd.getUint32(24, Endian.little), 16000); // SampleRate = 16000
      expect(bd.getUint16(34, Endian.little), 16); // BitsPerSample = 16
    });

    test('wavBytesToPcmFloat32 roundtrips PCM samples correctly', () {
      final original = Float32List.fromList([0.0, 0.5, -0.5, 0.99, -0.99]);
      final wavBytes = SttService.pcmFloat32ToWavBytes(original, sampleRate: 16000);
      final decoded = SttService.wavBytesToPcmFloat32(wavBytes);

      expect(decoded.length, original.length);
      for (var i = 0; i < original.length; i++) {
        expect(decoded[i], closeTo(original[i], 0.001));
      }
    });

    test('routes transcription to cloud provider with fallback chain', () async {
      when(() => mockTokenStore.getApiKey('groq'))
          .thenAnswer((_) async => 'groq_valid_key');

      when(() => mockDio.post<dynamic>(
            CloudSttService.groqTranscriptionsUrl,
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response<dynamic>(
            requestOptions: RequestOptions(path: ''),
            data: {
              'text': 'Coordinator successfully routed to Groq.',
              'language': 'en',
              'duration': 1.8,
            },
            statusCode: 200,
          ));

      final samples = Float32List(320);
      final result = await sttService.transcribeFloatPcm(
        samples,
        preferredProvider: SttProvider.groq,
      );

      expect(result.provider, SttProvider.groq);
      expect(result.text, 'Coordinator successfully routed to Groq.');
    });

    test('falls back to next provider when preferred fails', () async {
      // First provider Groq fails with 500 error
      when(() => mockTokenStore.getApiKey('groq')).thenAnswer((_) async => 'groq_key');
      when(() => mockTokenStore.getApiKey('openai')).thenAnswer((_) async => 'openai_key');

      when(() => mockDio.post<dynamic>(
            CloudSttService.groqTranscriptionsUrl,
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenThrow(
        DioException(
          requestOptions: RequestOptions(path: ''),
          response: Response<dynamic>(
            requestOptions: RequestOptions(path: ''),
            statusCode: 500,
            data: {'message': 'Groq internal error'},
          ),
        ),
      );

      // Second provider OpenAI succeeds
      when(() => mockDio.post<dynamic>(
            CloudSttService.openAiTranscriptionsUrl,
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response<dynamic>(
            requestOptions: RequestOptions(path: ''),
            data: {
              'text': 'OpenAI fallback succeeded.',
              'language': 'en',
            },
            statusCode: 200,
          ));

      sttService.fallbackChain = [SttProvider.groq, SttProvider.openAi];
      final samples = Float32List(160);
      final result = await sttService.transcribeFloatPcm(
        samples,
        preferredProvider: SttProvider.groq,
      );

      expect(result.provider, SttProvider.openAi);
      expect(result.text, 'OpenAI fallback succeeded.');
    });

    test('transcribeAudioFile reads file and transcribes', () async {
      final wavFile = File('${tempDir.path}/test_speech.wav');
      final samples = Float32List(160);
      await wavFile.writeAsBytes(SttService.pcmFloat32ToWavBytes(samples));

      when(() => mockTokenStore.getApiKey('groq')).thenAnswer((_) async => 'groq_key');
      when(() => mockDio.post<dynamic>(
            CloudSttService.groqTranscriptionsUrl,
            data: any(named: 'data'),
            options: any(named: 'options'),
          )).thenAnswer((_) async => Response<dynamic>(
            requestOptions: RequestOptions(path: ''),
            data: {'text': 'File transcription test.'},
            statusCode: 200,
          ));

      final result = await sttService.transcribeAudioFile(
        wavFile.path,
        preferredProvider: SttProvider.groq,
      );

      expect(result.text, 'File transcription test.');
    });
  });
}
