import 'package:flutter/foundation.dart';

/// The readable page captured as Markdown, for the Obsidian note body. Mirrors
/// `PageSource` in `src/utils/page-source.ts` byte-for-byte (`url`, `title`,
/// `markdown`, `capturedAt` ms).
@immutable
class PageSource {
  final String url;
  final String? title;
  final String markdown;
  final int capturedAt;

  const PageSource({
    required this.url,
    this.title,
    required this.markdown,
    required this.capturedAt,
  });

  factory PageSource.fromJson(Map<String, dynamic> json) {
    return PageSource(
      url: json['url'] as String? ?? '',
      title: json['title'] as String?,
      markdown: json['markdown'] as String? ?? '',
      capturedAt: (json['capturedAt'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'url': url,
        if (title != null) 'title': title,
        'markdown': markdown,
        'capturedAt': capturedAt,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PageSource &&
          runtimeType == other.runtimeType &&
          url == other.url &&
          title == other.title &&
          markdown == other.markdown &&
          capturedAt == other.capturedAt;

  @override
  int get hashCode => Object.hash(url, title, markdown, capturedAt);
}
