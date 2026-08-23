import 'dart:async';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'stt_models.dart';

/// Manages downloading, caching, integrity verification, and deletion of local GGML Whisper models.
class WhisperModelManager {
  final Dio _dio;
  final String? customDirectoryPath;
  final List<WhisperModelInfo> _customModels = [];

  WhisperModelManager({
    Dio? dio,
    this.customDirectoryPath,
  }) : _dio = dio ?? Dio();

  /// Resolves the local on-disk folder where GGML models are cached.
  Future<String> getModelsDirectory() async {
    final customPath = customDirectoryPath;
    if (customPath != null) {
      final dir = Directory(customPath);
      if (!await dir.exists()) {
        await dir.create(recursive: true);
      }
      return dir.path;
    }

    final appSupportDir = await getApplicationSupportDirectory();
    final modelsDir = Directory(p.join(appSupportDir.path, 'whisper_models'));
    if (!await modelsDir.exists()) {
      await modelsDir.create(recursive: true);
    }
    return modelsDir.path;
  }

  /// Returns the complete list of known Whisper models with updated local on-disk status.
  Future<List<WhisperModelInfo>> getAvailableModels() async {
    final modelsDir = await getModelsDirectory();
    final allKnown = [...WhisperModelInfo.standardModels, ..._customModels];
    final result = <WhisperModelInfo>[];

    for (final info in allKnown) {
      final targetFile = File(p.join(modelsDir, info.fileName));
      final exists = await targetFile.exists();
      final size = exists ? await targetFile.length() : info.sizeBytes;

      result.add(
        info.copyWith(
          isDownloaded: exists && size > 0,
          localPath: exists && size > 0 ? targetFile.path : null,
          sizeBytes: size,
        ),
      );
    }

    // Discover any additional .bin files in modelsDir not in the catalogue
    try {
      final dir = Directory(modelsDir);
      final files = await dir.list().toList();
      for (final entity in files) {
        if (entity is File &&
            entity.path.endsWith('.bin') &&
            !allKnown.any((m) => m.fileName == p.basename(entity.path))) {
          final fileName = p.basename(entity.path);
          final id = fileName.replaceAll('.bin', '').replaceAll('ggml-', '');
          final size = await entity.length();
          result.add(
            WhisperModelInfo(
              id: id,
              name: 'Imported Model ($fileName)',
              url: '',
              fileName: fileName,
              sizeBytes: size,
              isDownloaded: true,
              localPath: entity.path,
            ),
          );
        }
      }
    } catch (_) {}

    return result;
  }

  /// Retrieves model information for a given [modelId].
  Future<WhisperModelInfo?> getModelInfo(String modelId) async {
    final models = await getAvailableModels();
    return models.where((m) => m.id == modelId).firstOrNull;
  }

  /// Gets the on-disk file path for [modelId] if downloaded, or null if not present.
  Future<String?> getDownloadedModelPath(String modelId) async {
    final info = await getModelInfo(modelId);
    if (info != null && info.isDownloaded && info.localPath != null) {
      return info.localPath;
    }
    return null;
  }

  /// Downloads the GGML model for [modelId] with progress tracking.
  Future<File> downloadModel(
    String modelId, {
    void Function(int received, int total, double progress)? onProgress,
    CancelToken? cancelToken,
  }) async {
    final catalogue = await getAvailableModels();
    final modelInfo = catalogue.where((m) => m.id == modelId).firstOrNull;

    if (modelInfo == null) {
      throw SttException(
        SttErrorType.invalidAudio,
        'Unknown model ID: $modelId',
        provider: SttProvider.localWhisper,
      );
    }

    if (modelInfo.url.isEmpty) {
      throw SttException(
        SttErrorType.invalidAudio,
        'Model $modelId has no download URL',
        provider: SttProvider.localWhisper,
      );
    }

    final modelsDir = await getModelsDirectory();
    final targetPath = p.join(modelsDir, modelInfo.fileName);
    final tempPath = p.join(modelsDir, '${modelInfo.fileName}.download');

    final tempFile = File(tempPath);
    if (await tempFile.exists()) {
      await tempFile.delete();
    }

    try {
      await _dio.download(
        modelInfo.url,
        tempPath,
        cancelToken: cancelToken,
        onReceiveProgress: (received, total) {
          final totalBytes = total > 0 ? total : modelInfo.sizeBytes;
          final progress = totalBytes > 0
              ? (received / totalBytes).clamp(0.0, 1.0)
              : 0.0;
          if (onProgress != null) {
            onProgress(received, totalBytes, progress);
          }
        },
      );

      final downloadedFile = File(tempPath);
      final length = await downloadedFile.length();
      if (length == 0) {
        throw const SttException(
          SttErrorType.network,
          'Downloaded model file was empty',
          provider: SttProvider.localWhisper,
        );
      }

      // Check SHA256 checksum if specified
      if (modelInfo.sha256 != null && modelInfo.sha256!.isNotEmpty) {
        final bytes = await downloadedFile.readAsBytes();
        final digest = sha256.convert(bytes).toString();
        if (digest.toLowerCase() != modelInfo.sha256!.toLowerCase()) {
          await downloadedFile.delete();
          throw SttException(
            SttErrorType.network,
            'Model checksum mismatch: expected ${modelInfo.sha256}, got $digest',
            provider: SttProvider.localWhisper,
          );
        }
      }

      final targetFile = File(targetPath);
      if (await targetFile.exists()) {
        await targetFile.delete();
      }

      await downloadedFile.rename(targetPath);
      return targetFile;
    } catch (e) {
      if (await tempFile.exists()) {
        try {
          await tempFile.delete();
        } catch (_) {}
      }
      if (e is SttException) rethrow;
      throw SttException(
        SttErrorType.network,
        'Failed to download model $modelId: $e',
        provider: SttProvider.localWhisper,
        cause: e,
      );
    }
  }

  /// Downloads [modelId] returning a [Stream] of fractional progress values (0.0 to 1.0).
  Stream<double> downloadModelStream(
    String modelId, {
    CancelToken? cancelToken,
  }) {
    final controller = StreamController<double>();

    downloadModel(
      modelId,
      cancelToken: cancelToken,
      onProgress: (received, total, progress) {
        if (!controller.isClosed) {
          controller.add(progress);
        }
      },
    ).then((file) {
      if (!controller.isClosed) {
        controller.add(1.0);
        controller.close();
      }
    }).catchError((Object error, StackTrace stack) {
      if (!controller.isClosed) {
        controller.addError(error, stack);
        controller.close();
      }
    });

    return controller.stream;
  }

  /// Deletes a cached local model file.
  Future<bool> deleteModel(String modelId) async {
    final modelsDir = await getModelsDirectory();
    final models = await getAvailableModels();
    final model = models.where((m) => m.id == modelId).firstOrNull;

    if (model == null) return false;

    final file = File(p.join(modelsDir, model.fileName));
    if (await file.exists()) {
      await file.delete();
      return true;
    }
    return false;
  }

  /// Imports an existing GGML model file from [sourceFilePath] into the models cache directory.
  Future<WhisperModelInfo> importModelFile(
    String sourceFilePath, {
    String? modelId,
    String? name,
  }) async {
    final sourceFile = File(sourceFilePath);
    if (!await sourceFile.exists()) {
      throw SttException(
        SttErrorType.invalidAudio,
        'Source model file does not exist: $sourceFilePath',
        provider: SttProvider.localWhisper,
      );
    }

    final fileName = p.basename(sourceFilePath);
    final modelsDir = await getModelsDirectory();
    final destPath = p.join(modelsDir, fileName);
    final destFile = File(destPath);

    if (destFile.path != sourceFile.path) {
      await sourceFile.copy(destPath);
    }

    final id = modelId ??
        fileName.replaceAll('.bin', '').replaceAll('ggml-', '');
    final length = await destFile.length();

    final modelInfo = WhisperModelInfo(
      id: id,
      name: name ?? 'Imported ($fileName)',
      url: '',
      fileName: fileName,
      sizeBytes: length,
      isDownloaded: true,
      localPath: destPath,
    );

    _customModels.removeWhere((m) => m.id == id);
    _customModels.add(modelInfo);

    return modelInfo;
  }
}
