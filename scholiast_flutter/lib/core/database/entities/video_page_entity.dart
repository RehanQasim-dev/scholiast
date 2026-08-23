import 'dart:convert';
import 'package:flutter/foundation.dart';
import '../../models/linear_article.dart';
import '../../models/page_highlight.dart';
import '../../models/page_record.dart';
import '../../models/video_item.dart';

/// Database entity for a web or video page (`video_pages` table).
@immutable
class VideoPageEntity {
  final String urlHash;
  final String url;
  final String? videoId;
  final String? title;
  final String itemsJson;
  final int updatedAt;
  final String? snapJson;
  final String? fileId;
  final String? headRevisionId;
  final String highlightsJson;
  final String? readerJson;

  const VideoPageEntity({
    required this.urlHash,
    required this.url,
    this.videoId,
    this.title,
    this.itemsJson = '[]',
    required this.updatedAt,
    this.snapJson,
    this.fileId,
    this.headRevisionId,
    this.highlightsJson = '[]',
    this.readerJson,
  });

  VideoPageEntity copyWith({
    String? urlHash,
    String? url,
    String? videoId,
    String? title,
    String? itemsJson,
    int? updatedAt,
    String? snapJson,
    String? fileId,
    String? headRevisionId,
    String? highlightsJson,
    String? readerJson,
  }) {
    return VideoPageEntity(
      urlHash: urlHash ?? this.urlHash,
      url: url ?? this.url,
      videoId: videoId ?? this.videoId,
      title: title ?? this.title,
      itemsJson: itemsJson ?? this.itemsJson,
      updatedAt: updatedAt ?? this.updatedAt,
      snapJson: snapJson ?? this.snapJson,
      fileId: fileId ?? this.fileId,
      headRevisionId: headRevisionId ?? this.headRevisionId,
      highlightsJson: highlightsJson ?? this.highlightsJson,
      readerJson: readerJson ?? this.readerJson,
    );
  }

  factory VideoPageEntity.fromRow(Map<String, dynamic> row) {
    return VideoPageEntity(
      urlHash: row['urlHash'] as String,
      url: row['url'] as String,
      videoId: row['videoId'] as String?,
      title: row['title'] as String?,
      itemsJson: row['itemsJson'] as String? ?? '[]',
      updatedAt: (row['updatedAt'] as num).toInt(),
      snapJson: row['snapJson'] as String?,
      fileId: row['fileId'] as String?,
      headRevisionId: row['headRevisionId'] as String?,
      highlightsJson: row['highlightsJson'] as String? ?? '[]',
      readerJson: row['readerJson'] as String?,
    );
  }

  Map<String, dynamic> toRow() => <String, dynamic>{
        'urlHash': urlHash,
        'url': url,
        'videoId': videoId,
        'title': title,
        'itemsJson': itemsJson,
        'updatedAt': updatedAt,
        'snapJson': snapJson,
        'fileId': fileId,
        'headRevisionId': headRevisionId,
        'highlightsJson': highlightsJson,
        'readerJson': readerJson,
      };

  List<VideoItem> get items {
    try {
      final list = jsonDecode(itemsJson) as List<dynamic>;
      return list
          .map((e) => VideoItem.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return const [];
    }
  }

  List<PageHighlight> get highlights {
    try {
      final list = jsonDecode(highlightsJson) as List<dynamic>;
      return list
          .map((e) => PageHighlight.fromJson(e as Map<String, dynamic>))
          .toList();
    } catch (_) {
      return const [];
    }
  }

  LinearArticle? get reader {
    final raw = readerJson;
    if (raw == null || raw.isEmpty) return null;
    try {
      return LinearArticle.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  PageRecord? get snap {
    final raw = snapJson;
    if (raw == null || raw.isEmpty) return null;
    try {
      return PageRecord.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is VideoPageEntity &&
          runtimeType == other.runtimeType &&
          urlHash == other.urlHash &&
          url == other.url &&
          videoId == other.videoId &&
          title == other.title &&
          itemsJson == other.itemsJson &&
          updatedAt == other.updatedAt &&
          snapJson == other.snapJson &&
          fileId == other.fileId &&
          headRevisionId == other.headRevisionId &&
          highlightsJson == other.highlightsJson &&
          readerJson == other.readerJson;

  @override
  int get hashCode => Object.hash(
        urlHash,
        url,
        videoId,
        title,
        itemsJson,
        updatedAt,
        snapJson,
        fileId,
        headRevisionId,
        highlightsJson,
        readerJson,
      );
}
