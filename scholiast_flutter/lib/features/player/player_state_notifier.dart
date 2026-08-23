import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/database/daos/video_page_dao.dart';
import '../../core/database/entities/video_page_entity.dart';
import '../../core/models/transcript_models.dart';
import '../../core/models/video_item.dart';
import '../../core/algorithms/normalize.dart';
import '../../core/providers/core_providers.dart';
import '../../core/sync/sync_engine.dart';
import '../../core/sync/sync_models.dart';

/// Immutable UI state for the YouTube player screen.
class PlayerState {
  final String videoId;
  final String url;
  final String? title;
  final double currentTime;
  final double? duration;
  final bool isPlaying;
  final LoadedTranscript? transcript;
  final int selectedParagraphIndex;
  final List<VideoItem> items;
  final String? activeItemId;
  final bool isLoading;
  final String? errorMessage;

  const PlayerState({
    this.videoId = '',
    this.url = '',
    this.title,
    this.currentTime = 0.0,
    this.duration,
    this.isPlaying = false,
    this.transcript,
    this.selectedParagraphIndex = -1,
    this.items = const <VideoItem>[],
    this.activeItemId,
    this.isLoading = false,
    this.errorMessage,
  });

  PlayerState copyWith({
    String? videoId,
    String? url,
    String? title,
    double? currentTime,
    double? duration,
    bool? isPlaying,
    LoadedTranscript? transcript,
    int? selectedParagraphIndex,
    List<VideoItem>? items,
    String? activeItemId,
    bool? isLoading,
    String? errorMessage,
    bool clearActiveItem = false,
    bool clearError = false,
    bool clearTranscript = false,
  }) {
    return PlayerState(
      videoId: videoId ?? this.videoId,
      url: url ?? this.url,
      title: title ?? this.title,
      currentTime: currentTime ?? this.currentTime,
      duration: duration ?? this.duration,
      isPlaying: isPlaying ?? this.isPlaying,
      transcript: clearTranscript ? null : (transcript ?? this.transcript),
      selectedParagraphIndex:
          selectedParagraphIndex ?? this.selectedParagraphIndex,
      items: items ?? this.items,
      activeItemId: clearActiveItem ? null : (activeItemId ?? this.activeItemId),
      isLoading: isLoading ?? this.isLoading,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
    );
  }

  /// The [CueParagraph] that is currently active given [currentTime].
  CueParagraph? get activeParagraph {
    final t = transcript;
    if (t == null || t.paragraphs.isEmpty) return null;
    final idx = selectedParagraphIndex;
    if (idx >= 0 && idx < t.paragraphs.length) return t.paragraphs[idx];
    return null;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PlayerState &&
          videoId == other.videoId &&
          url == other.url &&
          title == other.title &&
          currentTime == other.currentTime &&
          duration == other.duration &&
          isPlaying == other.isPlaying &&
          transcript == other.transcript &&
          selectedParagraphIndex == other.selectedParagraphIndex &&
          items == other.items &&
          activeItemId == other.activeItemId &&
          isLoading == other.isLoading &&
          errorMessage == other.errorMessage;

  @override
  int get hashCode => Object.hash(
        videoId,
        url,
        title,
        currentTime,
        duration,
        isPlaying,
        transcript,
        selectedParagraphIndex,
        Object.hashAll(items),
        activeItemId,
        isLoading,
        errorMessage,
      );
}

/// Manages YouTube player state: video metadata, transcript, captures, notes.
///
/// Persists [VideoItem]s to [VideoPageDao] and triggers background
/// [SyncEngine.syncChanged] after every mutation.
class PlayerStateNotifier extends StateNotifier<PlayerState> {
  final VideoPageDao _videoPageDao;
  final SyncEngine? _syncEngine;
  final Random _rng = Random();

  PlayerStateNotifier({
    required VideoPageDao videoPageDao,
    SyncEngine? syncEngine,
    PlayerState? initialState,
  })  : _videoPageDao = videoPageDao,
        _syncEngine = syncEngine,
        super(initialState ?? const PlayerState());

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /// Loads video page from DB using [rawUrl] as the key.
  Future<void> loadVideo(String rawUrl) async {
    final normalized = normalizeUrl(rawUrl);
    state = state.copyWith(
      url: normalized,
      isLoading: true,
      clearError: true,
    );

    try {
      final hash = urlHash(normalized);
      final entity = await _videoPageDao.getPage(hash);

      final videoId = entity?.videoId ?? _extractVideoId(normalized) ?? '';
      final title = entity?.title;
      final items = entity?.items ?? const <VideoItem>[];

      state = state.copyWith(
        url: normalized,
        videoId: videoId,
        title: title,
        items: items,
        isLoading: false,
      );
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: e.toString(),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  /// Updates the current playback time and derives the active transcript paragraph.
  void onTimeUpdate(double seconds) {
    int paragraphIdx = state.selectedParagraphIndex;
    final transcript = state.transcript;
    if (transcript != null && transcript.paragraphs.isNotEmpty) {
      paragraphIdx = _findParagraphIndex(transcript.paragraphs, seconds);
    }

    state = state.copyWith(
      currentTime: seconds,
      selectedParagraphIndex: paragraphIdx,
    );
  }

  /// Seeks to [seconds] in the video.
  void seekTo(double seconds) {
    final clamped =
        (state.duration != null) ? seconds.clamp(0.0, state.duration!) : seconds;
    state = state.copyWith(currentTime: clamped);
  }

  /// Sets the playing/paused flag.
  void setPlaying(bool playing) {
    state = state.copyWith(isPlaying: playing);
  }

  /// Sets the video duration in seconds.
  void setDuration(double seconds) {
    state = state.copyWith(duration: seconds);
  }

  // -------------------------------------------------------------------------
  // Transcript
  // -------------------------------------------------------------------------

  /// Attaches a fetched [LoadedTranscript] to the state.
  void setTranscript(LoadedTranscript transcript) {
    state = state.copyWith(transcript: transcript);
  }

  /// Selects a transcript paragraph by index, and seeks the player to its start.
  void selectParagraph(int index) {
    final transcript = state.transcript;
    if (transcript == null) return;
    if (index < 0 || index >= transcript.paragraphs.length) return;

    final paragraph = transcript.paragraphs[index];
    state = state.copyWith(
      selectedParagraphIndex: index,
      currentTime: paragraph.start,
    );
  }

  // -------------------------------------------------------------------------
  // Item Mutations
  // -------------------------------------------------------------------------

  /// Adds a captured video frame (with optional markup) at the current time.
  Future<VideoItem> addFrameCapture({
    required FrameImage frame,
    VideoMarkup? markup,
    List<String>? notes,
    String? id,
  }) async {
    final item = _makeItem(
      kind: 'frame',
      frame: frame,
      markup: markup,
      notes: notes,
      id: id,
    );

    final updated = [...state.items, item];
    state = state.copyWith(items: updated, activeItemId: item.id);
    await _saveToDatabase();
    _triggerSync();
    return item;
  }

  /// Adds a text note at the current playback time.
  Future<VideoItem> addVideoNote({
    required String noteText,
    List<String>? additionalNotes,
    String? id,
  }) async {
    final notes = [noteText, ...?(additionalNotes)];
    final item = _makeItem(kind: 'note', notes: notes, id: id);

    final updated = [...state.items, item];
    state = state.copyWith(items: updated, activeItemId: item.id);
    await _saveToDatabase();
    _triggerSync();
    return item;
  }

  /// Updates the notes on an existing item.
  Future<void> updateItemNotes(String itemId, List<String> notes) async {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final updated = state.items.map((it) {
      if (it.id == itemId) {
        return it.copyWith(notes: notes, updatedAt: nowMs);
      }
      return it;
    }).toList();

    state = state.copyWith(items: updated);
    await _saveToDatabase();
    _triggerSync();
  }

  /// Deletes an item by [itemId].
  Future<void> deleteItem(String itemId) async {
    final updated = state.items.where((it) => it.id != itemId).toList();
    final wasActive = state.activeItemId == itemId;

    state = state.copyWith(
      items: updated,
      clearActiveItem: wasActive,
    );
    await _saveToDatabase();
    _triggerSync();
  }

  /// Selects an item to show its detail sheet.
  void setActiveItem(String? itemId) {
    if (itemId == null) {
      state = state.copyWith(clearActiveItem: true);
    } else {
      state = state.copyWith(activeItemId: itemId);
    }
  }

  /// Clears any error message.
  void clearError() {
    state = state.copyWith(clearError: true);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  VideoItem _makeItem({
    required String kind,
    FrameImage? frame,
    VideoMarkup? markup,
    List<String>? notes,
    String? id,
  }) {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final randHex = _rng.nextInt(0xFFFFF).toRadixString(36);
    final itemId = id ?? 'vi_${nowMs}_$randHex';

    return VideoItem(
      id: itemId,
      kind: kind,
      videoTime: state.currentTime,
      frame: frame,
      markup: markup,
      notes: notes ?? const <String>[],
      updatedAt: nowMs,
    );
  }

  Future<void> _saveToDatabase() async {
    if (state.url.isEmpty) return;
    final normalized = normalizeUrl(state.url);
    final hash = urlHash(normalized);
    final existing = await _videoPageDao.getPage(hash);
    final nowMs = DateTime.now().millisecondsSinceEpoch;

    final updatedEntity = VideoPageEntity(
      urlHash: hash,
      url: normalized,
      videoId: state.videoId.isEmpty ? null : state.videoId,
      title: state.title ?? existing?.title,
      itemsJson: _encodeItems(state.items),
      updatedAt: nowMs,
      snapJson: existing?.snapJson,
      fileId: existing?.fileId,
      headRevisionId: existing?.headRevisionId,
      highlightsJson: existing?.highlightsJson ?? '[]',
      readerJson: existing?.readerJson,
    );

    await _videoPageDao.upsertPage(updatedEntity);
  }

  void _triggerSync() {
    if (state.url.isEmpty || _syncEngine == null) return;
    final normalized = normalizeUrl(state.url);
    _syncEngine.syncChanged([normalized]).catchError((_) {
      return const SyncResult(reconciled: 0, skipped: 0, errors: []);
    });
  }

  /// Finds the active paragraph index for the given [timeSeconds].
  int _findParagraphIndex(List<CueParagraph> paragraphs, double timeSeconds) {
    // Binary search for the last paragraph whose start ≤ timeSeconds.
    int lo = 0;
    int hi = paragraphs.length - 1;
    int result = 0;

    while (lo <= hi) {
      final mid = (lo + hi) ~/ 2;
      if (paragraphs[mid].start <= timeSeconds) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return result;
  }

  /// Extracts a YouTube video ID from a URL.
  String? _extractVideoId(String url) {
    try {
      final uri = Uri.parse(url);
      if (uri.queryParameters.containsKey('v')) {
        return uri.queryParameters['v'];
      }
      // youtu.be/<id>
      if (uri.host.contains('youtu.be')) {
        final seg = uri.pathSegments;
        if (seg.isNotEmpty) return seg.first;
      }
    } catch (_) {
      // ignore malformed
    }
    return null;
  }

  String _encodeItems(List<VideoItem> items) {
    // Strip runtime-only dataUrl from frames before persisting.
    final stripped = items.map((it) {
      if (it.frame?.dataUrl != null) {
        return it.copyWith(
          frame: FrameImage(
            w: it.frame!.w,
            h: it.frame!.h,
            driveId: it.frame!.driveId,
          ),
        );
      }
      return it;
    }).toList();

    // Manual JSON encoding (no json_serializable).
    final sb = StringBuffer('[');
    for (var i = 0; i < stripped.length; i++) {
      if (i > 0) sb.write(',');
      final json = stripped[i].toJson();
      sb.write(_encodeObject(json));
    }
    sb.write(']');
    return sb.toString();
  }

  String _encodeObject(Object? v) {
    if (v == null) return 'null';
    if (v is bool) return v.toString();
    if (v is num) return v.toString();
    if (v is String) {
      return '"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"';
    }
    if (v is List) {
      return '[${v.map(_encodeObject).join(',')}]';
    }
    if (v is Map) {
      final pairs = v.entries
          .where((e) => e.value != null)
          .map((e) => '"${e.key}":${_encodeObject(e.value)}');
      return '{${pairs.join(',')}}';
    }
    return '"$v"';
  }
}

/// Family provider for [PlayerStateNotifier] keyed by page URL.
final playerStateNotifierProvider =
    StateNotifierProvider.family<PlayerStateNotifier, PlayerState, String>(
        (ref, url) {
  final dao = ref.watch(videoPageDaoProvider);
  final syncEngine = ref.watch(syncEngineProvider);

  final notifier = PlayerStateNotifier(
    videoPageDao: dao,
    syncEngine: syncEngine,
  );

  if (url.isNotEmpty) {
    notifier.loadVideo(url);
  }

  return notifier;
});
