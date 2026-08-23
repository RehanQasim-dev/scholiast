import 'package:flutter/foundation.dart';

/// Database entity for sync metadata (`sync_meta` table).
@immutable
class SyncMetaEntity {
  final String key;
  final String value;
  final int updatedAt;

  const SyncMetaEntity({
    required this.key,
    required this.value,
    required this.updatedAt,
  });

  factory SyncMetaEntity.fromRow(Map<String, dynamic> row) {
    return SyncMetaEntity(
      key: row['key'] as String,
      value: row['value'] as String,
      updatedAt: (row['updatedAt'] as num).toInt(),
    );
  }

  Map<String, dynamic> toRow() => <String, dynamic>{
        'key': key,
        'value': value,
        'updatedAt': updatedAt,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SyncMetaEntity &&
          runtimeType == other.runtimeType &&
          key == other.key &&
          value == other.value &&
          updatedAt == other.updatedAt;

  @override
  int get hashCode => Object.hash(key, value, updatedAt);
}
