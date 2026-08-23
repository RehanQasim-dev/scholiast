import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// The OAuth token pair for Google Drive synchronization, with expiry timestamp.
@immutable
class DriveTokens {
  final String accessToken;
  final int expiresAt;
  final String? refreshToken;

  const DriveTokens({
    required this.accessToken,
    required this.expiresAt,
    this.refreshToken,
  });

  /// Whether the access token is expired (or expires within 60s safety buffer).
  bool get isExpired =>
      DateTime.now().millisecondsSinceEpoch >= (expiresAt - 60000);

  DriveTokens copyWith({
    String? accessToken,
    int? expiresAt,
    String? refreshToken,
  }) {
    return DriveTokens(
      accessToken: accessToken ?? this.accessToken,
      expiresAt: expiresAt ?? this.expiresAt,
      refreshToken: refreshToken ?? this.refreshToken,
    );
  }

  factory DriveTokens.fromJson(Map<String, dynamic> json) {
    return DriveTokens(
      accessToken: json['accessToken'] as String? ?? '',
      expiresAt: (json['expiresAt'] as num?)?.toInt() ?? 0,
      refreshToken: json['refreshToken'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'accessToken': accessToken,
        'expiresAt': expiresAt,
        if (refreshToken != null) 'refreshToken': refreshToken,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DriveTokens &&
          runtimeType == other.runtimeType &&
          accessToken == other.accessToken &&
          expiresAt == other.expiresAt &&
          refreshToken == other.refreshToken;

  @override
  int get hashCode => Object.hash(accessToken, expiresAt, refreshToken);

  @override
  String toString() =>
      'DriveTokens(accessToken: ***, expiresAt: $expiresAt, hasRefresh: ${refreshToken != null})';
}

/// Secure credential and token storage backed by [FlutterSecureStorage].
///
/// Encrypted using Android Keystore (EncryptedSharedPreferences) on Android
/// and libsecret / Keyring on Linux Desktop.
class SecureTokenStore {
  final FlutterSecureStorage _storage;

  static const String keyDriveTokens = 'drive.tokens';
  static const String keyGroqApiKey = 'api_key.groq';
  static const String keyGeminiApiKey = 'api_key.gemini';
  static const String keyOpenAiApiKey = 'api_key.openai';
  static const String _pendingPrefix = 'oauth.pending:';

  SecureTokenStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              lOptions: LinuxOptions(),
            );

  // --- Drive OAuth Tokens ---

  /// Persists Drive OAuth credentials.
  Future<void> saveDriveTokens(DriveTokens tokens) async {
    await write(keyDriveTokens, jsonEncode(tokens.toJson()));
  }

  /// Loads Drive OAuth credentials, returning null if absent or unparseable.
  Future<DriveTokens?> loadDriveTokens() async {
    final raw = await read(keyDriveTokens);
    if (raw == null || raw.isEmpty) return null;
    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      return DriveTokens.fromJson(json);
    } catch (_) {
      return null;
    }
  }

  /// Clears stored Drive OAuth credentials.
  Future<void> clearDriveTokens() async {
    await delete(keyDriveTokens);
  }

  // --- PKCE Authorization Flow Bookkeeping ---

  /// Saves a pending PKCE code verifier for an in-flight OAuth flow.
  Future<void> savePendingVerifier({
    required String state,
    required String verifier,
  }) async {
    await write('$_pendingPrefix$state', verifier);
  }

  /// Loads the pending PKCE code verifier for [state].
  Future<String?> loadPendingVerifier(String state) async {
    return read('$_pendingPrefix$state');
  }

  /// Consumes and deletes the pending PKCE code verifier for [state].
  Future<String?> takePendingVerifier(String state) async {
    final key = '$_pendingPrefix$state';
    final verifier = await read(key);
    if (verifier != null) {
      await delete(key);
    }
    return verifier;
  }

  /// Clears the pending PKCE verifier for [state].
  Future<void> clearPendingVerifier(String state) async {
    await delete('$_pendingPrefix$state');
  }

  // --- Cloud STT & AI API Keys ---

  /// Saves an API key for a specified [provider] (e.g. "groq", "gemini").
  Future<void> saveApiKey(String provider, String apiKey) async {
    await write('api_key.$provider', apiKey);
  }

  /// Retrieves the API key for [provider].
  Future<String?> getApiKey(String provider) async {
    return read('api_key.$provider');
  }

  /// Deletes the API key for [provider].
  Future<void> deleteApiKey(String provider) async {
    await delete('api_key.$provider');
  }

  // --- Generic Primitive Operations ---

  /// Writes a raw key-value pair to secure storage.
  Future<void> write(String key, String value) async {
    await _storage.write(key: key, value: value);
  }

  /// Reads a raw value from secure storage.
  Future<String?> read(String key) async {
    try {
      return await _storage.read(key: key);
    } catch (_) {
      return null;
    }
  }

  /// Deletes a key from secure storage.
  Future<void> delete(String key) async {
    try {
      await _storage.delete(key: key);
    } catch (_) {}
  }

  /// Clears all keys from secure storage.
  Future<void> deleteAll() async {
    try {
      await _storage.deleteAll();
    } catch (_) {}
  }

  /// Checks if a key exists in secure storage.
  Future<bool> containsKey(String key) async {
    try {
      return await _storage.containsKey(key: key);
    } catch (_) {
      return false;
    }
  }

  /// Reads all key-value pairs from secure storage.
  Future<Map<String, String>> readAll() async {
    try {
      return await _storage.readAll();
    } catch (_) {
      return <String, String>{};
    }
  }
}
