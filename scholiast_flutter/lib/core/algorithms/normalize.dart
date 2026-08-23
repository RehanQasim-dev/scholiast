import 'dart:convert';
import 'package:crypto/crypto.dart';

/// Byte-identical to `EPHEMERAL_PARAMS` in `shared/url.ts` (20 params).
const Set<String> ephemeralParams = {
  't', // YouTube timestamp
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content', // UTM tracking
  'ref',
  'ref_src',
  'source',
  'src', // Referral
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'twclid', // Ad click IDs
  'mc_cid',
  'mc_eid', // Mailchimp
  '_ga',
  '_gl', // Google Analytics
  'si', // YouTube share tracking
};

const String _pagePrefix = 'page-';
const String _pageSuffix = '.json';

/// Drive appdata folder holding one page record per normalized URL.
const String pagesFolder = 'pages';

const String _hex = '0123456789ABCDEF';

const Set<String> _youtubeHosts = {
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
};

/// Canonical URL for storage keys, Drive files and sync. Strips the fragment
/// and ephemeral params; everything else is kept byte-identical to the WHATWG
/// serialization the TS produces (scheme/host lowercased, default port dropped,
/// empty path -> `/`, dot segments resolved, query params preserved in order
/// and re-encoded exactly like `URLSearchParams`).
/// Returns the input unchanged when it cannot be parsed.
String normalizeUrl(String rawUrl) {
  if (rawUrl.isEmpty || rawUrl.contains(' ')) {
    return rawUrl;
  }
  final uri = Uri.tryParse(rawUrl);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
    return rawUrl;
  }
  final scheme = uri.scheme.toLowerCase();
  final host = uri.host.toLowerCase();
  final userInfo = uri.userInfo.isNotEmpty ? '${uri.userInfo}@' : '';

  final port = uri.hasPort ? uri.port : null;
  final isDefaultPort =
      (scheme == 'http' && port == 80) || (scheme == 'https' && port == 443);
  final portOut =
      (port != null && port > 0 && !isDefaultPort) ? ':$port' : '';

  // Extract raw path from rawUrl before '?' or '#' to preserve percent-encoding
  var rawPath = '';
  final pathStart = rawUrl.indexOf('://');
  if (pathStart != -1) {
    final afterScheme = rawUrl.substring(pathStart + 3);
    final slashIdx = afterScheme.indexOf('/');
    final qIdx = afterScheme.indexOf('?');
    final hIdx = afterScheme.indexOf('#');

    int endIdx = afterScheme.length;
    if (qIdx != -1 && qIdx < endIdx) endIdx = qIdx;
    if (hIdx != -1 && hIdx < endIdx) endIdx = hIdx;

    if (slashIdx != -1 && slashIdx < endIdx) {
      rawPath = afterScheme.substring(slashIdx, endIdx);
    }
  }

  final path = _normalizePath(rawPath);

  // Extract raw query before '#'
  String? rawQuery;
  final qIdx = rawUrl.indexOf('?');
  if (qIdx != -1) {
    final hIdx = rawUrl.indexOf('#');
    if (hIdx != -1 && hIdx > qIdx) {
      rawQuery = rawUrl.substring(qIdx + 1, hIdx);
    } else if (hIdx == -1) {
      rawQuery = rawUrl.substring(qIdx + 1);
    }
  }

  final query = _filterQuery(rawQuery);

  final sb = StringBuffer();
  sb.write('$scheme://$userInfo$host$portOut$path');
  if (query.isNotEmpty) {
    sb.write('?$query');
  }
  return sb.toString();
}

/// Resolves dot segments (`.` and `..`) while preserving trailing slash
/// and empty path -> `/`.
String _normalizePath(String rawPath) {
  if (rawPath.isEmpty) return '/';
  final hasTrailingSlash = rawPath.endsWith('/') && rawPath.length > 1;
  final segments = rawPath.split('/');
  final stack = <String>[];
  for (final seg in segments) {
    if (seg.isEmpty || seg == '.') {
      continue;
    } else if (seg == '..') {
      if (stack.isNotEmpty) {
        stack.removeLast();
      }
    } else {
      stack.add(seg);
    }
  }
  var result = '/${stack.join('/')}';
  if (hasTrailingSlash && !result.endsWith('/')) {
    result = '$result/';
  }
  return result;
}

/// Extracts the YouTube video id from any common URL form:
/// `watch?v=`, `youtu.be/<id>`, `/shorts/<id>`, `/embed/<id>`, `/live/<id>`.
/// Returns null for non-YouTube hosts, unparseable URLs, or URLs without an id.
String? extractVideoId(String url) {
  if (url.isEmpty) return null;
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
    return null;
  }
  final host = uri.host.toLowerCase();
  final path = uri.path;
  if (host == 'youtu.be') {
    final trimmed = path.replaceAll(RegExp(r'^/+'), '');
    final id = trimmed.split('/').first;
    return id.isNotEmpty ? id : null;
  }
  if (_youtubeHosts.contains(host)) {
    if (path == '/watch') {
      final v = _queryValue(uri.query.isNotEmpty ? uri.query : null, 'v');
      return (v != null && v.isNotEmpty) ? v : null;
    }
    if (path.startsWith('/shorts/')) {
      final stripped = path.substring('/shorts/'.length);
      final id = stripped.split('/').first;
      return id.isNotEmpty ? id : null;
    }
    if (path.startsWith('/embed/')) {
      final stripped = path.substring('/embed/'.length);
      final id = stripped.split('/').first;
      return id.isNotEmpty ? id : null;
    }
    if (path.startsWith('/live/')) {
      final stripped = path.substring('/live/'.length);
      final id = stripped.split('/').first;
      return id.isNotEmpty ? id : null;
    }
  }
  return null;
}

/// SHA-256 of the url string (UTF-8), first 16 bytes, lowercase hex — the exact
/// prefix scheme `shared/merge.ts:pageFileName` uses for Drive file names.
/// Callers MUST pass the NORMALIZED url.
String urlHash(String url) {
  final bytes = utf8.encode(url);
  final digest = sha256.convert(bytes);
  return digest.bytes
      .take(16)
      .map((b) => b.toRadixString(16).padLeft(2, '0'))
      .join('');
}

/// `page-<urlhash>.json` — byte-identical to the TS `pageFileName`.
String pageFileName(String url) => '$_pagePrefix${urlHash(url)}$_pageSuffix';

/// Full Drive appdata path: `pages/page-<urlhash>.json`.
String pageFilePath(String url) =>
    '$pagesFolder/$_pagePrefix${urlHash(url)}$_pageSuffix';

/// Filters ephemeral params and re-serializes the rest using
/// application/x-www-form-urlencoded rules (space -> `+`, uppercase hex,
/// original order kept).
String _filterQuery(String? rawQuery) {
  if (rawQuery == null || rawQuery.isEmpty) return '';
  final pairs = rawQuery.split('&');
  final result = <String>[];
  for (final pair in pairs) {
    if (pair.isEmpty) continue;
    final eq = pair.indexOf('=');
    final rawName = eq == -1 ? pair : pair.substring(0, eq);
    final rawValue = eq == -1 ? '' : pair.substring(eq + 1);
    final name = _formDecode(rawName);
    if (ephemeralParams.contains(name)) {
      continue;
    }
    result.add('${_formEncode(name)}=${_formEncode(_formDecode(rawValue))}');
  }
  return result.join('&');
}

String? _queryValue(String? rawQuery, String key) {
  if (rawQuery == null || rawQuery.isEmpty) return null;
  for (final pair in rawQuery.split('&')) {
    final eq = pair.indexOf('=');
    final rawName = eq == -1 ? pair : pair.substring(0, eq);
    final rawValue = eq == -1 ? '' : pair.substring(eq + 1);
    if (_formDecode(rawName) == key) {
      return _formDecode(rawValue);
    }
  }
  return null;
}

/// application/x-www-form-urlencoded encode: alnum + `*-._` safe, space -> `+`.
String _formEncode(String s) {
  final bytes = utf8.encode(s);
  final sb = StringBuffer();
  for (final v in bytes) {
    if ((v >= 0x61 && v <= 0x7A) || // a-z
        (v >= 0x41 && v <= 0x5A) || // A-Z
        (v >= 0x30 && v <= 0x39) || // 0-9
        v == 0x2A || // *
        v == 0x2D || // -
        v == 0x2E || // .
        v == 0x5F) { // _
      sb.writeCharCode(v);
    } else if (v == 0x20) { // space
      sb.write('+');
    } else {
      sb.write('%');
      sb.write(_hex[(v >> 4) & 0x0F]);
      sb.write(_hex[v & 0x0F]);
    }
  }
  return sb.toString();
}

bool _isHex(int charCode) {
  return (charCode >= 0x30 && charCode <= 0x39) || // 0-9
      (charCode >= 0x61 && charCode <= 0x66) || // a-f
      (charCode >= 0x41 && charCode <= 0x46); // A-F
}

/// application/x-www-form-urlencoded decode: `+` -> space, `%XX` -> byte, UTF-8.
String _formDecode(String s) {
  final bytes = <int>[];
  var i = 0;
  final codeUnits = s.codeUnits;
  while (i < codeUnits.length) {
    final c = codeUnits[i];
    if (c == 0x2B) { // '+'
      bytes.add(0x20); // space
      i++;
    } else if (c == 0x25 && // '%'
        i + 2 < codeUnits.length &&
        _isHex(codeUnits[i + 1]) &&
        _isHex(codeUnits[i + 2])) {
      final hexStr = s.substring(i + 1, i + 3);
      bytes.add(int.parse(hexStr, radix: 16));
      i += 3;
    } else {
      final charStr = String.fromCharCode(c);
      bytes.addAll(utf8.encode(charStr));
      i++;
    }
  }
  return utf8.decode(bytes, allowMalformed: true);
}
