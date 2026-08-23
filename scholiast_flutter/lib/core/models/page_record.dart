import 'package:flutter/foundation.dart';
import 'page_highlight.dart';
import 'page_stroke.dart';
import 'page_diagram.dart';
import 'video_item.dart';

/// Per-entity tombstones of a page record: entityId -> deletedAt (ms). Mirrors
/// `PageTombstones` in `shared/merge.ts` byte-for-byte. The merge's correctness
/// rests on these, never on the record's presence.
@immutable
class PageTombstones {
  final Map<String, int> highlights;
  final Map<String, int> drawings;
  final Map<String, int> comments;
  final Map<String, int> videoItems;
  final Map<String, int> diagrams;

  const PageTombstones({
    this.highlights = const <String, int>{},
    this.drawings = const <String, int>{},
    this.comments = const <String, int>{},
    this.videoItems = const <String, int>{},
    this.diagrams = const <String, int>{},
  });

  PageTombstones copyWith({
    Map<String, int>? highlights,
    Map<String, int>? drawings,
    Map<String, int>? comments,
    Map<String, int>? videoItems,
    Map<String, int>? diagrams,
  }) {
    return PageTombstones(
      highlights: highlights ?? this.highlights,
      drawings: drawings ?? this.drawings,
      comments: comments ?? this.comments,
      videoItems: videoItems ?? this.videoItems,
      diagrams: diagrams ?? this.diagrams,
    );
  }

  factory PageTombstones.fromJson(Map<String, dynamic> json) {
    return PageTombstones(
      highlights: (json['highlights'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, (v as num).toInt()),
          ) ??
          const <String, int>{},
      drawings: (json['drawings'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, (v as num).toInt()),
          ) ??
          const <String, int>{},
      comments: (json['comments'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, (v as num).toInt()),
          ) ??
          const <String, int>{},
      videoItems: (json['videoItems'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, (v as num).toInt()),
          ) ??
          const <String, int>{},
      diagrams: (json['diagrams'] as Map<String, dynamic>?)?.map(
            (k, v) => MapEntry(k, (v as num).toInt()),
          ) ??
          const <String, int>{},
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'highlights': highlights,
        'drawings': drawings,
        'comments': comments,
        'videoItems': videoItems,
        'diagrams': diagrams,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PageTombstones &&
          runtimeType == other.runtimeType &&
          mapEquals(highlights, other.highlights) &&
          mapEquals(drawings, other.drawings) &&
          mapEquals(comments, other.comments) &&
          mapEquals(videoItems, other.videoItems) &&
          mapEquals(diagrams, other.diagrams);

  @override
  int get hashCode => Object.hash(
        Object.hashAll(highlights.keys),
        Object.hashAll(highlights.values),
        Object.hashAll(drawings.keys),
        Object.hashAll(drawings.values),
        Object.hashAll(comments.keys),
        Object.hashAll(comments.values),
        Object.hashAll(videoItems.keys),
        Object.hashAll(videoItems.values),
        Object.hashAll(diagrams.keys),
        Object.hashAll(diagrams.values),
      );
}

/// One page's full annotation record — the exact JSON stored per normalized URL in
/// the Drive appdata layout as `pages/page-<urlhash>.json`. Mirrors `PageRecord`
/// in `shared/merge.ts` byte-for-byte (`version: 2`), and is what the app's sync
/// engine assembles, reconciles with a 3-way merge, and uploads.
@immutable
class PageRecord {
  final int version;
  final String url;
  final String? title;
  final String? videoId;
  final List<PageHighlight> highlights;
  final List<PageStroke> drawings;
  final List<VideoItem> videoItems;
  final List<PageDiagram> diagrams;
  final PageTombstones tombstones;
  final int? deletedAt;

  const PageRecord({
    this.version = 2,
    required this.url,
    this.title,
    this.videoId,
    this.highlights = const <PageHighlight>[],
    this.drawings = const <PageStroke>[],
    this.videoItems = const <VideoItem>[],
    this.diagrams = const <PageDiagram>[],
    this.tombstones = const PageTombstones(),
    this.deletedAt,
  });

  PageRecord copyWith({
    int? version,
    String? url,
    String? title,
    String? videoId,
    List<PageHighlight>? highlights,
    List<PageStroke>? drawings,
    List<VideoItem>? videoItems,
    List<PageDiagram>? diagrams,
    PageTombstones? tombstones,
    int? deletedAt,
  }) {
    return PageRecord(
      version: version ?? this.version,
      url: url ?? this.url,
      title: title ?? this.title,
      videoId: videoId ?? this.videoId,
      highlights: highlights ?? this.highlights,
      drawings: drawings ?? this.drawings,
      videoItems: videoItems ?? this.videoItems,
      diagrams: diagrams ?? this.diagrams,
      tombstones: tombstones ?? this.tombstones,
      deletedAt: deletedAt ?? this.deletedAt,
    );
  }

  factory PageRecord.empty(String url) => PageRecord(
        version: 2,
        url: url,
        highlights: const [],
        drawings: const [],
        videoItems: const [],
        diagrams: const [],
        tombstones: const PageTombstones(),
      );

  factory PageRecord.fromJson(Map<String, dynamic> json) {
    return PageRecord(
      version: (json['version'] as num?)?.toInt() ?? 2,
      url: json['url'] as String? ?? '',
      title: json['title'] as String?,
      videoId: json['videoId'] as String?,
      highlights: (json['highlights'] as List<dynamic>?)
              ?.map((e) => PageHighlight.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const <PageHighlight>[],
      drawings: (json['drawings'] as List<dynamic>?)
              ?.map((e) => PageStroke.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const <PageStroke>[],
      videoItems: (json['videoItems'] as List<dynamic>?)
              ?.map((e) => VideoItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const <VideoItem>[],
      diagrams: (json['diagrams'] as List<dynamic>?)
              ?.map((e) => PageDiagram.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const <PageDiagram>[],
      tombstones: json['tombstones'] != null
          ? PageTombstones.fromJson(json['tombstones'] as Map<String, dynamic>)
          : const PageTombstones(),
      deletedAt: (json['deletedAt'] as num?)?.toInt(),
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'version': version,
        'url': url,
        if (title != null) 'title': title,
        if (videoId != null) 'videoId': videoId,
        'highlights': highlights.map((h) => h.toJson()).toList(),
        'drawings': drawings.map((d) => d.toJson()).toList(),
        'videoItems': videoItems.map((v) => v.toJson()).toList(),
        'diagrams': diagrams.map((d) => d.toJson()).toList(),
        'tombstones': tombstones.toJson(),
        if (deletedAt != null) 'deletedAt': deletedAt,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PageRecord &&
          runtimeType == other.runtimeType &&
          version == other.version &&
          url == other.url &&
          title == other.title &&
          videoId == other.videoId &&
          listEquals(highlights, other.highlights) &&
          listEquals(drawings, other.drawings) &&
          listEquals(videoItems, other.videoItems) &&
          listEquals(diagrams, other.diagrams) &&
          tombstones == other.tombstones &&
          deletedAt == other.deletedAt;

  @override
  int get hashCode => Object.hash(
        version,
        url,
        title,
        videoId,
        Object.hashAll(highlights),
        Object.hashAll(drawings),
        Object.hashAll(videoItems),
        Object.hashAll(diagrams),
        tombstones,
        deletedAt,
      );
}

/// The TS name for [PageRecord], for code that ports `shared/merge.ts` verbatim.
typedef VideoPage = PageRecord;
