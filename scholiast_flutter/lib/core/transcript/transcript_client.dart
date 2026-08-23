import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../algorithms/cue_parser.dart';
import '../algorithms/transcript_chunker.dart';
import '../models/transcript_models.dart';

/// Innertube caption-track client — Dart port of
/// `android/app/src/main/java/com/scholiast/android/domain/transcript/TranscriptClient.kt`
/// and the desktop `tracksFromInnertube` + `loadTranscript` (video-transcript.ts).
///
/// Flow: `POST youtubei/v1/player` with the IOS client context (falling back to
/// the WEB context when IOS yields no captions) → `captionTracks` → [pickTrack]
/// (session preference → English non-ASR → first) → fetch the track's `baseUrl`
/// with `&fmt=json3` → parse cues → chunk into paragraphs.
///
/// Session state mirrors the Kotlin desktop's module-level maps; a [TranscriptClient]
/// instance lives for the app session and is shared across videos.
class TranscriptClient {
  static const String innertubePlayerUrl =
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

  static const Map<String, String> _iosContext = {
    'clientName': 'IOS',
    'clientVersion': '20.10.3',
  };

  static const Map<String, String> _webContext = {
    'clientName': 'WEB',
    'clientVersion': '2.20240101.00.00',
  };

  final http.Client _http;
  final String playerEndpoint;

  // Session caches — mirrors Kotlin maps.
  final Map<String, List<CaptionTrack>> _tracksCache = {};
  final Map<String, LoadedTranscript> _transcriptCache = {};
  final Map<String, String> _sessionLangPref = {};

  TranscriptClient({
    http.Client? httpClient,
    this.playerEndpoint = innertubePlayerUrl,
  }) : _http = httpClient ?? http.Client();

  /// Per-video session language choice (plan §2: "per-video session choice").
  void setSessionLanguage(String videoId, String code) {
    _sessionLangPref[videoId] = code;
  }

  /// Track list for the language picker — cached per video.
  /// Returns `null` when discovery failed (network/HTTP), empty when no captions.
  Future<List<CaptionTrack>?> fetchTracks(String videoId) async {
    final cached = _tracksCache[videoId];
    if (cached != null) return cached;
    final d = await _discoverTracks(videoId);
    if (d is _TracksFound) {
      _tracksCache[videoId] = d.tracks;
      return d.tracks;
    }
    return null;
  }

  Future<TranscriptResult> getTranscript(
    String videoId, [
    String? preferredLang,
  ]) async {
    final lang = preferredLang ?? _sessionLangPref[videoId];
    try {
      return await _getTranscriptInternal(videoId, lang);
    } catch (e) {
      // http throws ClientException / SocketException on network failure.
      return TranscriptNetworkError(e);
    }
  }

  Future<TranscriptResult> _getTranscriptInternal(
    String videoId,
    String? lang,
  ) async {
    final cacheKey = '$videoId:${lang ?? ''}';
    final cached = _transcriptCache[cacheKey];
    if (cached != null) return TranscriptSuccess(cached);

    final discovery = await _discoverTracks(videoId);
    if (discovery is _NoCaptions) return const TranscriptNoCaptions();
    if (discovery is _Failed) return discovery.toResult();

    final tracks = (discovery as _TracksFound).tracks;
    _tracksCache[videoId] = tracks;

    final track = pickTrack(tracks, lang);
    if (track == null) return const TranscriptNoCaptions();

    final url = _appendFmtJson3(track.baseUrl);
    final resp = await _get(url, lang);
    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      return TranscriptHttpError(resp.statusCode);
    }
    final body = resp.body;
    if (body.isEmpty) {
      return const TranscriptParseError('empty caption response');
    }
    final cues = CueParser.parse(body);
    if (cues.isEmpty) return const TranscriptNoCaptions();

    final loaded = LoadedTranscript(
      videoId: videoId,
      languageCode: track.languageCode,
      tracks: tracks,
      cues: cues,
      paragraphs: TranscriptChunker.chunk(cues),
    );
    _transcriptCache[cacheKey] = loaded;
    return TranscriptSuccess(loaded);
  }

  // --- Track discovery -------------------------------------------------------

  Future<_Discovery> _discoverTracks(String videoId) async {
    for (final ctx in [_iosContext, _webContext]) {
      final body = jsonEncode({
        'context': {'client': ctx},
        'videoId': videoId,
      });
      final resp = await _post(playerEndpoint, body);
      if (resp.statusCode < 200 || resp.statusCode >= 300) {
        return _Failed(statusCode: resp.statusCode);
      }
      final text = resp.body;
      if (text.isEmpty) {
        return _Failed(cause: Exception('empty player response'));
      }
      final tracks = _parseCaptionTracks(text);
      if (tracks.isNotEmpty) return _TracksFound(tracks);
      // No captions from this client context — try the next one.
    }
    return const _NoCaptions();
  }

  // --- Response parsing seam -------------------------------------------------

  /// `captions.playerCaptionsTracklistRenderer.captionTracks[]`, each entry
  /// `{ languageCode, name: {simpleText|runs[]}, baseUrl, kind?: "asr" }`.
  /// Tracks without a `baseUrl` are dropped (desktop behavior).
  List<CaptionTrack> _parseCaptionTracks(String playerResponse) {
    dynamic root;
    try {
      root = jsonDecode(playerResponse);
    } catch (_) {
      return const [];
    }
    if (root is! Map<String, dynamic>) return const [];
    final captions = root['captions'];
    if (captions is! Map<String, dynamic>) return const [];
    final renderer = captions['playerCaptionsTracklistRenderer'];
    if (renderer is! Map<String, dynamic>) return const [];
    final list = renderer['captionTracks'];
    if (list is! List) return const [];
    final out = <CaptionTrack>[];
    for (final el in list) {
      if (el is! Map<String, dynamic>) continue;
      final baseUrl = el['baseUrl'] as String?;
      if (baseUrl == null || baseUrl.isEmpty) continue;
      final languageCode = el['languageCode'] as String? ?? '';
      final name = _trackName(el);
      final isAsr = el['kind'] == 'asr';
      out.add(CaptionTrack(
        languageCode: languageCode,
        name: name,
        baseUrl: baseUrl,
        isAsr: isAsr,
      ));
    }
    return out;
  }

  String _trackName(Map<String, dynamic> entry) {
    final name = entry['name'];
    if (name is! Map<String, dynamic>) {
      return entry['languageCode'] as String? ?? '';
    }
    final simple = name['simpleText'] as String?;
    if (simple != null && simple.isNotEmpty) return simple;
    final runs = name['runs'];
    if (runs is List) {
      final joined = runs
          .whereType<Map<String, dynamic>>()
          .map((r) => r['text'] as String? ?? '')
          .join();
      if (joined.isNotEmpty) return joined;
    }
    return entry['languageCode'] as String? ?? '';
  }

  // --- Transport -------------------------------------------------------------

  Future<http.Response> _post(String url, String jsonBody) async {
    final resp = await _http.post(
      Uri.parse(url),
      headers: {'Content-Type': 'application/json; charset=utf-8'},
      body: jsonBody,
    );
    return resp;
  }

  Future<http.Response> _get(String url, String? lang) async {
    final headers = <String, String>{};
    if (lang != null && lang.isNotEmpty) {
      headers['Accept-Language'] = lang;
    }
    return _http.get(Uri.parse(url), headers: headers.isEmpty ? null : headers);
  }

  String _appendFmtJson3(String baseUrl) =>
      baseUrl.contains('?') ? '$baseUrl&fmt=json3' : '$baseUrl?fmt=json3';

  // --- Track picking (port of the desktop pickTrack) ------------------------

  /// Track picking (port of the desktop `pickTrack`): session preference
  /// (exact `languageCode` match, ASR not deprioritized) → English
  /// (`languageCode` starts with "en", non-ASR preferred) → first
  /// (non-ASR preferred).
  static CaptionTrack? pickTrack(
    List<CaptionTrack> tracks,
    String? preferredLang,
  ) {
    if (tracks.isEmpty) return null;
    if (preferredLang != null && preferredLang.isNotEmpty) {
      for (final t in tracks) {
        if (t.languageCode == preferredLang) return t;
      }
    }
    final en = tracks.where((t) => t.languageCode.toLowerCase().startsWith('en')).toList();
    if (en.isNotEmpty) {
      for (final t in en) {
        if (!t.isAsr) return t;
      }
      return en.first;
    }
    for (final t in tracks) {
      if (!t.isAsr) return t;
    }
    return tracks.first;
  }

  void dispose() {
    _http.close();
  }
}

// --- Internal discovery result ---------------------------------------------

sealed class _Discovery {
  const _Discovery();
}

class _TracksFound extends _Discovery {
  final List<CaptionTrack> tracks;
  const _TracksFound(this.tracks);
}

class _NoCaptions extends _Discovery {
  const _NoCaptions();
}

class _Failed extends _Discovery {
  final int? statusCode;
  final Object? cause;
  const _Failed({this.statusCode, this.cause});

  TranscriptResult toResult() {
    if (statusCode != null) return TranscriptHttpError(statusCode!);
    if (cause is ParseException) {
      final pe = cause as ParseException;
      return TranscriptParseError(pe.message, pe.cause);
    }
    return TranscriptNetworkError(cause);
  }
}
