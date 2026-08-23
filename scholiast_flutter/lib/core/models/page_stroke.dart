import 'package:flutter/foundation.dart';
import 'video_item.dart';

/// One pencil stroke in a page drawing (`dr:<url>`). All coordinates are
/// absolute document pixels, flattened into [points]: `[x0, y0, x1, y1, ...]`.
/// Extra fields (like desktop pencil strokes) are preserved in [extras].
@immutable
class PageStroke {
  final String id;
  final String? color;
  final double? width;
  final List<double>? points;
  final int? updatedAt;
  final Map<String, dynamic> extras;

  const PageStroke({
    required this.id,
    this.color,
    this.width,
    this.points,
    this.updatedAt,
    this.extras = const <String, dynamic>{},
  });

  static const _knownKeys = {'id', 'color', 'width', 'points', 'updatedAt'};

  PageStroke copyWith({
    String? id,
    String? color,
    double? width,
    List<double>? points,
    int? updatedAt,
    Map<String, dynamic>? extras,
  }) {
    return PageStroke(
      id: id ?? this.id,
      color: color ?? this.color,
      width: width ?? this.width,
      points: points ?? this.points,
      updatedAt: updatedAt ?? this.updatedAt,
      extras: extras ?? this.extras,
    );
  }

  factory PageStroke.fromJson(Map<String, dynamic> json) {
    final id = json['id'] as String? ?? '';
    final color = json['color'] as String?;
    final width = (json['width'] as num?)?.toDouble();
    final points = (json['points'] as List<dynamic>?)
        ?.map((e) => (e as num).toDouble())
        .toList();
    final updatedAt = (json['updatedAt'] as num?)?.toInt();
    final extras = <String, dynamic>{};
    for (final entry in json.entries) {
      if (!_knownKeys.contains(entry.key)) {
        extras[entry.key] = entry.value;
      }
    }
    return PageStroke(
      id: id,
      color: color,
      width: width,
      points: points,
      updatedAt: updatedAt,
      extras: extras,
    );
  }

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'id': id,
      if (color != null) 'color': color,
      if (width != null) 'width': jsNum(width!),
      if (points != null) 'points': points!.map(jsNum).toList(),
      if (updatedAt != null) 'updatedAt': updatedAt,
    };
    map.addAll(extras);
    return map;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PageStroke &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          color == other.color &&
          width == other.width &&
          listEquals(points, other.points) &&
          updatedAt == other.updatedAt &&
          mapEquals(extras, other.extras);

  @override
  int get hashCode => Object.hash(
        id,
        color,
        width,
        points != null ? Object.hashAll(points!) : null,
        updatedAt,
        Object.hashAll(extras.keys),
        Object.hashAll(extras.values),
      );
}
