import '../models/models.dart';

/// Tombstones older than this are garbage-collected so the file can't grow
/// forever. Mirrors `TOMBSTONE_RETENTION_MS` in `shared/merge.ts`.
const int tombstoneRetentionMs = 30 * 24 * 60 * 60 * 1000;
// ignore: constant_identifier_names
const int TOMBSTONE_RETENTION_MS = tombstoneRetentionMs;

// --- Comment marker parsing (mirrors comment-overlays.parseNoteString) -----

final RegExp _timestampRe = RegExp(r'<!--timestamp:(\d+)-->');
final RegExp _editedRe = RegExp(r'<!--edited:(\d+)-->');

/// Extracts the stable timestamp id from a note string.
/// Falls back to raw text as id for legacy notes without a timestamp comment.
String commentId(String note) {
  final m = _timestampRe.firstMatch(note);
  return m?.group(1) ?? note;
}

/// Extracts the edit timestamp (or creation timestamp) for version comparison.
int commentVersion(String note) {
  final ed = _editedRe.firstMatch(note);
  if (ed != null) {
    return int.tryParse(ed.group(1)!) ?? 0;
  }
  final ts = _timestampRe.firstMatch(note);
  return ts != null ? (int.tryParse(ts.group(1)!) ?? 0) : 0;
}

/// JS `parseInt(s, 10)` semantics (digit prefix, optional sign) — the TS
/// merge versions entity ids with it, and comment ids can be raw legacy
/// text. Returns null when there is nothing numeric, exactly like NaN.
int? jsParseInt(String s) {
  var i = 0;
  while (i < s.length && _isWhitespace(s.codeUnitAt(i))) {
    i++;
  }
  var neg = false;
  if (i < s.length && (s[i] == '+' || s[i] == '-')) {
    neg = s[i] == '-';
    i++;
  }
  var v = 0;
  var any = false;
  while (i < s.length && _isDigit(s.codeUnitAt(i))) {
    any = true;
    v = v * 10 + (s.codeUnitAt(i) - 48);
    i++;
  }
  return any ? (neg ? -v : v) : null;
}

bool _isWhitespace(int c) =>
    c == 0x20 || (c >= 0x09 && c <= 0x0D) || c == 0x85 || c == 0xA0;

bool _isDigit(int c) => c >= 0x30 && c <= 0x39;

// --- Generic keyed 3-way merge -----------------------------------------------

class MergeResult<T> {
  final Map<String, T> kept;
  final Map<String, int> tombs;

  MergeResult(this.kept, this.tombs);
}

/// Generic keyed 3-way merge, ported from `mergeKeyed` in `shared/merge.ts`.
MergeResult<T> mergeKeyed<T>(
  Map<String, T> base,
  Map<String, T> local,
  Map<String, T> remote,
  Map<String, int> inTombs,
  int Function(T) versionOf,
  T Function(T, T) combine,
  int now,
) {
  final kept = <String, T>{};
  final tombs = Map<String, int>.from(inTombs);
  final ids = <String>{
    ...base.keys,
    ...local.keys,
    ...remote.keys,
    ...inTombs.keys,
  };

  for (final id in ids) {
    final b = base[id];
    final l = local[id];
    final r = remote[id];
    final tomb = tombs[id];

    if (l != null && r != null) {
      final merged = combine(l, r);
      if (tomb != null && versionOf(merged) <= tomb) {
        // Deleted more recently than this edit — stays deleted.
      } else {
        kept[id] = merged;
        tombs.remove(id);
      }
    } else if (l != null) {
      if (tomb != null) {
        if (versionOf(l) > tomb) {
          kept[id] = l; // re-edited locally after a remote delete -> resurrect
          tombs.remove(id);
        }
      } else if (b == null) {
        kept[id] = l; // brand-new local entity
      } else {
        tombs[id] = now; // was in base, gone from remote -> remote deleted it
      }
    } else if (r != null) {
      if (b != null) {
        tombs[id] = now; // was in base, gone locally -> local deleted it
      } else if (tomb != null) {
        if (versionOf(r) > tomb) {
          kept[id] = r; // re-added remotely after a delete -> resurrect
          tombs.remove(id);
        }
      } else {
        kept[id] = r; // brand-new remote entity
      }
    }
    // else: absent both sides — leave any tombstone for GC below.
  }

  tombs.removeWhere((id, t) => now - t > tombstoneRetentionMs);

  return MergeResult<T>(kept, tombs);
}

// --- Comment (notes[]) merge -------------------------------------------------

/// Merges notes arrays for a highlight or video item with scoped tombstone tracking.
List<String> mergeNotes(
  List<String>? baseNotes,
  List<String>? localNotes,
  List<String>? remoteNotes,
  Map<String, int> commentTombs,
  String highlightId,
  int now,
) {
  Map<String, String> toMap(List<String>? notes) {
    final m = <String, String>{};
    for (final n in notes ?? const <String>[]) {
      m[commentId(n)] = n;
    }
    return m;
  }

  final base = toMap(baseNotes);
  final local = toMap(localNotes);
  final remote = toMap(remoteNotes);

  final scoped = <String, int>{};
  final prefix = '$highlightId:';
  for (final entry in commentTombs.entries) {
    if (entry.key.startsWith(prefix)) {
      scoped[entry.key.substring(prefix.length)] = entry.value;
    }
  }

  final result = mergeKeyed<String>(
    base,
    local,
    remote,
    scoped,
    commentVersion,
    (l, r) => commentVersion(l) >= commentVersion(r) ? l : r,
    now,
  );

  for (final k in scoped.keys) {
    commentTombs.remove('$prefix$k');
  }
  for (final entry in result.tombs.entries) {
    commentTombs['$prefix${entry.key}'] = entry.value;
  }

  final keptList = result.kept.values.toList();
  keptList.sort((a, b) {
    final aVal = jsParseInt(commentId(a)) ?? 0;
    final bVal = jsParseInt(commentId(b)) ?? 0;
    return aVal.compareTo(bVal);
  });
  return keptList;
}

// --- Version helpers ---------------------------------------------------------

int highlightVersion(PageHighlight h) =>
    h.updatedAt ?? jsParseInt(h.id) ?? 0;

int videoItemVersion(VideoItem it) =>
    it.updatedAt ?? jsParseInt(it.id) ?? 0;

int diagramVersion(PageDiagram d) => d.updatedAt ?? 0;

int strokeVersion(PageStroke s) => s.updatedAt ?? 0;

// --- The per-page record merge ------------------------------------------------

/// 3-way reconcile of a single page record, ported byte-for-byte from
/// `shared/merge.ts:mergePageRecord`. `base` is the last-reconciled state
/// (snapshot), `local` this device's current state, `remote` the Drive file
/// (the canonical tombstone carrier). Any may be null/absent. Returns the
/// merged record with updated tombstones, ready to write locally and upload.
PageRecord mergePageRecord(
  PageRecord? base,
  PageRecord? local,
  PageRecord? remote,
  int now,
) {
  final url = local?.url.isNotEmpty == true
      ? local!.url
      : (remote?.url.isNotEmpty == true
          ? remote!.url
          : (base?.url.isNotEmpty == true ? base!.url : ''));
  final b = base ?? PageRecord.empty(url);
  final l = local ?? PageRecord.empty(url);
  final r = remote ?? PageRecord.empty(url);

  // Seed from remote — the shared, durable record of deletions.
  final hlTombs = Map<String, int>.from(r.tombstones.highlights);
  final drTombs = Map<String, int>.from(r.tombstones.drawings);
  final cmTombs = Map<String, int>.from(r.tombstones.comments);
  final viTombs = Map<String, int>.from(r.tombstones.videoItems);
  final dgTombs = Map<String, int>.from(r.tombstones.diagrams);

  Map<String, T> byId<T>(List<T> items, String Function(T) idOf) {
    final m = <String, T>{};
    for (final e in items) {
      m[idOf(e)] = e;
    }
    return m;
  }

  final bH = byId(b.highlights, (h) => h.id);
  final lH = byId(l.highlights, (h) => h.id);
  final rH = byId(r.highlights, (h) => h.id);
  final hRes = mergeKeyed<PageHighlight>(
    bH,
    lH,
    rH,
    hlTombs,
    highlightVersion,
    (x, y) {
      final newer = highlightVersion(x) >= highlightVersion(y) ? x : y;
      final notes = mergeNotes(bH[x.id]?.notes, x.notes, y.notes, cmTombs, x.id, now);
      return newer.copyWith(notes: notes);
    },
    now,
  );

  final dRes = mergeKeyed<PageStroke>(
    byId(b.drawings, (s) => s.id),
    byId(l.drawings, (s) => s.id),
    byId(r.drawings, (s) => s.id),
    drTombs,
    strokeVersion,
    (x, y) => strokeVersion(x) >= strokeVersion(y) ? x : y,
    now,
  );

  final bV = byId(b.videoItems, (v) => v.id);
  final lV = byId(l.videoItems, (v) => v.id);
  final rV = byId(r.videoItems, (v) => v.id);
  final vRes = mergeKeyed<VideoItem>(
    bV,
    lV,
    rV,
    viTombs,
    videoItemVersion,
    (x, y) {
      final newer = videoItemVersion(x) >= videoItemVersion(y) ? x : y;
      final notes = mergeNotes(bV[x.id]?.notes, x.notes, y.notes, cmTombs, x.id, now);
      final frame = newer.frame ?? x.frame ?? y.frame;
      return newer.copyWith(notes: notes, frame: frame);
    },
    now,
  );

  final gRes = mergeKeyed<PageDiagram>(
    byId(b.diagrams, (d) => d.id),
    byId(l.diagrams, (d) => d.id),
    byId(r.diagrams, (d) => d.id),
    dgTombs,
    diagramVersion,
    (x, y) => diagramVersion(x) >= diagramVersion(y) ? x : y,
    now,
  );

  // `l.title ?? r.title ?? b.title` with TS truthiness (falsy -> skip).
  final title = [l.title, r.title, b.title]
      .firstWhere((t) => t != null && t.isNotEmpty, orElse: () => null);
  final videoId = [l.videoId, r.videoId, b.videoId]
      .firstWhere((v) => v != null && v.isNotEmpty, orElse: () => null);

  return PageRecord(
    version: 2,
    url: url,
    title: title,
    videoId: videoId,
    highlights: hRes.kept.values.toList(),
    drawings: dRes.kept.values.toList(),
    videoItems: vRes.kept.values.toList(),
    diagrams: gRes.kept.values.toList(),
    tombstones: PageTombstones(
      highlights: hRes.tombs,
      drawings: dRes.tombs,
      comments: cmTombs,
      videoItems: vRes.tombs,
      diagrams: gRes.tombs,
    ),
  );
}

/// Namespace class matching Kotlin's `MergePageRecord`.
abstract final class MergePageRecord {
  static const int tombstoneRetentionMs = 30 * 24 * 60 * 60 * 1000;
  // ignore: constant_identifier_names
  static const int TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

  static String commentId(String note) =>
      commentId(note);
  static int commentVersion(String note) =>
      commentVersion(note);
  static int? jsParseInt(String s) =>
      jsParseInt(s);

  static MergeResult<T> mergeKeyed<T>(
    Map<String, T> base,
    Map<String, T> local,
    Map<String, T> remote,
    Map<String, int> inTombs,
    int Function(T) versionOf,
    T Function(T, T) combine,
    int now,
  ) =>
      mergeKeyed(base, local, remote, inTombs, versionOf, combine, now);

  static List<String> mergeNotes(
    List<String>? baseNotes,
    List<String>? localNotes,
    List<String>? remoteNotes,
    Map<String, int> commentTombs,
    String highlightId,
    int now,
  ) =>
      mergeNotes(
          baseNotes, localNotes, remoteNotes, commentTombs, highlightId, now);

  static PageRecord mergePageRecord(
    PageRecord? base,
    PageRecord? local,
    PageRecord? remote,
    int now,
  ) =>
      mergePageRecord(base, local, remote, now);
}
