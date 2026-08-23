import 'package:flutter/foundation.dart';

/// An inline annotation inside a [LinearBlock]: [start]/[end] are char offsets
/// into the block's text; [kind] is `"link" | "bold" | "italic" | "code"` and
/// [target] is the href for links.
@immutable
class LinearAnn {
  final String kind;
  final int start;
  final int end;
  final String target;

  const LinearAnn({
    required this.kind,
    required this.start,
    required this.end,
    this.target = '',
  });

  factory LinearAnn.fromJson(Map<String, dynamic> json) => LinearAnn(
        kind: json['kind'] as String? ?? '',
        start: (json['start'] as num).toInt(),
        end: (json['end'] as num).toInt(),
        target: json['target'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': kind,
        'start': start,
        'end': end,
        'target': target,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is LinearAnn &&
          runtimeType == other.runtimeType &&
          kind == other.kind &&
          start == other.start &&
          end == other.end &&
          target == other.target;

  @override
  int get hashCode => Object.hash(kind, start, end, target);
}

/// One block of linear content in a readable article.
@immutable
class LinearBlock {
  final String kind;
  final String text;
  final List<LinearAnn> annotations;
  final String? imgUrl;
  final String? imgAlt;
  final int? listOrdinal;
  final String? anchorId;

  const LinearBlock({
    required this.kind,
    this.text = '',
    this.annotations = const <LinearAnn>[],
    this.imgUrl,
    this.imgAlt,
    this.listOrdinal,
    this.anchorId,
  });

  String get type => kind;
  String? get elementTag => kind;

  factory LinearBlock.fromJson(Map<String, dynamic> json) {
    return LinearBlock(
      kind: (json['kind'] ?? json['type']) as String? ?? 'p',
      text: json['text'] as String? ?? '',
      annotations: (json['annotations'] as List<dynamic>?)
              ?.map((e) => LinearAnn.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const <LinearAnn>[],
      imgUrl: json['imgUrl'] as String?,
      imgAlt: json['imgAlt'] as String?,
      listOrdinal: (json['listOrdinal'] as num?)?.toInt(),
      anchorId: json['anchorId'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'kind': kind,
        'text': text,
        'annotations': annotations.map((a) => a.toJson()).toList(),
        if (imgUrl != null) 'imgUrl': imgUrl,
        if (imgAlt != null) 'imgAlt': imgAlt,
        if (listOrdinal != null) 'listOrdinal': listOrdinal,
        if (anchorId != null) 'anchorId': anchorId,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is LinearBlock &&
          runtimeType == other.runtimeType &&
          kind == other.kind &&
          text == other.text &&
          listEquals(annotations, other.annotations) &&
          imgUrl == other.imgUrl &&
          imgAlt == other.imgAlt &&
          listOrdinal == other.listOrdinal &&
          anchorId == other.anchorId;

  @override
  int get hashCode => Object.hash(
        kind,
        text,
        Object.hashAll(annotations),
        imgUrl,
        imgAlt,
        listOrdinal,
        anchorId,
      );
}

/// The extracted article ready for reading/highlighting.
@immutable
class LinearArticle {
  final String url;
  final String? title;
  final String? byline;
  final List<LinearBlock> blocks;
  final int wordCount;
  final int fetchedAt;
  final bool truncated;

  const LinearArticle({
    required this.url,
    this.title,
    this.byline,
    this.blocks = const <LinearBlock>[],
    this.wordCount = 0,
    required this.fetchedAt,
    this.truncated = false,
  });

  int get capturedAt => fetchedAt;

  factory LinearArticle.fromJson(Map<String, dynamic> json) {
    return LinearArticle(
      url: json['url'] as String? ?? '',
      title: json['title'] as String?,
      byline: json['byline'] as String?,
      blocks: (json['blocks'] as List<dynamic>?)
              ?.map((e) => LinearBlock.fromJson(e as Map<String, dynamic>))
              .toList() ??
          const <LinearBlock>[],
      wordCount: (json['wordCount'] as num?)?.toInt() ?? 0,
      fetchedAt: (json['fetchedAt'] as num?)?.toInt() ?? 0,
      truncated: json['truncated'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'url': url,
        if (title != null) 'title': title,
        if (byline != null) 'byline': byline,
        'blocks': blocks.map((b) => b.toJson()).toList(),
        'wordCount': wordCount,
        'fetchedAt': fetchedAt,
        'truncated': truncated,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is LinearArticle &&
          runtimeType == other.runtimeType &&
          url == other.url &&
          title == other.title &&
          byline == other.byline &&
          listEquals(blocks, other.blocks) &&
          wordCount == other.wordCount &&
          fetchedAt == other.fetchedAt &&
          truncated == other.truncated;

  @override
  int get hashCode => Object.hash(
        url,
        title,
        byline,
        Object.hashAll(blocks),
        wordCount,
        fetchedAt,
        truncated,
      );
}
