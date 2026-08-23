import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:record/record.dart';
import 'package:scholiast_flutter/core/audio/audio.dart';

class MockAudioRecorder extends Mock implements AudioRecorder {}

class FakeRecordConfig extends Fake implements RecordConfig {}

void main() {
  setUpAll(() {
    registerFallbackValue(FakeRecordConfig());
    registerFallbackValue(const RecordConfig());
    registerFallbackValue(const Duration(milliseconds: 50));
  });

  group('WavEncoder & Header Specification', () {
    test('createHeader generates canonical 44-byte WAV header for 16kHz mono 16-bit PCM', () {
      const dataSize = 32000; // 1 second of 16kHz 16-bit mono
      final header = WavEncoder.createHeader(
        dataSize: dataSize,
        sampleRate: 16000,
        numChannels: 1,
        bitsPerSample: 16,
      );

      expect(header.length, equals(44));

      // RIFF chunk descriptor
      expect(ascii.decode(header.sublist(0, 4)), equals('RIFF'));
      final byteData = ByteData.sublistView(header);
      expect(byteData.getUint32(4, Endian.little), equals(36 + dataSize));
      expect(ascii.decode(header.sublist(8, 12)), equals('WAVE'));

      // fmt subchunk
      expect(ascii.decode(header.sublist(12, 16)), equals('fmt '));
      expect(byteData.getUint32(16, Endian.little), equals(16)); // PCM header size
      expect(byteData.getUint16(20, Endian.little), equals(1)); // AudioFormat = 1 (PCM)
      expect(byteData.getUint16(22, Endian.little), equals(1)); // NumChannels = 1 (mono)
      expect(byteData.getUint32(24, Endian.little), equals(16000)); // SampleRate = 16000
      expect(byteData.getUint32(28, Endian.little), equals(32000)); // ByteRate = 16000 * 1 * 2
      expect(byteData.getUint16(32, Endian.little), equals(2)); // BlockAlign = 1 * 2
      expect(byteData.getUint16(34, Endian.little), equals(16)); // BitsPerSample = 16

      // data subchunk
      expect(ascii.decode(header.sublist(36, 40)), equals('data'));
      expect(byteData.getUint32(40, Endian.little), equals(dataSize));
    });

    test('encodePcm prepends 44-byte header to raw PCM payload', () {
      final pcmBytes = Uint8List.fromList([1, 2, 3, 4, 5, 6, 7, 8]);
      final wav = WavEncoder.encodePcm(pcmBytes: pcmBytes);

      expect(wav.length, equals(44 + pcmBytes.length));
      expect(wav.sublist(44), equals(pcmBytes));

      final info = WavEncoder.parseHeader(wav);
      expect(info, isNotNull);
      expect(info!.dataSize, equals(pcmBytes.length));
      expect(info.isCanonical16kMonoPcm, isTrue);
      expect(info.numChannels, equals(1));
      expect(info.sampleRate, equals(16000));
      expect(info.bitsPerSample, equals(16));
    });

    test('encodeFloats quantizes float audio [-1.0, 1.0] to 16-bit LE PCM WAV', () {
      final samples = [0.0, 1.0, -1.0, 0.5, -0.5];
      final wav = WavEncoder.encodeFloats(samples);

      expect(wav.length, equals(44 + samples.length * 2));
      expect(WavEncoder.isValidWav(wav), isTrue);

      final extracted = WavEncoder.extractFloats(wav);
      expect(extracted.length, equals(samples.length));
      expect(extracted[0], closeTo(0.0, 0.001));
      expect(extracted[1], closeTo(1.0, 0.001));
      expect(extracted[2], closeTo(-1.0, 0.001));
      expect(extracted[3], closeTo(0.5, 0.001));
      expect(extracted[4], closeTo(-0.5, 0.001));
    });

    test('encodeInt16 clamps and encodes signed 16-bit integers to WAV', () {
      final samples = [0, 32767, -32768, 1000, -1000];
      final wav = WavEncoder.encodeInt16(samples);

      expect(wav.length, equals(44 + samples.length * 2));
      final pcm = WavEncoder.extractPcm(wav);
      final byteData = ByteData.sublistView(pcm);

      expect(byteData.getInt16(0, Endian.little), equals(0));
      expect(byteData.getInt16(2, Endian.little), equals(32767));
      expect(byteData.getInt16(4, Endian.little), equals(-32768));
      expect(byteData.getInt16(6, Endian.little), equals(1000));
      expect(byteData.getInt16(8, Endian.little), equals(-1000));
    });

    test('parseHeader calculates correct duration from data size and sample rate', () {
      // 16000 samples/sec * 2 bytes/sample = 32000 bytes/sec
      final pcm = Uint8List(64000); // 2.0 seconds
      final wav = WavEncoder.encodePcm(pcmBytes: pcm);

      final info = WavEncoder.parseHeader(wav);
      expect(info, isNotNull);
      expect(info!.duration, equals(const Duration(seconds: 2)));
    });

    test('parseHeader and isValidWav reject malformed or truncated headers', () {
      expect(WavEncoder.parseHeader(Uint8List(20)), isNull);
      expect(WavEncoder.isValidWav(Uint8List(20)), isFalse);

      final corrupted = Uint8List.fromList(WavEncoder.createHeader(dataSize: 100));
      corrupted[0] = 0; // Destroy 'R' in RIFF
      expect(WavEncoder.parseHeader(corrupted), isNull);
      expect(WavEncoder.isValidWav(corrupted), isFalse);

      final truncatedWav = WavEncoder.createHeader(dataSize: 500); // Has header but no data
      expect(WavEncoder.isValidWav(truncatedWav), isFalse);
    });

    test('extractPcm throws FormatException on invalid WAV bytes', () {
      expect(
        () => WavEncoder.extractPcm(Uint8List(10)),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('AudioAmplitude Model & Normalization', () {
    test('RecorderState boolean getters match enum values', () {
      expect(RecorderState.idle.isIdle, isTrue);
      expect(RecorderState.idle.isRecording, isFalse);
      expect(RecorderState.idle.isActive, isFalse);

      expect(RecorderState.recording.isRecording, isTrue);
      expect(RecorderState.recording.isActive, isTrue);

      expect(RecorderState.paused.isPaused, isTrue);
      expect(RecorderState.paused.isActive, isTrue);

      expect(RecorderState.stopped.isStopped, isTrue);
      expect(RecorderState.stopped.isActive, isFalse);
    });

    test('fromDecibels normalizes -60 dB to 0.0 and 0 dB to 1.0', () {
      final silence = AudioAmplitude.fromDecibels(current: -60.0, max: -60.0);
      expect(silence.normalized, equals(0.0));

      final half = AudioAmplitude.fromDecibels(current: -30.0, max: 0.0);
      expect(half.normalized, closeTo(0.5, 0.001));

      final full = AudioAmplitude.fromDecibels(current: 0.0, max: 0.0);
      expect(full.normalized, equals(1.0));
    });

    test('fromDecibels clamps out-of-bounds dB levels safely', () {
      final quiet = AudioAmplitude.fromDecibels(current: -120.0, max: -60.0);
      expect(quiet.normalized, equals(0.0));

      final loud = AudioAmplitude.fromDecibels(current: 10.0, max: 10.0);
      expect(loud.normalized, equals(1.0));

      final nanVal = AudioAmplitude.fromDecibels(current: double.nan, max: 0.0);
      expect(nanVal.normalized, equals(0.0));

      final negInf = AudioAmplitude.fromDecibels(current: double.negativeInfinity, max: 0.0);
      expect(negInf.normalized, equals(0.0));
    });

    test('fromDecibels throws ArgumentError when minDb >= maxDb', () {
      expect(
        () => AudioAmplitude.fromDecibels(current: -10, max: 0, minDb: 0, maxDb: 0),
        throwsA(isA<ArgumentError>()),
      );
      expect(
        () => AudioAmplitude.fromDecibels(current: -10, max: 0, minDb: 10, maxDb: -10),
        throwsA(isA<ArgumentError>()),
      );
    });

    test('fromRms produces FUTO magnitude curve', () {
      final zero = AudioAmplitude.fromRms(rms: 0.0);
      expect(zero.normalized, equals(0.0));

      final mid = AudioAmplitude.fromRms(rms: 0.05);
      expect(mid.normalized, greaterThan(0.0));
      expect(mid.normalized, lessThan(1.0));

      final loud = AudioAmplitude.fromRms(rms: 1.0);
      expect(loud.normalized, equals(1.0));
    });

    test('smooth applies exponential moving average', () {
      const prev = AudioAmplitude(current: -60.0, max: -20.0, normalized: 0.2);
      const next = AudioAmplitude(current: 0.0, max: 0.0, normalized: 0.8);

      final smoothed = next.smooth(prev, smoothing: 0.5);
      expect(smoothed.normalized, closeTo(0.5, 0.001));
      expect(smoothed.max, equals(0.0)); // Peak max preserved
    });

    test('AudioAmplitude equality, hashCode, copyWith, and toString', () {
      const a = AudioAmplitude(current: -20.0, max: -5.0, normalized: 0.6);
      const b = AudioAmplitude(current: -20.0, max: -5.0, normalized: 0.6);
      const c = AudioAmplitude(current: -10.0, max: 0.0, normalized: 0.8);

      expect(a, equals(b));
      expect(a.hashCode, equals(b.hashCode));
      expect(a, isNot(equals(c)));

      final copied = a.copyWith(normalized: 0.9);
      expect(copied.current, equals(-20.0));
      expect(copied.normalized, equals(0.9));

      expect(a.toString(), contains('current: -20.00'));
    });
  });

  group('AudioRecorderService Lifecycle & State Transitions', () {
    late MockAudioRecorder mockRecorder;
    late Directory tempDir;
    late AudioRecorderService service;
    late StreamController<RecordState> platformStateCtrl;

    setUp(() async {
      mockRecorder = MockAudioRecorder();
      tempDir = await Directory.systemTemp.createTemp('scholiast_audio_test_');
      platformStateCtrl = StreamController<RecordState>.broadcast();

      when(() => mockRecorder.hasPermission()).thenAnswer((_) async => true);
      when(() => mockRecorder.start(any(), path: any(named: 'path'))).thenAnswer((_) async {});
      when(() => mockRecorder.startStream(any())).thenAnswer((_) async => const Stream<Uint8List>.empty());
      when(() => mockRecorder.stop()).thenAnswer((_) async => null);
      when(() => mockRecorder.pause()).thenAnswer((_) async {});
      when(() => mockRecorder.resume()).thenAnswer((_) async {});
      when(() => mockRecorder.cancel()).thenAnswer((_) async {});
      when(() => mockRecorder.dispose()).thenAnswer((_) async {});
      when(() => mockRecorder.getAmplitude()).thenAnswer((_) async => Amplitude(current: -25.0, max: -10.0));
      when(() => mockRecorder.onStateChanged()).thenAnswer((_) => platformStateCtrl.stream);

      service = AudioRecorderService(
        recorder: mockRecorder,
        tempDirProvider: () async => tempDir.path,
        tickerInterval: const Duration(milliseconds: 20),
        amplitudeInterval: const Duration(milliseconds: 20),
        amplitudeSmoothing: 0.2,
      );
    });

    tearDown(() async {
      await service.dispose();
      await platformStateCtrl.close();
      if (await tempDir.exists()) {
        await tempDir.delete(recursive: true);
      }
    });

    test('initial state is idle and duration is zero', () {
      expect(service.state, equals(RecorderState.idle));
      expect(service.duration, equals(Duration.zero));
      expect(service.currentRecordingPath, isNull);
    });

    test('start() enters recording state and configures 16kHz mono WAV', () async {
      final stateChanges = <RecorderState>[];
      service.onStateChanged.listen(stateChanges.add);

      final path = await service.start();

      expect(service.state, equals(RecorderState.recording));
      expect(stateChanges, contains(RecorderState.recording));
      expect(service.currentRecordingPath, equals(path));
      expect(path, contains('scholiast_audio'));
      expect(path.endsWith('.wav'), isTrue);

      verify(() => mockRecorder.start(
            any(
              that: isA<RecordConfig>()
                  .having((c) => c.sampleRate, 'sampleRate', 16000)
                  .having((c) => c.numChannels, 'numChannels', 1)
                  .having((c) => c.encoder, 'encoder', AudioEncoder.wav),
            ),
            path: path,
          )).called(1);
    });

    test('start() throws StateError if already recording or active', () async {
      await service.start();
      expect(() => service.start(), throwsStateError);
      expect(() => service.startStream(), throwsStateError);
    });

    test('start() throws AudioRecorderPermissionException if permission is denied', () async {
      when(() => mockRecorder.hasPermission()).thenAnswer((_) async => false);
      expect(
        () => service.start(),
        throwsA(isA<AudioRecorderPermissionException>()),
      );
    });

    test('pause() and resume() transition states correctly and preserve duration', () async {
      await service.start();
      await Future<void>.delayed(const Duration(milliseconds: 60));

      final durBeforePause = service.duration;
      expect(durBeforePause.inMilliseconds, greaterThan(0));

      await service.pause();
      expect(service.state, equals(RecorderState.paused));
      verify(() => mockRecorder.pause()).called(1);

      // Verify duration does not advance while paused
      final pausedDuration = service.duration;
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(service.duration.inMilliseconds, closeTo(pausedDuration.inMilliseconds.toDouble(), 10));

      await service.resume();
      expect(service.state, equals(RecorderState.recording));
      verify(() => mockRecorder.resume()).called(1);
    });

    test('stop() transitions to stopped then idle, returning audio file path', () async {
      final recordedPath = await service.start();
      when(() => mockRecorder.stop()).thenAnswer((_) async => recordedPath);

      // Create dummy WAV file so stopToBytes can verify
      final dummyFile = File(recordedPath);
      await dummyFile.parent.create(recursive: true);
      final wavData = WavEncoder.encodePcm(pcmBytes: Uint8List(1600));
      await dummyFile.writeAsBytes(wavData);

      final returnedPath = await service.stop();
      expect(returnedPath, equals(recordedPath));
      expect(service.state, equals(RecorderState.idle));
      expect(service.currentRecordingPath, isNull);
    });

    test('stopToBytes() reads recorded WAV data and deletes temp file when requested', () async {
      final recordedPath = await service.start();
      when(() => mockRecorder.stop()).thenAnswer((_) async => recordedPath);

      final dummyFile = File(recordedPath);
      await dummyFile.parent.create(recursive: true);
      final testPcm = Uint8List.fromList(List.generate(320, (i) => i % 256));
      final wavData = WavEncoder.encodePcm(pcmBytes: testPcm);
      await dummyFile.writeAsBytes(wavData);

      final bytes = await service.stopToBytes(deleteTempFile: true);
      expect(bytes, isNotNull);
      expect(bytes!.length, equals(wavData.length));
      expect(WavEncoder.isValidWav(bytes), isTrue);

      // Verify temp file was cleaned up
      expect(await dummyFile.exists(), isFalse);
    });

    test('cancel() stops recording, discards file, and resets state to idle', () async {
      final path = await service.start();
      final file = File(path);
      await file.parent.create(recursive: true);
      await file.writeAsBytes([0, 1, 2, 3]);
      expect(await file.exists(), isTrue);

      await service.cancel();
      expect(service.state, equals(RecorderState.idle));
      expect(service.duration, equals(Duration.zero));
      expect(service.currentRecordingPath, isNull);
      verify(() => mockRecorder.cancel()).called(1);
      expect(await file.exists(), isFalse);
    });

    test('cleanupTempFiles() cleans all tracked and orphaned wav files in temp directory', () async {
      final path1 = await service.start();
      final file1 = File(path1);
      await file1.parent.create(recursive: true);
      await file1.writeAsBytes([1, 2, 3]);

      when(() => mockRecorder.stop()).thenAnswer((_) async => path1);
      await service.stop();

      // Create an orphaned wav file in the audio directory
      final orphanFile = File('${tempDir.path}/scholiast_audio/rec_orphan_test.wav');
      await orphanFile.writeAsBytes([4, 5, 6]);

      expect(await file1.exists(), isTrue);
      expect(await orphanFile.exists(), isTrue);

      await service.cleanupTempFiles();

      expect(await file1.exists(), isFalse);
      expect(await orphanFile.exists(), isFalse);
      expect(service.trackedTempFiles, isEmpty);
    });

    test('onAmplitudeChanged emits smoothed values during recording', () async {
      final amplitudes = <AudioAmplitude>[];
      final sub = service.onAmplitudeChanged.listen(amplitudes.add);

      await service.start();
      await Future<void>.delayed(const Duration(milliseconds: 70));

      expect(amplitudes, isNotEmpty);
      expect(amplitudes.first.normalized, greaterThanOrEqualTo(0.0));
      expect(amplitudes.first.normalized, lessThanOrEqualTo(1.0));

      await sub.cancel();
    });

    test('onDurationChanged emits elapsed durations during recording', () async {
      final durations = <Duration>[];
      final sub = service.onDurationChanged.listen(durations.add);

      await service.start();
      await Future<void>.delayed(const Duration(milliseconds: 70));

      expect(durations, isNotEmpty);
      expect(durations.last.inMilliseconds, greaterThan(0));

      await sub.cancel();
    });

    test('startStream() streams audio chunks directly', () async {
      final mockData = Uint8List.fromList([10, 20, 30]);
      when(() => mockRecorder.startStream(any())).thenAnswer(
        (_) async => Stream<Uint8List>.fromIterable([mockData]),
      );

      final stream = await service.startStream();
      expect(service.state, equals(RecorderState.recording));

      final received = await stream.first;
      expect(received, equals(mockData));
    });

    test('auto-stops when maxDuration is exceeded', () async {
      final limitedService = AudioRecorderService(
        recorder: mockRecorder,
        tempDirProvider: () async => tempDir.path,
        tickerInterval: const Duration(milliseconds: 15),
        maxDuration: const Duration(milliseconds: 40),
      );

      final path = await limitedService.start();
      when(() => mockRecorder.stop()).thenAnswer((_) async => path);

      await Future<void>.delayed(const Duration(milliseconds: 90));
      expect(limitedService.state, equals(RecorderState.idle));

      await limitedService.dispose();
    });
  });
}
