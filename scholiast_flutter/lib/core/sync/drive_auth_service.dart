import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../auth/secure_token_store.dart';
import 'sync_models.dart';

/// Configuration for Google Drive OAuth 2.0 PKCE authentication.
@immutable
class OAuthConfig {
  final String nativeClientId;
  final String nativeClientSecret;
  final String redirectUri;
  final String authorizeEndpoint;
  final String tokenEndpoint;
  final String revokeEndpoint;
  final String scope;

  const OAuthConfig({
    this.nativeClientId = placeholderClientId,
    this.nativeClientSecret = placeholderClientSecret,
    this.redirectUri = defaultRedirectUri,
    this.authorizeEndpoint = 'https://accounts.google.com/o/oauth2/v2/auth',
    this.tokenEndpoint = 'https://oauth2.googleapis.com/token',
    this.revokeEndpoint = 'https://oauth2.googleapis.com/revoke',
    this.scope = scopeDriveAppdata,
  });

  static const String scopeDriveAppdata =
      'https://www.googleapis.com/auth/drive.appdata';
  static const String defaultRedirectUri = 'scholiast://oauth2redirect';
  static const String placeholderClientId =
      '000000000000-yyyyyyyyyyyyyyyyyyyyyyyyyyyy.apps.googleusercontent.com';
  static const String placeholderClientSecret =
      'GOCSPX-zzzzzzzzzzzzzzzzzzzzzzzz';

  /// True when the build carries real OAuth client credentials.
  bool get isConfigured =>
      nativeClientId.trim().isNotEmpty &&
      !nativeClientId.startsWith('000000000000') &&
      nativeClientId != placeholderClientId &&
      nativeClientSecret.trim().isNotEmpty &&
      nativeClientSecret != placeholderClientSecret &&
      !nativeClientSecret.startsWith('GOCSPX-zzzzzz');

  OAuthConfig copyWith({
    String? nativeClientId,
    String? nativeClientSecret,
    String? redirectUri,
    String? authorizeEndpoint,
    String? tokenEndpoint,
    String? revokeEndpoint,
    String? scope,
  }) {
    return OAuthConfig(
      nativeClientId: nativeClientId ?? this.nativeClientId,
      nativeClientSecret: nativeClientSecret ?? this.nativeClientSecret,
      redirectUri: redirectUri ?? this.redirectUri,
      authorizeEndpoint: authorizeEndpoint ?? this.authorizeEndpoint,
      tokenEndpoint: tokenEndpoint ?? this.tokenEndpoint,
      revokeEndpoint: revokeEndpoint ?? this.revokeEndpoint,
      scope: scope ?? this.scope,
    );
  }
}

/// Helper for RFC 7636 Proof Key for Code Exchange (PKCE).
abstract final class Pkce {
  static final Random _rng = Random.secure();

  /// Generates a cryptographically secure, URL-safe random verifier (96 bytes -> 128 chars).
  static String generateVerifier([int byteLength = 96]) {
    final bytes = List<int>.generate(byteLength, (_) => _rng.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }

  /// Calculates the SHA-256 challenge for [verifier] (RFC 7636 §4.2).
  static String generateChallenge(String verifier) {
    final bytes = ascii.encode(verifier);
    final digest = sha256.convert(bytes);
    return base64Url.encode(digest.bytes).replaceAll('=', '');
  }
}

/// Pending OAuth authorization state.
@immutable
class PendingAuth {
  final String state;
  final String verifier;
  final String authUrl;
  final String redirectUri;

  const PendingAuth({
    required this.state,
    required this.verifier,
    required this.authUrl,
    required this.redirectUri,
  });
}

/// Active loopback server session for Linux desktop OAuth code capture.
class LoopbackAuthSession {
  final HttpServer server;
  final int port;
  final String redirectUri;
  final String state;
  final String verifier;
  final String authUrl;

  LoopbackAuthSession({
    required this.server,
    required this.port,
    required this.redirectUri,
    required this.state,
    required this.verifier,
    required this.authUrl,
  });

  void close() {
    try {
      server.close(force: true);
    } catch (_) {}
  }
}

/// Service handling OAuth 2.0 with PKCE for Google Drive across Linux and Android.
class DriveAuthService {
  final SecureTokenStore tokenStore;
  final OAuthConfig config;
  final Dio dio;
  final int Function() now;

  DriveAuthService({
    required this.tokenStore,
    this.config = const OAuthConfig(),
    Dio? dio,
    int Function()? now,
  })  : dio = dio ?? Dio(),
        now = now ?? (() => DateTime.now().millisecondsSinceEpoch);

  /// True when the build carries real OAuth client configuration.
  bool get isConfigured => config.isConfigured;

  /// Checks if valid Google Drive credentials are currently stored.
  Future<bool> isConnected() async {
    final tokens = await tokenStore.loadDriveTokens();
    return tokens != null && tokens.accessToken.isNotEmpty;
  }

  /// Starts a local HTTP loopback server on Linux to capture OAuth redirect code.
  Future<LoopbackAuthSession> startLoopbackSession({int port = 0}) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, port);
    final localPort = server.port;
    final redirectUri = 'http://127.0.0.1:$localPort/oauth2callback';
    final state = Pkce.generateVerifier(16);
    final verifier = Pkce.generateVerifier();
    final challenge = Pkce.generateChallenge(verifier);

    final authUrl = buildAuthUrl(
      verifier: verifier,
      challenge: challenge,
      state: state,
      redirectUri: redirectUri,
    );

    return LoopbackAuthSession(
      server: server,
      port: localPort,
      redirectUri: redirectUri,
      state: state,
      verifier: verifier,
      authUrl: authUrl,
    );
  }

  /// Waits for the incoming OAuth callback on the loopback server and completes authorization.
  Future<DriveTokens> waitForLoopbackCallback(
    LoopbackAuthSession session, {
    Duration timeout = const Duration(minutes: 5),
  }) async {
    try {
      final request = await session.server.first.timeout(timeout);
      final uri = request.uri;
      final queryParams = uri.queryParameters;

      final state = queryParams['state'];
      final error = queryParams['error'];
      final code = queryParams['code'];

      // Respond to user browser
      final response = request.response;
      response.headers.contentType = ContentType.html;
      if (error != null || code == null || state != session.state) {
        response.statusCode = HttpStatus.badRequest;
        response.write('''
<!DOCTYPE html>
<html>
<head><title>Authentication Failed</title></head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px;">
  <h2>Authentication Failed</h2>
  <p>${error ?? 'Invalid authorization response.'}</p>
</body>
</html>
''');
      } else {
        response.statusCode = HttpStatus.ok;
        response.write('''
<!DOCTYPE html>
<html>
<head><title>Authorization Successful</title></head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px; background-color: #0f172a; color: #f8fafc;">
  <h2>Authentication Successful!</h2>
  <p>You can close this tab and return to Scholiast.</p>
</body>
</html>
''');
      }
      await response.close();

      if (state != session.state) {
        throw const OAuthStateMismatchException();
      }
      if (error != null) {
        if (error == 'access_denied') {
          throw const OAuthUserDeniedException();
        }
        throw OAuthTokenRequestFailedException(error: error);
      }
      if (code == null || code.isEmpty) {
        throw const OAuthNoCodeException();
      }

      return await exchangeCode(
        code: code,
        verifier: session.verifier,
        redirectUri: session.redirectUri,
      );
    } on TimeoutException {
      throw const OAuthTimeoutException();
    } finally {
      session.close();
    }
  }

  /// Begins an authorization flow for Android or manual handling.
  Future<PendingAuth> beginAuth({String? redirectUri}) async {
    final uri = redirectUri ?? config.redirectUri;
    final state = Pkce.generateVerifier(16);
    final verifier = Pkce.generateVerifier();
    final challenge = Pkce.generateChallenge(verifier);

    final authUrl = buildAuthUrl(
      verifier: verifier,
      challenge: challenge,
      state: state,
      redirectUri: uri,
    );

    await tokenStore.savePendingVerifier(state: state, verifier: verifier);

    return PendingAuth(
      state: state,
      verifier: verifier,
      authUrl: authUrl,
      redirectUri: uri,
    );
  }

  /// Builds the Google OAuth consent URL.
  String buildAuthUrl({
    required String verifier,
    String? challenge,
    required String state,
    String? redirectUri,
  }) {
    final c = challenge ?? Pkce.generateChallenge(verifier);
    final rUri = redirectUri ?? config.redirectUri;

    final params = <String, String>{
      'client_id': config.nativeClientId,
      'response_type': 'code',
      'redirect_uri': rUri,
      'scope': config.scope,
      'code_challenge': c,
      'code_challenge_method': 'S256',
      'access_type': 'offline',
      'prompt': 'consent',
      'state': state,
    };

    final query = params.entries
        .map((e) =>
            '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}')
        .join('&');

    return '${config.authorizeEndpoint}?$query';
  }

  /// Completes an authorization flow from a redirect URI string.
  Future<DriveTokens> completeAuth({
    required String redirectUriOrQuery,
    required String state,
    String? redirectUri,
  }) async {
    final uri = Uri.tryParse(redirectUriOrQuery);
    final queryParams = uri != null && uri.hasQuery
        ? uri.queryParameters
        : Uri.splitQueryString(redirectUriOrQuery.contains('?')
            ? redirectUriOrQuery.substring(redirectUriOrQuery.indexOf('?') + 1)
            : redirectUriOrQuery);

    final returnedState = queryParams['state'];
    if (returnedState == null || returnedState != state) {
      throw const OAuthStateMismatchException();
    }

    final error = queryParams['error'];
    if (error != null) {
      if (error == 'access_denied') {
        throw const OAuthUserDeniedException();
      }
      throw OAuthTokenRequestFailedException(error: error);
    }

    final code = queryParams['code'];
    if (code == null || code.isEmpty) {
      throw const OAuthNoCodeException();
    }

    final verifier = await tokenStore.takePendingVerifier(state);
    if (verifier == null || verifier.isEmpty) {
      throw const OAuthStateMismatchException(
          'No pending verifier found for the authorization state');
    }

    final rUri = redirectUri ?? config.redirectUri;
    return await exchangeCode(
      code: code,
      verifier: verifier,
      redirectUri: rUri,
    );
  }

  /// Exchanges an authorization code for Drive OAuth tokens.
  Future<DriveTokens> exchangeCode({
    required String code,
    required String verifier,
    required String redirectUri,
  }) async {
    try {
      final form = <String, String>{
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': redirectUri,
        'client_id': config.nativeClientId,
        'client_secret': config.nativeClientSecret,
        'code_verifier': verifier,
      };

      final response = await dio.post<dynamic>(
        config.tokenEndpoint,
        data: form,
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          responseType: ResponseType.json,
        ),
      );

      final rawData = response.data;
      final Map<String, dynamic> data = rawData is Map<String, dynamic>
          ? rawData
          : (rawData is Map
              ? Map<String, dynamic>.from(rawData)
              : (rawData is String
                  ? (jsonDecode(rawData) as Map<String, dynamic>)
                  : <String, dynamic>{}));
      final accessToken = data['access_token'] as String?;
      if (accessToken == null || accessToken.isEmpty) {
        throw const OAuthTokenRequestFailedException(
          error: 'missing_access_token',
          errorDescription: 'No access token returned from token endpoint',
        );
      }

      final expiresIn = (data['expires_in'] as num?)?.toInt() ?? 3600;
      final refreshToken = data['refresh_token'] as String?;

      final tokens = DriveTokens(
        accessToken: accessToken,
        expiresAt: now() + (expiresIn - 60) * 1000,
        refreshToken: refreshToken,
      );

      await tokenStore.saveDriveTokens(tokens);
      return tokens;
    } on DioException catch (e) {
      final data = e.response?.data;
      String? error;
      String? desc;
      if (data is Map) {
        error = data['error'] as String?;
        desc = data['error_description'] as String?;
      } else if (data is String) {
        try {
          final parsed = jsonDecode(data) as Map<String, dynamic>;
          error = parsed['error'] as String?;
          desc = parsed['error_description'] as String?;
        } catch (_) {}
      }
      throw OAuthTokenRequestFailedException(
        error: error ?? e.message,
        errorDescription: desc,
        invalidGrant: error == 'invalid_grant',
        cause: e,
      );
    } catch (e) {
      if (e is OAuthException) rethrow;
      throw OAuthNetworkException(e);
    }
  }

  /// Refreshes the access token using the stored refresh token.
  Future<DriveTokens> refreshTokens(String refreshToken) async {
    try {
      final form = <String, String>{
        'grant_type': 'refresh_token',
        'refresh_token': refreshToken,
        'client_id': config.nativeClientId,
        'client_secret': config.nativeClientSecret,
      };

      final response = await dio.post<dynamic>(
        config.tokenEndpoint,
        data: form,
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          responseType: ResponseType.json,
        ),
      );

      final rawData = response.data;
      final Map<String, dynamic> data = rawData is Map<String, dynamic>
          ? rawData
          : (rawData is Map
              ? Map<String, dynamic>.from(rawData)
              : (rawData is String
                  ? (jsonDecode(rawData) as Map<String, dynamic>)
                  : <String, dynamic>{}));
      final accessToken = data['access_token'] as String?;
      if (accessToken == null || accessToken.isEmpty) {
        throw const OAuthTokenRequestFailedException(
          error: 'missing_access_token',
          errorDescription: 'No access token returned from refresh request',
        );
      }

      final expiresIn = (data['expires_in'] as num?)?.toInt() ?? 3600;
      final newRefreshToken = data['refresh_token'] as String? ?? refreshToken;

      final tokens = DriveTokens(
        accessToken: accessToken,
        expiresAt: now() + (expiresIn - 60) * 1000,
        refreshToken: newRefreshToken,
      );

      await tokenStore.saveDriveTokens(tokens);
      return tokens;
    } on DioException catch (e) {
      final data = e.response?.data;
      String? error;
      String? desc;
      if (data is Map) {
        error = data['error'] as String?;
        desc = data['error_description'] as String?;
      } else if (data is String) {
        try {
          final parsed = jsonDecode(data) as Map<String, dynamic>;
          error = parsed['error'] as String?;
          desc = parsed['error_description'] as String?;
        } catch (_) {}
      }
      throw OAuthTokenRequestFailedException(
        error: error ?? e.message,
        errorDescription: desc,
        invalidGrant: error == 'invalid_grant',
        cause: e,
      );
    } catch (e) {
      if (e is OAuthException) rethrow;
      throw OAuthNetworkException(e);
    }
  }

  /// Returns a valid access token, minting or refreshing as needed.
  Future<String> getAccessToken({bool interactive = false}) async {
    if (!config.isConfigured) {
      throw const OAuthNotConfiguredException();
    }

    final cached = await tokenStore.loadDriveTokens();
    if (cached == null) {
      if (!interactive) throw const OAuthNotConnectedException();
      // Interactive login flow required
      throw const OAuthNotConnectedException(
          'Interactive authentication required');
    }

    // Still valid
    if (cached.expiresAt > now()) {
      return cached.accessToken;
    }

    // Needs refresh
    if (cached.refreshToken != null && cached.refreshToken!.isNotEmpty) {
      try {
        final fresh = await refreshTokens(cached.refreshToken!);
        return fresh.accessToken;
      } on OAuthTokenRequestFailedException catch (e) {
        if (e.invalidGrant) {
          await tokenStore.clearDriveTokens();
          throw const OAuthNotConnectedException('Refresh token expired or revoked');
        }
        if (!interactive) rethrow;
      }
    }

    if (!interactive) {
      throw const OAuthNotConnectedException();
    }
    throw const OAuthNotConnectedException(
        'Interactive authentication required');
  }

  /// Forces the next token request to refresh against Google servers.
  Future<void> invalidateAccessToken() async {
    final cached = await tokenStore.loadDriveTokens();
    if (cached == null) return;
    if (cached.refreshToken != null && cached.refreshToken!.isNotEmpty) {
      await tokenStore.saveDriveTokens(cached.copyWith(expiresAt: 0));
    } else {
      await tokenStore.clearDriveTokens();
    }
  }

  /// Disconnects from Google Drive, revoking credentials and clearing local token storage.
  Future<void> disconnect() async {
    final cached = await tokenStore.loadDriveTokens();
    await tokenStore.clearDriveTokens();

    final revokable = cached?.refreshToken ?? cached?.accessToken;
    if (revokable != null && revokable.isNotEmpty) {
      try {
        await dio.post<void>(
          '${config.revokeEndpoint}?token=${Uri.encodeQueryComponent(revokable)}',
          options: Options(contentType: Headers.formUrlEncodedContentType),
        );
      } catch (_) {
        // Best effort revocation
      }
    }
  }
}
