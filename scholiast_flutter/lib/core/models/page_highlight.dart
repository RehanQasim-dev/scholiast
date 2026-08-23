import 'package:flutter/foundation.dart';

/// One highlight inside a page record's `highlights` array. Mirrors the
/// `Highlight` interface in `shared/merge.ts` (`id`, `updatedAt?`, `notes?`,
/// `color?` plus the `[k: string]: unknown` index signature). Desktop fields
/// (xpath, offsets, content, groupId, anchor, …) are preserved verbatim in
/// [extras] so sync merge never strips them.
@immutable
class PageHighlight {
  final String id;
  final int? updatedAt;
  final List<String>? notes;
  final String? color;
  final Map<String, dynamic> extras;

  const PageHighlight({
    required this.id,
    this.updatedAt,
    this.notes,
    this.color,
    this.extras = const <String, dynamic>{},
  });

  static const _knownKeys = {'id', 'updatedAt', 'notes', 'color'};

  PageHighlight copyWith({
    String? id,
    int? updatedAt,
    List<String>? notes,
    String? color,
    Map<String, dynamic>? extras,
  }) {
    return PageHighlight(
      id: id ?? this.id,
      updatedAt: updatedAt ?? this.updatedAt,
      notes: notes ?? this.notes,
      color: color ?? this.color,
      extras: extras ?? this.extras,
    );
  }

  factory PageHighlight.fromJson(Map<String, dynamic> json) {
    final id = json['id'] as String? ?? '';
    final updatedAt = (json['updatedAt'] as num?)?.toInt();
    final notes = (json['notes'] as List<dynamic>?)
        ?.map((e) => e.toString())
        .toList();
    final color = json['color'] as String?;

    final extras = <String, dynamic>{};
    for (final entry in json.entries) {
      if (!_knownKeys.contains(entry.key)) {
        extras[entry.key] = entry.value;
      }
    }

    return PageHighlight(
      id: id,
      updatedAt: updatedAt,
      notes: notes,
      color: color,
      extras: extras,
    );
  }

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'id': id,
      if (updatedAt != null) 'updatedAt': updatedAt,
      if (notes != null) 'notes': notes,
      if (color != null) 'color': color,
    };
    map.addAll(extras);
    return map;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PageHighlight &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          updatedAt == other.updatedAt &&
          listEquals(notes, other.notes) &&
          color == other.color &&
          mapEquals(extras, other.extras);

  @override
  int get hashCode => Object.hash(
        id,
        updatedAt,
        Object.hashAll(notes ?? const []),
        color,
        Object.hashAll(extras.keys),
        Object.hashAll(extras.values),
      );
}
