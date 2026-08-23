import 'package:flutter/foundation.dart';

/// Database entity for OCR text extracted from video frames (`ocr_texts` table).
@immutable
class OcrTextEntity {
  final String frameId;
  final String text;
  final int updatedAt;

  const OcrTextEntity({
    required this.frameId,
    required this.text,
    required this.updatedAt,
  });

  factory OcrTextEntity.fromRow(Map<String, dynamic> row) {
    return OcrTextEntity(
      frameId: row['frameId'] as String,
      text: row['text'] as String,
      updatedAt: (row['updatedAt'] as num).toInt(),
    );
  }

  Map<String, dynamic> toRow() => <String, dynamic>{
        'frameId': frameId,
        'text': text,
        'updatedAt': updatedAt,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is OcrTextEntity &&
          runtimeType == other.runtimeType &&
          frameId == other.frameId &&
          text == other.text &&
          updatedAt == other.updatedAt;

  @override
  int get hashCode => Object.hash(frameId, text, updatedAt);
}
