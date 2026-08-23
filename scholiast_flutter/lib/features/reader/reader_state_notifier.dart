import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/algorithms/anchor.dart';
import '../../core/algorithms/normalize.dart';
import '../../core/database/daos/video_page_dao.dart';
import '../../core/database/entities/video_page_entity.dart';
import '../../core/models/linear_article.dart';
import '../../core/models/page_highlight.dart';
import '../../core/providers/core_providers.dart';
import '../../core/sync/sync_engine.dart';
import '../../core/sync/sync_models.dart';

/// Immutable UI state for the Reader view.
@immutable
class ReaderState {
  final String url;
  final LinearArticle? article;
  final List<PageHighlight> highlights;
  final String? activeHighlightId;
  final bool isThreadSheetOpen;
  final bool isEditing;
  final bool isLoading;
  final String? errorMessage;
  final int fontStep;
  final bool isSerif;

  const ReaderState({
    this.url = '',
    this.article,
    this.highlights = const <PageHighlight>[],
    this.activeHighlightId,
    this.isThreadSheetOpen = false,
    this.isEditing = false,
    this.isLoading = false,
    this.errorMessage,
    this.fontStep = 0,
    this.isSerif = false,
  });

  /// The currently active highlight record, if any.
  PageHighlight? get activeHighlight {
    if (activeHighlightId == null) return null;
    for (final h in highlights) {
      if (h.id == activeHighlightId) return h;
    }
    return null;
  }

  ReaderState copyWith({
    String? url,
    LinearArticle? article,
    List<PageHighlight>? highlights,
    String? activeHighlightId,
    bool? isThreadSheetOpen,
    bool? isEditing,
    bool? isLoading,
    String? errorMessage,
    int? fontStep,
    bool? isSerif,
    bool clearActiveHighlight = false,
    bool clearError = false,
  }) {
    return ReaderState(
      url: url ?? this.url,
      article: article ?? this.article,
      highlights: highlights ?? this.highlights,
      activeHighlightId: clearActiveHighlight
          ? null
          : (activeHighlightId ?? this.activeHighlightId),
      isThreadSheetOpen: isThreadSheetOpen ?? this.isThreadSheetOpen,
      isEditing: isEditing ?? this.isEditing,
      isLoading: isLoading ?? this.isLoading,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      fontStep: fontStep ?? this.fontStep,
      isSerif: isSerif ?? this.isSerif,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ReaderState &&
          runtimeType == other.runtimeType &&
          url == other.url &&
          article == other.article &&
          listEquals(highlights, other.highlights) &&
          activeHighlightId == other.activeHighlightId &&
          isThreadSheetOpen == other.isThreadSheetOpen &&
          isEditing == other.isEditing &&
          isLoading == other.isLoading &&
          errorMessage == other.errorMessage &&
          fontStep == other.fontStep &&
          isSerif == other.isSerif;

  @override
  int get hashCode => Object.hash(
        url,
        article,
        Object.hashAll(highlights),
        activeHighlightId,
        isThreadSheetOpen,
        isEditing,
        isLoading,
        errorMessage,
        fontStep,
        isSerif,
      );

  @override
  String toString() =>
      'ReaderState(url: $url, highlights: ${highlights.length}, active: $activeHighlightId, loading: $isLoading)';
}

/// State notifier managing reader document state, highlight CRUD, active comment threads,
/// local SQLite persistence, and background sync triggers.
class ReaderStateNotifier extends StateNotifier<ReaderState> {
  final VideoPageDao _videoPageDao;
  final SyncEngine? _syncEngine;
  final Random _rng = Random();

  ReaderStateNotifier({
    required VideoPageDao videoPageDao,
    SyncEngine? syncEngine,
    ReaderState? initialState,
  })  : _videoPageDao = videoPageDao,
        _syncEngine = syncEngine,
        super(initialState ?? const ReaderState());

  /// Loads an article from SQLite cache or initializes with [initialArticle].
  Future<void> loadArticle(
    String rawUrl, {
    LinearArticle? initialArticle,
  }) async {
    final normalized = normalizeUrl(rawUrl);
    state = state.copyWith(
      url: normalized,
      isLoading: true,
      clearError: true,
    );

    try {
      final hash = urlHash(normalized);
      final entity = await _videoPageDao.getPage(hash);

      LinearArticle? article = initialArticle;
      List<PageHighlight> highlights = [];

      if (entity != null) {
        article = article ?? entity.reader;
        highlights = entity.highlights;
      }

      state = state.copyWith(
        url: normalized,
        article: article,
        highlights: highlights,
        isLoading: false,
      );

      if (initialArticle != null &&
          (entity == null || entity.readerJson == null)) {
        await _saveToDatabase();
      }
    } catch (e) {
      state = state.copyWith(
        isLoading: false,
        errorMessage: e.toString(),
      );
    }
  }

  /// Sets or replaces the article content and persists to DB.
  Future<void> setArticle(LinearArticle article) async {
    state = state.copyWith(article: article);
    await _saveToDatabase();
    _triggerSync();
  }

  /// Creates a new highlight, persists to database, updates UI state, and triggers background sync.
  Future<PageHighlight> createHighlight({
    required String text,
    String color = 'yellow',
    String? xpath,
    int? startOffset,
    int? endOffset,
    TextQuoteAnchor? anchor,
    List<String>? notes,
    String? id,
    Map<String, dynamic>? extras,
  }) async {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final randHex = _rng.nextInt(0xFFFFF).toRadixString(36);
    final highlightId = id ?? 'hl_${nowMs}_$randHex';

    final mergedExtras = <String, dynamic>{
      if (extras != null) ...extras,
      'content': text,
      if (xpath != null) 'xpath': xpath,
      if (startOffset != null) 'startOffset': startOffset,
      if (endOffset != null) 'endOffset': endOffset,
      if (anchor != null) 'anchor': anchor.toJson(),
    };

    final highlight = PageHighlight(
      id: highlightId,
      color: color,
      notes: notes ?? const <String>[],
      updatedAt: nowMs,
      extras: mergedExtras,
    );

    final updated = [...state.highlights, highlight];
    state = state.copyWith(
      highlights: updated,
      activeHighlightId: highlightId,
      isThreadSheetOpen: true,
    );

    await _saveToDatabase();
    _triggerSync();

    return highlight;
  }

  /// Updates comment notes for [highlightId], saves to DB, and triggers background sync.
  Future<void> updateHighlightNotes(
    String highlightId,
    List<String> notes,
  ) async {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final updated = state.highlights.map((h) {
      if (h.id == highlightId) {
        return h.copyWith(notes: notes, updatedAt: nowMs);
      }
      return h;
    }).toList();

    state = state.copyWith(highlights: updated);
    await _saveToDatabase();
    _triggerSync();
  }

  /// Appends a new reply note to [highlightId].
  Future<void> addNoteReply(String highlightId, String replyText) async {
    final target = state.activeHighlight ??
        state.highlights.firstWhere((h) => h.id == highlightId);
    final currentNotes = target.notes ?? const <String>[];
    final updatedNotes = [...currentNotes, replyText.trim()];
    await updateHighlightNotes(highlightId, updatedNotes);
  }

  /// Recolors an existing highlight.
  Future<void> recolorHighlight(String highlightId, String newColor) async {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final updated = state.highlights.map((h) {
      if (h.id == highlightId) {
        return h.copyWith(color: newColor, updatedAt: nowMs);
      }
      return h;
    }).toList();

    state = state.copyWith(highlights: updated);
    await _saveToDatabase();
    _triggerSync();
  }

  /// Deletes a highlight by [highlightId].
  Future<void> deleteHighlight(String highlightId) async {
    final updated =
        state.highlights.where((h) => h.id != highlightId).toList();
    final isDeletingActive = state.activeHighlightId == highlightId;

    state = state.copyWith(
      highlights: updated,
      clearActiveHighlight: isDeletingActive,
      isThreadSheetOpen: isDeletingActive ? false : state.isThreadSheetOpen,
      isEditing: isDeletingActive ? false : state.isEditing,
    );

    await _saveToDatabase();
    _triggerSync();
  }

  /// Selects active highlight for showing the comment thread sheet.
  void setActiveHighlight(String? highlightId) {
    if (highlightId == null) {
      state = state.copyWith(
        clearActiveHighlight: true,
        isThreadSheetOpen: false,
        isEditing: false,
      );
    } else {
      state = state.copyWith(
        activeHighlightId: highlightId,
        isThreadSheetOpen: true,
      );
    }
  }

  /// Controls the visibility of the comment thread bottom sheet.
  void setThreadSheetOpen(bool isOpen) {
    state = state.copyWith(
      isThreadSheetOpen: isOpen,
      isEditing: isOpen ? state.isEditing : false,
      clearActiveHighlight: !isOpen,
    );
  }

  /// Sets edit mode for the active note comment.
  void setIsEditing(bool isEditing) {
    state = state.copyWith(isEditing: isEditing);
  }

  /// Sets reader typography font size step.
  void setFontStep(int step) {
    state = state.copyWith(fontStep: step);
  }

  /// Toggles serif/sans reader typography.
  void setSerif(bool isSerif) {
    state = state.copyWith(isSerif: isSerif);
  }

  /// Clears any error message.
  void clearError() {
    state = state.copyWith(clearError: true);
  }

  // --- Internal Persistence & Sync ---

  Future<void> _saveToDatabase() async {
    if (state.url.isEmpty) return;
    final normalized = normalizeUrl(state.url);
    final hash = urlHash(normalized);
    final existing = await _videoPageDao.getPage(hash);
    final nowMs = DateTime.now().millisecondsSinceEpoch;

    final updatedEntity = VideoPageEntity(
      urlHash: hash,
      url: normalized,
      videoId: existing?.videoId,
      title: state.article?.title ?? existing?.title,
      itemsJson: existing?.itemsJson ?? '[]',
      updatedAt: nowMs,
      snapJson: existing?.snapJson,
      fileId: existing?.fileId,
      headRevisionId: existing?.headRevisionId,
      highlightsJson:
          jsonEncode(state.highlights.map((h) => h.toJson()).toList()),
      readerJson: state.article != null
          ? jsonEncode(state.article!.toJson())
          : existing?.readerJson,
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
}

/// Family provider for [ReaderStateNotifier] keyed by page URL.
final readerStateNotifierProvider = StateNotifierProvider.family<
    ReaderStateNotifier, ReaderState, String>((ref, url) {
  final dao = ref.watch(videoPageDaoProvider);
  final syncEngine = ref.watch(syncEngineProvider);

  final notifier = ReaderStateNotifier(
    videoPageDao: dao,
    syncEngine: syncEngine,
  );

  if (url.isNotEmpty) {
    notifier.loadArticle(url);
  }

  return notifier;
});
