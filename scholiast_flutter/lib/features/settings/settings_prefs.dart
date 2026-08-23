import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/auth/secure_token_store.dart';
import '../../core/stt/stt_models.dart';
import '../../core/stt/whisper_model_manager.dart';

/// Non-secret app settings backed by [SharedPreferences].
///
/// Mirrors the Android `SettingsPrefs` (DataStore) + `ReaderPrefs` surface:
/// - Reader display: [fontStep] (0..4) and [serifDefault]
/// - Speech: preferred transcriber, speech language, active local Whisper model
///
/// Cloud API keys (Groq / Gemini / OpenAI) are stored via [SecureTokenStore]
/// (platform Keystore / Keyring), not here — see [tokenStoreProvider].
class SettingsPrefs {
  final SharedPreferences _prefs;

  SettingsPrefs(this._prefs);

  // --- Keys ---------------------------------------------------------------

  static const _kFontStep = 'font_step';
  static const _kSerif = 'serif';
  static const _kPreferredTranscriber = 'preferred_transcriber';
  static const _kSpeechLanguage = 'speech_language';
  static const _kActiveWhisperModel = 'active_whisper_model';

  static const int defaultFontStep = 1;
  static const int minFontStep = 0;
  static const int maxFontStep = 4;

  // --- Reader display -----------------------------------------------------

  /// Text-size step, clamped 0..4 (default 1). Mirrors `ReaderPrefs.DEFAULT_FONT_STEP`.
  int get fontStep {
    final v = _prefs.getInt(_kFontStep);
    if (v == null) return defaultFontStep;
    return v.clamp(minFontStep, maxFontStep);
  }

  /// Serif font toggle (default false).
  bool get serifDefault => _prefs.getBool(_kSerif) ?? false;

  Future<void> setFontStep(int step) async {
    final clamped = step.clamp(minFontStep, maxFontStep);
    await _prefs.setInt(_kFontStep, clamped);
  }

  Future<void> setSerifDefault(bool serif) =>
      _prefs.setBool(_kSerif, serif);

  // --- Speech -------------------------------------------------------------

  SttProvider get preferredTranscriber =>
      SttProvider.fromId(_prefs.getString(_kPreferredTranscriber) ?? '');

  String? get speechLanguage {
    final value = _prefs.getString(_kSpeechLanguage);
    if (value == null || value.isEmpty || value == 'auto') return null;
    return value;
  }

  String? get activeWhisperModelId => _prefs.getString(_kActiveWhisperModel);

  Future<void> setPreferredTranscriber(SttProvider provider) =>
      _prefs.setString(_kPreferredTranscriber, provider.id);

  Future<void> setSpeechLanguage(String? lang) async {
    if (lang == null || lang.isEmpty) {
      await _prefs.remove(_kSpeechLanguage);
    } else {
      await _prefs.setString(_kSpeechLanguage, lang);
    }
  }

  Future<void> setActiveWhisperModelId(String? modelId) async {
    if (modelId == null || modelId.isEmpty) {
      await _prefs.remove(_kActiveWhisperModel);
    } else {
      await _prefs.setString(_kActiveWhisperModel, modelId);
    }
  }

  // --- Cloud API keys (delegated to SecureTokenStore) --------------------

  /// Helper to read a cloud API key from [SecureTokenStore].
  /// Kept here for parity with Android `SettingsPrefs.apiKey(service)`.
  static Future<String?> readApiKey(
    SecureTokenStore store,
    String provider,
  ) =>
      store.getApiKey(provider);

  static Future<void> writeApiKey(
    SecureTokenStore store,
    String provider,
    String? key,
  ) async {
    if (key == null || key.isEmpty) {
      await store.deleteApiKey(provider);
    } else {
      await store.saveApiKey(provider, key);
    }
  }
}

/// Loads the [SettingsPrefs] singleton from the platform preferences store.
///
/// In tests, override with a fake via:
/// ```dart
/// SharedPreferences.setMockInitialValues({ ... });
/// final prefs = await SharedPreferences.getInstance();
/// ProviderScope(overrides: [ settingsPrefsProvider.overrideWith((ref) async => SettingsPrefs(prefs)) ])
/// ```
/// or simply call `SharedPreferences.setMockInitialValues` before pumping.
final settingsPrefsProvider = FutureProvider<SettingsPrefs>((ref) async {
  final prefs = await SharedPreferences.getInstance();
  return SettingsPrefs(prefs);
});

/// Provides the [WhisperModelManager] for downloading and managing
/// local GGML Whisper model files.
final whisperModelManagerProvider = Provider<WhisperModelManager>((ref) {
  return WhisperModelManager();
});

/// Speech languages offered by the speech-language picker.
const speechLanguages = <String?>[
  null,
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'zh',
  'ja',
  'ko',
  'ru',
  'ar',
  'hi',
];

/// Friendly display name for a speech-language code.
String speechLanguageLabel(String? code) => switch (code) {
      null => 'English',
      'auto' => 'Auto-detect',
      'es' => 'Spanish (Español)',
      'fr' => 'French (Français)',
      'de' => 'German (Deutsch)',
      'it' => 'Italian (Italiano)',
      'pt' => 'Portuguese (Português)',
      'zh' => 'Chinese (中文)',
      'ja' => 'Japanese (日本語)',
      'ko' => 'Korean (한국어)',
      'ru' => 'Russian (Русский)',
      'ar' => 'Arabic (العربية)',
      'hi' => 'Hindi (हिन्दी)',
      _ => code,
    };
