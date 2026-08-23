import 'package:flutter/foundation.dart';

/// A diagram pointer inside a page record. Byte-identical to the TypeScript
/// `PageRecord.diagrams` element (`id`, `updatedAt`, `driveId?`, `sceneDriveId?`).
/// Scene data and PNG bytes are stored separately in the blob store/IndexedDB.
/// Unknown fields (the desktop's `sceneData`, `pasted`, `pageUrl`, …) are preserved in [extras].
@immutable
class PageDiagram {
  final String id;
  final int? updatedAt;
  final String? driveId;
  final String? sceneDriveId;
  final Map<String, dynamic> extras;

  const PageDiagram({
    required this.id,
    this.updatedAt,
    this.driveId,
    this.sceneDriveId,
    this.extras = const <String, dynamic>{},
  });

  static const _knownKeys = {'id', 'updatedAt', 'driveId', 'sceneDriveId'};

  PageDiagram copyWith({
    String? id,
    int? updatedAt,
    String? driveId,
    String? sceneDriveId,
    Map<String, dynamic>? extras,
  }) {
    return PageDiagram(
      id: id ?? this.id,
      updatedAt: updatedAt ?? this.updatedAt,
      driveId: driveId ?? this.driveId,
      sceneDriveId: sceneDriveId ?? this.sceneDriveId,
      extras: extras ?? this.extras,
    );
  }

  factory PageDiagram.fromJson(Map<String, dynamic> json) {
    final id = json['id'] as String? ?? '';
    final updatedAt = (json['updatedAt'] as num?)?.toInt();
    final driveId = json['driveId'] as String?;
    final sceneDriveId = json['sceneDriveId'] as String?;
    final extras = <String, dynamic>{};
    for (final entry in json.entries) {
      if (!_knownKeys.contains(entry.key)) {
        extras[entry.key] = entry.value;
      }
    }
    return PageDiagram(
      id: id,
      updatedAt: updatedAt,
      driveId: driveId,
      sceneDriveId: sceneDriveId,
      extras: extras,
    );
  }

  Map<String, dynamic> toJson() {
    final map = <String, dynamic>{
      'id': id,
      if (updatedAt != null) 'updatedAt': updatedAt,
      if (driveId != null) 'driveId': driveId,
      if (sceneDriveId != null) 'sceneDriveId': sceneDriveId,
    };
    map.addAll(extras);
    return map;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PageDiagram &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          updatedAt == other.updatedAt &&
          driveId == other.driveId &&
          sceneDriveId == other.sceneDriveId &&
          mapEquals(extras, other.extras);

  @override
  int get hashCode => Object.hash(
        id,
        updatedAt,
        driveId,
        sceneDriveId,
        Object.hashAll(extras.keys),
        Object.hashAll(extras.values),
      );
}
