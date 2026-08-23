import 'package:flutter/foundation.dart';

num jsNum(num value) {
  if (value is double &&
      value.isFinite &&
      value == value.floorToDouble() &&
      value.abs() < 1e21) {
    return value.toInt();
  }
  return value;
}

/// Normalized 0..1 point in a markup path.
@immutable
class MarkupPoint {
  final double x;
  final double y;

  const MarkupPoint(this.x, this.y);

  factory MarkupPoint.fromJson(List<dynamic> list) => MarkupPoint(
        (list[0] as num).toDouble(),
        (list[1] as num).toDouble(),
      );

  List<dynamic> toJson() => [jsNum(x), jsNum(y)];

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MarkupPoint &&
          runtimeType == other.runtimeType &&
          x == other.x &&
          y == other.y;

  @override
  int get hashCode => Object.hash(x, y);
}

/// A freehand stroke: flattened normalized points [x0, y0, x1, y1, ...].
@immutable
class Stroke {
  final String id;
  final String color;
  final List<double> points;
  final String? weight;

  const Stroke({
    required this.id,
    required this.color,
    required this.points,
    this.weight,
  });

  factory Stroke.fromJson(Map<String, dynamic> json) => Stroke(
        id: json['id'] as String? ?? '',
        color: json['color'] as String? ?? '#ffeb3b',
        points: (json['points'] as List<dynamic>?)
                ?.map((e) => (e as num).toDouble())
                .toList() ??
            const <double>[],
        weight: json['weight'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'color': color,
        'points': points.map(jsNum).toList(),
        if (weight != null) 'weight': weight,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Stroke &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          color == other.color &&
          listEquals(points, other.points) &&
          weight == other.weight;

  @override
  int get hashCode => Object.hash(id, color, Object.hashAll(points), weight);
}

typedef MarkupStroke = Stroke;

/// A straight line.
@immutable
class Line {
  final String id;
  final String color;
  final double x1;
  final double y1;
  final double x2;
  final double y2;
  final String? weight;

  const Line({
    required this.id,
    required this.color,
    required this.x1,
    required this.y1,
    required this.x2,
    required this.y2,
    this.weight,
  });

  factory Line.fromJson(Map<String, dynamic> json) => Line(
        id: json['id'] as String? ?? '',
        color: json['color'] as String? ?? '#ffeb3b',
        x1: (json['x1'] as num?)?.toDouble() ?? 0.0,
        y1: (json['y1'] as num?)?.toDouble() ?? 0.0,
        x2: (json['x2'] as num?)?.toDouble() ?? 0.0,
        y2: (json['y2'] as num?)?.toDouble() ?? 0.0,
        weight: json['weight'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'color': color,
        'x1': jsNum(x1),
        'y1': jsNum(y1),
        'x2': jsNum(x2),
        'y2': jsNum(y2),
        if (weight != null) 'weight': weight,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Line &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          color == other.color &&
          x1 == other.x1 &&
          y1 == other.y1 &&
          x2 == other.x2 &&
          y2 == other.y2 &&
          weight == other.weight;

  @override
  int get hashCode => Object.hash(id, color, x1, y1, x2, y2, weight);
}

typedef MarkupLine = Line;

/// A text label: top-left at (x, y), wrapping within width w.
@immutable
class TextLabel {
  final String id;
  final String color;
  final double x;
  final double y;
  final double w;
  final double? size;
  final String text;

  const TextLabel({
    required this.id,
    required this.color,
    required this.x,
    required this.y,
    required this.w,
    this.size,
    required this.text,
  });

  factory TextLabel.fromJson(Map<String, dynamic> json) => TextLabel(
        id: json['id'] as String? ?? '',
        color: json['color'] as String? ?? '#ffffff',
        x: (json['x'] as num?)?.toDouble() ?? 0.0,
        y: (json['y'] as num?)?.toDouble() ?? 0.0,
        w: (json['w'] as num?)?.toDouble() ?? 0.0,
        size: (json['size'] as num?)?.toDouble(),
        text: json['text'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'color': color,
        'x': jsNum(x),
        'y': jsNum(y),
        'w': jsNum(w),
        if (size != null) 'size': jsNum(size!),
        'text': text,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TextLabel &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          color == other.color &&
          x == other.x &&
          y == other.y &&
          w == other.w &&
          size == other.size &&
          text == other.text;

  @override
  int get hashCode => Object.hash(id, color, x, y, w, size, text);
}

typedef MarkupText = TextLabel;

/// An outline rectangle.
@immutable
class Rect {
  final String id;
  final String color;
  final double x;
  final double y;
  final double w;
  final double h;
  final String? weight;

  const Rect({
    required this.id,
    required this.color,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    this.weight,
  });

  factory Rect.fromJson(Map<String, dynamic> json) => Rect(
        id: json['id'] as String? ?? '',
        color: json['color'] as String? ?? '#ffeb3b',
        x: (json['x'] as num?)?.toDouble() ?? 0.0,
        y: (json['y'] as num?)?.toDouble() ?? 0.0,
        w: (json['w'] as num?)?.toDouble() ?? 0.0,
        h: (json['h'] as num?)?.toDouble() ?? 0.0,
        weight: json['weight'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'color': color,
        'x': jsNum(x),
        'y': jsNum(y),
        'w': jsNum(w),
        'h': jsNum(h),
        if (weight != null) 'weight': weight,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Rect &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          color == other.color &&
          x == other.x &&
          y == other.y &&
          w == other.w &&
          h == other.h &&
          weight == other.weight;

  @override
  int get hashCode => Object.hash(id, color, x, y, w, h, weight);
}

typedef MarkupRect = Rect;

/// An arrow (line + arrowhead).
@immutable
class Arrow {
  final String id;
  final String color;
  final double x1;
  final double y1;
  final double x2;
  final double y2;
  final String? weight;

  const Arrow({
    required this.id,
    required this.color,
    required this.x1,
    required this.y1,
    required this.x2,
    required this.y2,
    this.weight,
  });

  factory Arrow.fromJson(Map<String, dynamic> json) => Arrow(
        id: json['id'] as String? ?? '',
        color: json['color'] as String? ?? '#ffeb3b',
        x1: (json['x1'] as num?)?.toDouble() ?? 0.0,
        y1: (json['y1'] as num?)?.toDouble() ?? 0.0,
        x2: (json['x2'] as num?)?.toDouble() ?? 0.0,
        y2: (json['y2'] as num?)?.toDouble() ?? 0.0,
        weight: json['weight'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'color': color,
        'x1': jsNum(x1),
        'y1': jsNum(y1),
        'x2': jsNum(x2),
        'y2': jsNum(y2),
        if (weight != null) 'weight': weight,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Arrow &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          color == other.color &&
          x1 == other.x1 &&
          y1 == other.y1 &&
          x2 == other.x2 &&
          y2 == other.y2 &&
          weight == other.weight;

  @override
  int get hashCode => Object.hash(id, color, x1, y1, x2, y2, weight);
}

typedef MarkupArrow = Arrow;

/// Full vector markup attached to a frame item.
@immutable
class VideoMarkup {
  final List<Stroke> strokes;
  final List<Line> lines;
  final List<TextLabel> texts;
  final List<Rect>? rects;
  final List<Arrow>? arrows;

  const VideoMarkup({
    this.strokes = const <Stroke>[],
    this.lines = const <Line>[],
    this.texts = const <TextLabel>[],
    this.rects,
    this.arrows,
  });

  factory VideoMarkup.empty() => const VideoMarkup(
        strokes: [],
        lines: [],
        texts: [],
        rects: [],
        arrows: [],
      );

  factory VideoMarkup.fromJson(Map<String, dynamic> json) => VideoMarkup(
        strokes: (json['strokes'] as List<dynamic>?)
                ?.map((e) => Stroke.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const <Stroke>[],
        lines: (json['lines'] as List<dynamic>?)
                ?.map((e) => Line.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const <Line>[],
        texts: (json['texts'] as List<dynamic>?)
                ?.map((e) => TextLabel.fromJson(e as Map<String, dynamic>))
                .toList() ??
            const <TextLabel>[],
        rects: (json['rects'] as List<dynamic>?)
            ?.map((e) => Rect.fromJson(e as Map<String, dynamic>))
            .toList(),
        arrows: (json['arrows'] as List<dynamic>?)
            ?.map((e) => Arrow.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'strokes': strokes.map((s) => s.toJson()).toList(),
        'lines': lines.map((l) => l.toJson()).toList(),
        'texts': texts.map((t) => t.toJson()).toList(),
        if (rects != null) 'rects': rects!.map((r) => r.toJson()).toList(),
        if (arrows != null) 'arrows': arrows!.map((a) => a.toJson()).toList(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is VideoMarkup &&
          runtimeType == other.runtimeType &&
          listEquals(strokes, other.strokes) &&
          listEquals(lines, other.lines) &&
          listEquals(texts, other.texts) &&
          listEquals(rects, other.rects) &&
          listEquals(arrows, other.arrows);

  @override
  int get hashCode => Object.hash(
        Object.hashAll(strokes),
        Object.hashAll(lines),
        Object.hashAll(texts),
        rects != null ? Object.hashAll(rects!) : null,
        arrows != null ? Object.hashAll(arrows!) : null,
      );
}

/// Frame metadata. Image bytes live in IndexedDB/filesDir and are NEVER inlined.
@immutable
class FrameImage {
  final String? dataUrl;
  final String? driveId;
  final int w;
  final int h;

  const FrameImage({
    this.dataUrl,
    this.driveId,
    required this.w,
    required this.h,
  });

  FrameImage copyWith({
    String? dataUrl,
    String? driveId,
    int? w,
    int? h,
  }) {
    return FrameImage(
      dataUrl: dataUrl ?? this.dataUrl,
      driveId: driveId ?? this.driveId,
      w: w ?? this.w,
      h: h ?? this.h,
    );
  }

  factory FrameImage.fromJson(Map<String, dynamic> json) => FrameImage(
        dataUrl: json['dataUrl'] as String?,
        driveId: json['driveId'] as String?,
        w: (json['w'] as num?)?.toInt() ?? 0,
        h: (json['h'] as num?)?.toInt() ?? 0,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        if (dataUrl != null) 'dataUrl': dataUrl,
        if (driveId != null) 'driveId': driveId,
        'w': w,
        'h': h,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is FrameImage &&
          runtimeType == other.runtimeType &&
          dataUrl == other.dataUrl &&
          driveId == other.driveId &&
          w == other.w &&
          h == other.h;

  @override
  int get hashCode => Object.hash(dataUrl, driveId, w, h);
}

typedef VideoFrame = FrameImage;

/// Anchor for transcript-highlight video items.
@immutable
class TranscriptAnchor {
  final int startCue;
  final int startOffset;
  final int endCue;
  final int endOffset;

  const TranscriptAnchor({
    required this.startCue,
    required this.startOffset,
    required this.endCue,
    required this.endOffset,
  });

  factory TranscriptAnchor.fromJson(Map<String, dynamic> json) =>
      TranscriptAnchor(
        startCue: (json['startCue'] as num).toInt(),
        startOffset: (json['startOffset'] as num).toInt(),
        endCue: (json['endCue'] as num).toInt(),
        endOffset: (json['endOffset'] as num).toInt(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
        'startCue': startCue,
        'startOffset': startOffset,
        'endCue': endCue,
        'endOffset': endOffset,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is TranscriptAnchor &&
          runtimeType == other.runtimeType &&
          startCue == other.startCue &&
          startOffset == other.startOffset &&
          endCue == other.endCue &&
          endOffset == other.endOffset;

  @override
  int get hashCode => Object.hash(startCue, startOffset, endCue, endOffset);
}

/// One video annotation item: `frame`, `note`, or `transcript`.
@immutable
class VideoItem {
  final String id;
  final String kind;
  final double videoTime;
  final FrameImage? frame;
  final VideoMarkup? markup;
  final List<String> notes;
  final int? updatedAt;
  final double? timeEnd;
  final String? quote;
  final String? color;
  final TranscriptAnchor? anchor;
  final Object? excalidrawScene;
  final String? ocrText;

  const VideoItem({
    required this.id,
    required this.kind,
    required this.videoTime,
    this.frame,
    this.markup,
    this.notes = const <String>[],
    this.updatedAt,
    this.timeEnd,
    this.quote,
    this.color,
    this.anchor,
    this.excalidrawScene,
    this.ocrText,
  });

  VideoItem copyWith({
    String? id,
    String? kind,
    double? videoTime,
    FrameImage? frame,
    VideoMarkup? markup,
    List<String>? notes,
    int? updatedAt,
    double? timeEnd,
    String? quote,
    String? color,
    TranscriptAnchor? anchor,
    Object? excalidrawScene,
    String? ocrText,
  }) {
    return VideoItem(
      id: id ?? this.id,
      kind: kind ?? this.kind,
      videoTime: videoTime ?? this.videoTime,
      frame: frame ?? this.frame,
      markup: markup ?? this.markup,
      notes: notes ?? this.notes,
      updatedAt: updatedAt ?? this.updatedAt,
      timeEnd: timeEnd ?? this.timeEnd,
      quote: quote ?? this.quote,
      color: color ?? this.color,
      anchor: anchor ?? this.anchor,
      excalidrawScene: excalidrawScene ?? this.excalidrawScene,
      ocrText: ocrText ?? this.ocrText,
    );
  }

  factory VideoItem.fromJson(Map<String, dynamic> json) {
    return VideoItem(
      id: json['id'] as String? ?? '',
      kind: json['kind'] as String? ?? 'note',
      videoTime: (json['videoTime'] as num?)?.toDouble() ?? 0.0,
      frame: json['frame'] != null
          ? FrameImage.fromJson(json['frame'] as Map<String, dynamic>)
          : null,
      markup: json['markup'] != null
          ? VideoMarkup.fromJson(json['markup'] as Map<String, dynamic>)
          : null,
      notes: (json['notes'] as List<dynamic>?)
              ?.map((e) => e.toString())
              .toList() ??
          const <String>[],
      updatedAt: (json['updatedAt'] as num?)?.toInt(),
      timeEnd: (json['timeEnd'] as num?)?.toDouble(),
      quote: json['quote'] as String?,
      color: json['color'] as String?,
      anchor: json['anchor'] != null
          ? TranscriptAnchor.fromJson(json['anchor'] as Map<String, dynamic>)
          : null,
      excalidrawScene: json['excalidrawScene'],
      ocrText: json['ocrText'] as String?,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'kind': kind,
        'videoTime': jsNum(videoTime),
        if (frame != null) 'frame': frame!.toJson(),
        if (markup != null) 'markup': markup!.toJson(),
        'notes': notes,
        if (updatedAt != null) 'updatedAt': updatedAt,
        if (timeEnd != null) 'timeEnd': jsNum(timeEnd!),
        if (quote != null) 'quote': quote,
        if (color != null) 'color': color,
        if (anchor != null) 'anchor': anchor!.toJson(),
        if (excalidrawScene != null) 'excalidrawScene': excalidrawScene,
        if (ocrText != null) 'ocrText': ocrText,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is VideoItem &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          kind == other.kind &&
          videoTime == other.videoTime &&
          frame == other.frame &&
          markup == other.markup &&
          listEquals(notes, other.notes) &&
          updatedAt == other.updatedAt &&
          timeEnd == other.timeEnd &&
          quote == other.quote &&
          color == other.color &&
          anchor == other.anchor &&
          ocrText == other.ocrText;

  @override
  int get hashCode => Object.hash(
        id,
        kind,
        videoTime,
        frame,
        markup,
        Object.hashAll(notes),
        updatedAt,
        timeEnd,
        quote,
        color,
        anchor,
        ocrText,
      );
}
