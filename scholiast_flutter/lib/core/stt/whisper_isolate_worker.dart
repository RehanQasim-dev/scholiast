import 'dart:async';
import 'dart:ffi';
import 'dart:isolate';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'stt_models.dart';
import 'whisper_bindings.dart';

// --- Worker Protocol Commands ---

abstract class _WorkerCommand {
  const _WorkerCommand();
}

class _InitCommand extends _WorkerCommand {
  final String modelPath;
  final String? customLibraryPath;

  const _InitCommand({
    required this.modelPath,
    this.customLibraryPath,
  });
}

class _TranscribeCommand extends _WorkerCommand {
  final int requestId;
  final Float32List samples;
  final String? language;
  final int nThreads;
  final bool translate;

  const _TranscribeCommand({
    required this.requestId,
    required this.samples,
    this.language,
    this.nThreads = 4,
    this.translate = false,
  });
}

class _DisposeCommand extends _WorkerCommand {
  const _DisposeCommand();
}

// --- Worker Protocol Responses ---

abstract class _WorkerResponse {
  const _WorkerResponse();
}

class _WorkerPortReady extends _WorkerResponse {
  final SendPort sendPort;
  const _WorkerPortReady(this.sendPort);
}

class _InitResultResponse extends _WorkerResponse {
  final bool success;
  final String? errorMessage;
  const _InitResultResponse({required this.success, this.errorMessage});
}

class _TranscribeSuccessResponse extends _WorkerResponse {
  final int requestId;
  final String text;
  final String? language;
  final int durationMs;
  final List<SttWordTimestamp> segments;

  const _TranscribeSuccessResponse({
    required this.requestId,
    required this.text,
    this.language,
    required this.durationMs,
    required this.segments,
  });
}

class _TranscribeFailureResponse extends _WorkerResponse {
  final int requestId;
  final String errorMessage;
  final SttErrorType errorType;

  const _TranscribeFailureResponse({
    required this.requestId,
    required this.errorMessage,
    this.errorType = SttErrorType.unknown,
  });
}

/// Off-main-thread worker that runs Whisper audio inference in a dedicated Dart [Isolate].
class WhisperIsolateWorker {
  Isolate? _isolate;
  ReceivePort? _receivePort;
  SendPort? _workerSendPort;
  StreamSubscription<dynamic>? _subscription;

  bool _isInitialized = false;
  bool _isProcessing = false;
  String? _currentModelPath;
  int _nextRequestId = 1;

  final Map<int, Completer<SttResult>> _pendingRequests = {};
  Completer<bool>? _initCompleter;

  WhisperBindings? _directBindings;
  Pointer<WhisperContext>? _directCtx;

  WhisperIsolateWorker({WhisperBindings? testBindings}) {
    if (testBindings != null) {
      _directBindings = testBindings;
    }
  }

  /// Whether the worker is initialized with an active model context.
  bool get isReady => _isInitialized;

  /// Whether the worker is currently running audio transcription.
  bool get isProcessing => _isProcessing;

  /// The path to the active model file.
  String? get currentModelPath => _currentModelPath;

  /// Initializes the background worker isolate and loads the GGML Whisper model from [modelPath].
  Future<bool> init({
    required String modelPath,
    String? customLibraryPath,
  }) async {
    if (_directBindings != null) {
      final ctx = _directBindings!.initFromFile(modelPath);
      if (ctx == null) {
        throw SttException(
          SttErrorType.modelNotLoaded,
          'Direct Whisper bindings failed to initialize model from $modelPath',
          provider: SttProvider.localWhisper,
        );
      }
      _directCtx = ctx;
      _isInitialized = true;
      _currentModelPath = modelPath;
      return true;
    }

    await dispose();

    final readyCompleter = Completer<SendPort>();
    _receivePort = ReceivePort();

    _subscription = _receivePort!.listen((message) {
      if (message is _WorkerPortReady) {
        if (!readyCompleter.isCompleted) {
          readyCompleter.complete(message.sendPort);
        }
      } else if (message is _InitResultResponse) {
        if (_initCompleter != null && !_initCompleter!.isCompleted) {
          if (message.success) {
            _isInitialized = true;
            _currentModelPath = modelPath;
            _initCompleter!.complete(true);
          } else {
            _isInitialized = false;
            _initCompleter!.completeError(
              SttException(
                SttErrorType.modelNotLoaded,
                message.errorMessage ?? 'Failed to load model in background isolate',
                provider: SttProvider.localWhisper,
              ),
            );
          }
        }
      } else if (message is _TranscribeSuccessResponse) {
        _isProcessing = false;
        final completer = _pendingRequests.remove(message.requestId);
        if (completer != null && !completer.isCompleted) {
          completer.complete(
            SttResult(
              text: message.text,
              language: message.language,
              duration: Duration(milliseconds: message.durationMs),
              provider: SttProvider.localWhisper,
              timestamps: message.segments,
              isFinal: true,
            ),
          );
        }
      } else if (message is _TranscribeFailureResponse) {
        _isProcessing = false;
        final completer = _pendingRequests.remove(message.requestId);
        if (completer != null && !completer.isCompleted) {
          completer.completeError(
            SttException(
              message.errorType,
              message.errorMessage,
              provider: SttProvider.localWhisper,
            ),
          );
        }
      }
    });

    try {
      _isolate = await Isolate.spawn(
        _isolateEntryPoint,
        _receivePort!.sendPort,
        debugName: 'WhisperWorkerIsolate',
      );

      _workerSendPort = await readyCompleter.future.timeout(
        const Duration(seconds: 10),
        onTimeout: () => throw TimeoutException('Whisper isolate spawn timed out'),
      );

      _initCompleter = Completer<bool>();
      _workerSendPort!.send(
        _InitCommand(
          modelPath: modelPath,
          customLibraryPath: customLibraryPath,
        ),
      );

      return await _initCompleter!.future.timeout(
        const Duration(seconds: 30),
        onTimeout: () => throw TimeoutException('Whisper model initialization timed out'),
      );
    } catch (e) {
      await dispose();
      rethrow;
    }
  }

  /// Runs transcription on 16kHz float32 audio samples in the background isolate.
  Future<SttResult> transcribe(
    Float32List samples, {
    String? language,
    int nThreads = 4,
    bool translate = false,
  }) async {
    if (!_isInitialized) {
      throw const SttException(
        SttErrorType.modelNotLoaded,
        'Whisper worker is not initialized with a model',
        provider: SttProvider.localWhisper,
      );
    }

    if (samples.isEmpty) {
      return const SttResult(
        text: '',
        duration: Duration.zero,
        provider: SttProvider.localWhisper,
        isFinal: true,
      );
    }

    if (_directBindings != null && _directCtx != null) {
      final sw = Stopwatch()..start();
      final text = _directBindings!.transcribeText(
        _directCtx!,
        samples,
        language: language,
        nThreads: nThreads,
        translate: translate,
      );
      final segments = _directBindings!.getSegments(_directCtx!);
      sw.stop();

      return SttResult(
        text: text,
        language: language,
        duration: sw.elapsed,
        provider: SttProvider.localWhisper,
        timestamps: segments,
        isFinal: true,
      );
    }

    final requestId = _nextRequestId++;
    final completer = Completer<SttResult>();
    _pendingRequests[requestId] = completer;
    _isProcessing = true;

    _workerSendPort!.send(
      _TranscribeCommand(
        requestId: requestId,
        samples: samples,
        language: language,
        nThreads: nThreads,
        translate: translate,
      ),
    );

    return completer.future;
  }

  /// Disposes background isolate resources and frees native Whisper memory.
  Future<void> dispose() async {
    if (_directBindings != null && _directCtx != null) {
      _directBindings!.freeContext(_directCtx!);
      _directCtx = null;
    }

    _isInitialized = false;
    _isProcessing = false;
    _currentModelPath = null;

    for (final completer in _pendingRequests.values) {
      if (!completer.isCompleted) {
        completer.completeError(
          const SttException(
            SttErrorType.unknown,
            'Whisper worker was disposed',
            provider: SttProvider.localWhisper,
          ),
        );
      }
    }
    _pendingRequests.clear();

    if (_workerSendPort != null) {
      try {
        _workerSendPort!.send(const _DisposeCommand());
      } catch (_) {}
      _workerSendPort = null;
    }

    await _subscription?.cancel();
    _subscription = null;

    _receivePort?.close();
    _receivePort = null;

    _isolate?.kill(priority: Isolate.immediate);
    _isolate = null;
  }

  // --- Background Isolate Entry Point ---

  static void _isolateEntryPoint(SendPort mainSendPort) {
    final isolateReceivePort = ReceivePort();
    mainSendPort.send(_WorkerPortReady(isolateReceivePort.sendPort));

    WhisperBindings? bindings;
    Pointer<WhisperContext>? ctx;

    isolateReceivePort.listen((message) {
      if (message is _InitCommand) {
        try {
          final oldCtx = ctx;
          final oldBindings = bindings;
          if (oldCtx != null && oldBindings != null) {
            oldBindings.freeContext(oldCtx);
            ctx = null;
          }

          final loadedBindings = WhisperBindings.load(
            customLibraryPath: message.customLibraryPath,
          );

          if (loadedBindings == null) {
            mainSendPort.send(
              const _InitResultResponse(
                success: false,
                errorMessage: 'Native whisper library (libwhisper.so) could not be loaded.',
              ),
            );
            return;
          }

          bindings = loadedBindings;

          final loadedCtx = loadedBindings.initFromFile(message.modelPath);
          if (loadedCtx == null) {
            mainSendPort.send(
              _InitResultResponse(
                success: false,
                errorMessage: 'whisper_init_from_file returned null for model ${message.modelPath}',
              ),
            );
            return;
          }

          ctx = loadedCtx;
          mainSendPort.send(const _InitResultResponse(success: true));
        } catch (e) {
          mainSendPort.send(
            _InitResultResponse(
              success: false,
              errorMessage: 'Error initializing model in isolate: $e',
            ),
          );
        }
      } else if (message is _TranscribeCommand) {
        final activeBindings = bindings;
        final activeCtx = ctx;

        if (activeBindings == null || activeCtx == null) {
          mainSendPort.send(
            _TranscribeFailureResponse(
              requestId: message.requestId,
              errorMessage: 'Model is not initialized',
              errorType: SttErrorType.modelNotLoaded,
            ),
          );
          return;
        }

        try {
          final sw = Stopwatch()..start();
          final text = activeBindings.transcribeText(
            activeCtx,
            message.samples,
            language: message.language,
            nThreads: message.nThreads,
            translate: message.translate,
          );
          final segments = activeBindings.getSegments(activeCtx);
          sw.stop();

          mainSendPort.send(
            _TranscribeSuccessResponse(
              requestId: message.requestId,
              text: text,
              language: message.language,
              durationMs: sw.elapsedMilliseconds,
              segments: segments,
            ),
          );
        } catch (e) {
          mainSendPort.send(
            _TranscribeFailureResponse(
              requestId: message.requestId,
              errorMessage: e.toString(),
              errorType: e is SttException ? e.errorType : SttErrorType.unknown,
            ),
          );
        }
      } else if (message is _DisposeCommand) {
        final activeCtx = ctx;
        final activeBindings = bindings;
        if (activeCtx != null && activeBindings != null) {
          activeBindings.freeContext(activeCtx);
          ctx = null;
        }
        isolateReceivePort.close();
      }
    });
  }
}
