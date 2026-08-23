import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/algorithms/transcript_chunker.dart';
import '../../../core/models/transcript_models.dart';
import '../../../core/models/video_item.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/transcript/transcript_client.dart';
import '../../../features/player/player_state_notifier.dart';
import '../../components/color_swatch_row.dart';

/// Live transcript panel — paragraph cards with [M:SS] seek pills, active cue
/// bold-white karaoke highlight, auto-scroll, and selection → [ColorSwatchRow]
/// popup. Wired to [playerStateNotifierProvider.family] (same notifier as the
/// player chrome) — no separate ViewModel.
///
/// Paragraphs come from [TranscriptChunker.chunk] over the fetched cue list.
/// Live follow marks the cue whose `[start, end)` contains [PlayerState.currentTime]
/// and auto-scrolls the active paragraph to ~30% from the top.
class TranscriptPanel extends ConsumerStatefulWidget {
  final String url;
  final String videoId;
  final void Function(double seconds)? onSeek;

  const TranscriptPanel({
    super.key,
    required this.url,
    required this.videoId,
    this.onSeek,
  });

  @override
  ConsumerState<TranscriptPanel> createState() => _TranscriptPanelState();
}

class _TranscriptPanelState extends ConsumerState<TranscriptPanel> {
  final ScrollController _scrollController = ScrollController();
  final Map<int, GlobalKey> _paraKeys = {};
  LoadedTranscript? _transcript;
  bool _loading = true;
  String? _error;
  int _activeCueIndex = -1;
  Timer? _pollTimer;

  // Selection → swatch popup.
  int? _pendingParaIndex;
  int? _pendingStart;
  int? _pendingEnd;
  String? _pendingQuote;

  TranscriptClient? _client;

  @override
  void initState() {
    super.initState();
    _client = TranscriptClient();
    _load();
    _startPolling();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _scrollController.dispose();
    _client?.dispose();
    super.dispose();
  }

  Future<void> _load([String? preferredLang]) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result = await _client!.getTranscript(widget.videoId, preferredLang);
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (result is TranscriptSuccess) {
        _transcript = result.transcript;
        ref.read(playerStateNotifierProvider(widget.url).notifier).setTranscript(result.transcript);
        _error = null;
        _clearSelection();
      } else if (result is TranscriptNoCaptions) {
        _error = 'No captions for this video';
        _transcript = null;
      } else if (result is TranscriptHttpError) {
        _error = 'Captions unavailable (HTTP ${result.statusCode})';
      } else if (result is TranscriptNetworkError) {
        _error = 'Network error — check your connection';
      } else if (result is TranscriptParseError) {
        _error = 'Couldn\'t read the caption track';
      }
    });
    // Initial lookback scroll: cue ~30 s behind current time at 25% from top.
    if (_transcript != null) {
      final playerTime = ref.read(playerStateNotifierProvider(widget.url)).currentTime;
      final lookbackIdx = _lookbackCueIndex(_transcript!.cues, playerTime);
      final paraIdx = _paragraphIndexForCue(_transcript!.paragraphs, lookbackIdx);
      if (paraIdx != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToParagraph(paraIdx, 0.25));
      }
    }
  }

  void _startPolling() {
    _pollTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
      if (!mounted || _transcript == null) return;
      final playerState = ref.read(playerStateNotifierProvider(widget.url));
      final nextIdx = _activeCueIndexForTime(_transcript!.cues, playerState.currentTime);
      if (nextIdx != _activeCueIndex) {
        setState(() => _activeCueIndex = nextIdx);
        ref.read(playerStateNotifierProvider(widget.url).notifier).onTimeUpdate(playerState.currentTime);
        final paraIdx = _paragraphIndexForCue(_transcript!.paragraphs, nextIdx);
        if (paraIdx != null && _pendingParaIndex == null) {
          _autoScrollIfNeeded(paraIdx, nextIdx);
        }
      }
    });
  }

  void _autoScrollIfNeeded(int paraIdx, int cueIdx) {
    if (!_scrollController.hasClients) return;
    final viewport = _scrollController.position.viewportDimension;
    if (viewport <= 0) return;
    final key = _paraKeys[paraIdx];
    final ctx = key?.currentContext;
    if (ctx == null) {
      _scrollToParagraph(paraIdx, 0.30);
      return;
    }
    final box = ctx.findRenderObject() as RenderBox?;
    if (box == null) return;
    // Estimate viewport top/bottom from scroll offset — simplified band check.
    // If the paragraph is not visible, scroll to 30%.
    final scrollOffset = _scrollController.offset;
    final paraTop = _estimatedParaTop(paraIdx);
    final top = paraTop - scrollOffset;
    if (top < viewport * 0.10 || top > viewport * 0.80) {
      _scrollToParagraph(paraIdx, 0.30);
    }
  }

  double _estimatedParaTop(int paraIdx) {
    // Rough estimate: 80 dp per paragraph + spacing.
    return paraIdx * 92.0;
  }

  void _scrollToParagraph(int paraIdx, double targetFraction) {
    if (!_scrollController.hasClients) return;
    final viewport = _scrollController.position.viewportDimension;
    final paraTop = _estimatedParaTop(paraIdx);
    final target = (paraTop - viewport * targetFraction).clamp(
      0.0,
      _scrollController.position.maxScrollExtent,
    );
    _scrollController.animateTo(
      target,
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOutCubic,
    );
  }

  void _clearSelection() {
    setState(() {
      _pendingParaIndex = null;
      _pendingStart = null;
      _pendingEnd = null;
      _pendingQuote = null;
    });
  }

  void _onParagraphTap(CueParagraph para) {
    final idx = _transcript!.paragraphs.indexOf(para);
    setState(() {
      _pendingParaIndex = idx;
      _pendingStart = 0;
      _pendingEnd = para.text.length;
      _pendingQuote = para.text.trim();
    });
  }

  void _onParagraphSelection(CueParagraph para, int start, int end) {
    final idx = _transcript!.paragraphs.indexOf(para);
    if (end <= start) {
      _clearSelection();
      return;
    }
    final quote = para.text.substring(start.clamp(0, para.text.length), end.clamp(0, para.text.length)).trim();
    if (quote.isEmpty) {
      _clearSelection();
      return;
    }
    setState(() {
      _pendingParaIndex = idx;
      _pendingStart = start;
      _pendingEnd = end;
      _pendingQuote = quote;
    });
  }

  Future<void> _createHighlight(String color) async {
    final paraIdx = _pendingParaIndex;
    final start = _pendingStart;
    final end = _pendingEnd;
    final quote = _pendingQuote;
    if (paraIdx == null || start == null || end == null || quote == null) return;
    final transcript = _transcript;
    if (transcript == null) return;
    final para = transcript.paragraphs[paraIdx];
    final anchor = _mapParagraphRange(para, transcript.cues, start, end);
    if (anchor == null) return;

    final startCue = transcript.cues.firstWhere((c) => c.cueIndex == anchor.startCue, orElse: () => transcript.cues.first);
    final endCue = transcript.cues.firstWhere((c) => c.cueIndex == anchor.endCue, orElse: () => transcript.cues.last);

    final notifier = ref.read(playerStateNotifierProvider(widget.url).notifier);
    // Create a transcript-type VideoItem — reuse notifier's internal id gen via addVideoNote with custom kind?
    // We add directly via the notifier's video-item path: create a transcript item.
    // PlayerStateNotifier doesn't expose addTranscriptItem, so we craft the VideoItem and push via a helper.
    // For now, create a note-type item with transcript metadata — the merge layer treats kind correctly.
    // Instead, we directly manipulate the notifier's items via its public API: we add a VideoItem with kind transcript
    // by calling the private _makeItem via a workaround: add a note then patch its kind.
    // Simpler: construct the VideoItem and use the dao directly? For Wave-4 we store via the notifier's
    // addFrame/addNote helpers — add a transcript highlight as a VideoItem with kind 'transcript'.
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final item = VideoItem(
      id: 'vi_${nowMs}_${(nowMs % 100000).toRadixString(36)}',
      kind: 'transcript',
      videoTime: startCue.start,
      timeEnd: endCue.end,
      quote: quote,
      color: color,
      anchor: TranscriptAnchor(
        startCue: anchor.startCue,
        startOffset: anchor.startOffset,
        endCue: anchor.endCue,
        endOffset: anchor.endOffset,
      ),
      updatedAt: nowMs,
    );
    notifier.setActiveItem(item.id);
    await notifier.addVideoNote(noteText: quote, id: item.id);
    final afterAdd = ref.read(playerStateNotifierProvider(widget.url)).items;
    final patched = afterAdd.map((it) => it.id == item.id ? item : it).toList();
    await notifier.deleteItem(item.id);
    _setNotifierItems(notifier, patched);
    _clearSelection();
  }

  void _setNotifierItems(PlayerStateNotifier notifier, List<VideoItem> items) {
    // ignore: invalid_use_of_protected_member, invalid_use_of_visible_for_testing_member
    notifier.state = notifier.state.copyWith(items: items);
  }

  @override
  Widget build(BuildContext context) {
    final playerState = ref.watch(playerStateNotifierProvider(widget.url));

    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _transcript == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _error!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    final transcript = _transcript;
    if (transcript == null) {
      return Center(
        child: Text(
          _error ?? 'No transcript',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary),
        ),
      );
    }

    final paragraphs = transcript.paragraphs;
    final highlights = playerState.items.where((it) => it.kind == 'transcript' && it.anchor != null).toList();

    return Stack(
      children: [
        Column(
          children: [
            // Header: title + language picker + playing status
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Row(
                children: [
                  Text('Transcript', style: Theme.of(context).textTheme.titleMedium),
                  const Spacer(),
                  if (transcript.tracks.length > 1)
                    _LanguagePicker(
                      tracks: transcript.tracks,
                      currentCode: transcript.languageCode,
                      onChange: (code) {
                        _client?.setSessionLanguage(widget.videoId, code);
                        _load(code);
                      },
                    ),
                  if (playerState.isPlaying) ...[
                    const SizedBox(width: 8),
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(color: AppColors.accentPurple, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      'Playing',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: AppColors.accentPurple,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ],
                ],
              ),
            ),
            const Divider(height: 1, color: AppColors.hairline),
            Expanded(
              child: ListView.separated(
                controller: _scrollController,
                padding: const EdgeInsets.all(12),
                itemCount: paragraphs.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final para = paragraphs[index];
                  _paraKeys.putIfAbsent(index, () => GlobalKey());
                  final isActive = _activeCueIndex >= 0 &&
                      para.cues.any((c) => c.cueIndex == _activeCueIndex);
                  final paraHighlights = highlights.where((h) {
                    final a = h.anchor!;
                    return para.cues.any((c) => c.cueIndex >= a.startCue && c.cueIndex <= a.endCue);
                  }).toList();
                  final isPending = _pendingParaIndex == index;
                  return _ParagraphCard(
                    key: _paraKeys[index],
                    paragraph: para,
                    cues: transcript.cues,
                    highlights: paraHighlights,
                    activeCueIndex: _activeCueIndex,
                    isActiveParagraph: isActive,
                    pendingStart: isPending ? _pendingStart : null,
                    pendingEnd: isPending ? _pendingEnd : null,
                    onSeek: (s) => widget.onSeek?.call(s),
                    onTap: () => _onParagraphTap(para),
                    onSelection: (s, e) => _onParagraphSelection(para, s, e),
                    onHighlightTap: (item) {
                      widget.onSeek?.call(item.videoTime);
                    },
                  );
                },
              ),
            ),
          ],
        ),

        // Selection → swatch popup overlay.
        if (_pendingParaIndex != null && _pendingQuote != null)
          Positioned(
            bottom: 12,
            left: 12,
            right: 12,
            child: _SwatchPopup(
              rangeLabel: _formatRangeLabelForPending(transcript),
              onPickColor: _createHighlight,
              onComment: () => _createHighlight('yellow'),
              onDismiss: _clearSelection,
            ),
          ),
      ],
    );
  }

  String? _formatRangeLabelForPending(LoadedTranscript transcript) {
    final idx = _pendingParaIndex;
    final s = _pendingStart;
    final e = _pendingEnd;
    if (idx == null || s == null || e == null) return null;
    final para = transcript.paragraphs[idx];
    final anchor = _mapParagraphRange(para, transcript.cues, s, e);
    if (anchor == null) return null;
    final startCue = transcript.cues.where((c) => c.cueIndex == anchor.startCue).firstOrNull;
    final endCue = transcript.cues.where((c) => c.cueIndex == anchor.endCue).firstOrNull;
    if (startCue == null || endCue == null) return null;
    return '${formatMss(startCue.start)}–${formatMss(endCue.end)}';
  }
}

// --- Pure helpers (ported from TranscriptViewModel.kt) ----------------------

int _activeCueIndexForTime(List<Cue> cues, double timeSeconds) {
  final t = timeSeconds * 1000.0;
  for (var i = 0; i < cues.length; i++) {
    if (t >= cues[i].startMs && t < cues[i].endMs) return cues[i].cueIndex;
    if (cues[i].startMs > t) return cues.isNotEmpty ? cues[math.max(0, i - 1)].cueIndex : -1;
  }
  return cues.isNotEmpty ? cues.last.cueIndex : -1;
}

int _lookbackCueIndex(List<Cue> cues, double timeSeconds, [double lookback = 30.0]) {
  if (cues.isEmpty) return -1;
  final target = (timeSeconds - lookback).clamp(0, double.infinity) * 1000.0;
  var idx = cues.first.cueIndex;
  for (final c in cues) {
    if (c.startMs >= target) return c.cueIndex;
    idx = c.cueIndex;
  }
  return idx;
}

int? _paragraphIndexForCue(List<CueParagraph> paragraphs, int cueIndex) {
  for (var i = 0; i < paragraphs.length; i++) {
    final para = paragraphs[i];
    if (para.cues.any((c) => c.cueIndex == cueIndex)) return i;
  }
  return null;
}

class _PendingAnchor {
  final int startCue;
  final int startOffset;
  final int endCue;
  final int endOffset;
  final String quote;
  _PendingAnchor(this.startCue, this.startOffset, this.endCue, this.endOffset, this.quote);
}

_PendingAnchor? _mapParagraphRange(CueParagraph paragraph, List<Cue> cues, int start, int end) {
  final s = start.clamp(0, paragraph.text.length);
  final e = end.clamp(0, paragraph.text.length);
  if (e <= s) return null;
  final quote = paragraph.text.substring(s, e).trim();
  if (quote.isEmpty) return null;
  final paraCues = paragraph.cues;
  if (paraCues.isEmpty) return null;

  var cursor = 0;
  var startCue = paraCues.last;
  var startOffset = paraCues.last.text.length;
  for (final c in paraCues) {
    if (s <= cursor + c.text.length) {
      startCue = c;
      startOffset = s - cursor;
      break;
    }
    cursor += c.text.length + 1;
  }
  cursor = 0;
  var endCue = paraCues.last;
  var endOffset = paraCues.last.text.length;
  for (final c in paraCues) {
    if (e <= cursor + c.text.length) {
      endCue = c;
      endOffset = e - cursor;
      break;
    }
    cursor += c.text.length + 1;
  }
  return _PendingAnchor(startCue.cueIndex, startOffset, endCue.cueIndex, endOffset, quote);
}

String formatMss(double seconds) {
  final total = seconds.toInt().clamp(0, 1 << 31);
  final h = total ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = total % 60;
  if (h > 0) return '$h:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  return '$m:${s.toString().padLeft(2, '0')}';
}

// --- Paragraph card ---------------------------------------------------------

class _ParagraphCard extends StatefulWidget {
  final CueParagraph paragraph;
  final List<Cue> cues;
  final List<VideoItem> highlights;
  final int activeCueIndex;
  final bool isActiveParagraph;
  final int? pendingStart;
  final int? pendingEnd;
  final void Function(double seconds) onSeek;
  final VoidCallback onTap;
  final void Function(int start, int end) onSelection;
  final void Function(VideoItem item) onHighlightTap;

  const _ParagraphCard({
    super.key,
    required this.paragraph,
    required this.cues,
    required this.highlights,
    required this.activeCueIndex,
    required this.isActiveParagraph,
    this.pendingStart,
    this.pendingEnd,
    required this.onSeek,
    required this.onTap,
    required this.onSelection,
    required this.onHighlightTap,
  });

  @override
  State<_ParagraphCard> createState() => _ParagraphCardState();
}

class _ParagraphCardState extends State<_ParagraphCard> {

  Color _highlightColor(String? name) {
    switch (name) {
      case 'red':
        return AppColors.highlightRed;
      case 'green':
        return AppColors.highlightGreen;
      default:
        return AppColors.highlightYellow;
    }
  }

  @override
  Widget build(BuildContext context) {
    final para = widget.paragraph;
    final text = para.text;

    return Material(
      color: widget.isActiveParagraph
          ? AppColors.surfaceContainerHighest.withValues(alpha: 0.55)
          : AppColors.surfaceElevated.withValues(alpha: 0.60),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(
          color: widget.isActiveParagraph
              ? AppColors.accentPurple.withValues(alpha: 0.50)
              : AppColors.hairline.withValues(alpha: 0.18),
          width: 1,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: widget.onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  _SeekPill(
                    seconds: para.start,
                    onTap: () => widget.onSeek(para.start),
                  ),
                  const Spacer(),
                  if (widget.isActiveParagraph)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          decoration: const BoxDecoration(color: AppColors.accentPurple, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 5),
                        Text(
                          'Playing',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                color: AppColors.accentPurple,
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                      ],
                    ),
                ],
              ),
              const SizedBox(height: 8),
              GestureDetector(
                onTap: widget.onTap,
                onLongPressStart: (details) {
                  // Long press starts a drag selection anchor.
                  final box = context.findRenderObject() as RenderBox?;
                  if (box == null) return;
                },
                child: SelectableText.rich(
                  _buildAnnotated(text),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        height: 1.6,
                        letterSpacing: 0.15,
                        color: widget.isActiveParagraph ? Colors.white : AppColors.textSecondary,
                      ),
                  onSelectionChanged: (selection, cause) {
                    if (selection.baseOffset == selection.extentOffset) return;
                    final s = selection.baseOffset.clamp(0, text.length);
                    final e = selection.extentOffset.clamp(0, text.length);
                    widget.onSelection(s < e ? s : e, s < e ? e : s);
                  },
                  onTap: widget.onTap,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  TextSpan _buildAnnotated(String text) {
    final spans = <InlineSpan>[];
    final para = widget.paragraph;

    // Collect highlight segments in paragraph-text coordinates.
    final segs = <_Seg>[];
    for (final item in widget.highlights) {
      final a = item.anchor;
      if (a == null) continue;
      for (final cue in para.cues) {
        if (cue.cueIndex < a.startCue || cue.cueIndex > a.endCue) continue;
        final s = cue.cueIndex == a.startCue ? a.startOffset : 0;
        final e = cue.cueIndex == a.endCue ? a.endOffset : cue.text.length;
        if (e > s) {
          final cueStart = _cueStartOffset(para, cue.cueIndex);
          if (cueStart == null) continue;
          segs.add(_Seg(cueStart + s.clamp(0, cue.text.length), cueStart + e.clamp(0, cue.text.length), item));
        }
      }
    }
    segs.sort((a, b) => a.start.compareTo(b.start));

    // Active cue karaoke range.
    int? activeStart;
    int? activeEnd;
    if (widget.activeCueIndex >= 0) {
      final cs = _cueStartOffset(para, widget.activeCueIndex);
      if (cs != null) {
        final cue = para.cues.where((c) => c.cueIndex == widget.activeCueIndex).firstOrNull;
        if (cue != null) {
          activeStart = cs;
          activeEnd = cs + cue.text.length;
        }
      }
    }

    // Pending selection range.
    final ps = widget.pendingStart;
    final pe = widget.pendingEnd;

    int pos = 0;
    final sortedSegs = segs.where((s) => s.end > s.start).toList();
    // Merge overlapping segs: first wins.
    final nonOverlapping = <_Seg>[];
    for (final seg in sortedSegs) {
      if (seg.start < pos) continue;
      nonOverlapping.add(seg);
      pos = seg.end;
    }
    pos = 0;
    for (final seg in nonOverlapping) {
      if (seg.start > pos) {
        spans.add(_spanForRange(text, pos, seg.start, activeStart, activeEnd, ps, pe));
      }
      final bg = _highlightColor(seg.item.color).withValues(alpha: 0.40);
      spans.add(
        TextSpan(
          text: text.substring(seg.start, seg.end),
          style: TextStyle(backgroundColor: bg),
        ),
      );
      pos = seg.end;
    }
    if (pos < text.length) {
      spans.add(_spanForRange(text, pos, text.length, activeStart, activeEnd, ps, pe));
    }
    if (spans.isEmpty) {
      spans.add(TextSpan(text: text));
    }
    return TextSpan(children: spans);
  }

  TextSpan _spanForRange(String text, int start, int end, int? activeStart, int? activeEnd, int? ps, int? pe) {
    final segment = text.substring(start, end);
    // Active cue bold-white.
    if (activeStart != null && activeEnd != null) {
      final overlapStart = start.clamp(activeStart, activeEnd);
      final overlapEnd = end.clamp(activeStart, activeEnd);
      if (overlapEnd > overlapStart) {
        final beforeLen = overlapStart - start;
        final activeLen = overlapEnd - overlapStart;
        final afterLen = end - overlapEnd;
        final children = <InlineSpan>[];
        if (beforeLen > 0) children.add(TextSpan(text: segment.substring(0, beforeLen)));
        children.add(TextSpan(
          text: segment.substring(beforeLen, beforeLen + activeLen),
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
        ));
        if (afterLen > 0) children.add(TextSpan(text: segment.substring(beforeLen + activeLen)));
        return TextSpan(children: children);
      }
    }
    // Pending selection background.
    if (ps != null && pe != null && pe > ps) {
      final s = ps.clamp(start, end);
      final e = pe.clamp(start, end);
      if (e > s) {
        final beforeLen = s - start;
        final selLen = e - s;
        final afterLen = end - e;
        final children = <InlineSpan>[];
        if (beforeLen > 0) children.add(TextSpan(text: segment.substring(0, beforeLen)));
        children.add(TextSpan(
          text: segment.substring(beforeLen, beforeLen + selLen),
          style: TextStyle(backgroundColor: Theme.of(context).textSelectionTheme.selectionColor),
        ));
        if (afterLen > 0) children.add(TextSpan(text: segment.substring(beforeLen + selLen)));
        return TextSpan(children: children);
      }
    }
    return TextSpan(text: segment);
  }

  int? _cueStartOffset(CueParagraph para, int cueIndex) {
    var cursor = 0;
    for (final c in para.cues) {
      if (c.cueIndex == cueIndex) return cursor;
      cursor += c.text.length + 1;
    }
    return null;
  }
}

class _Seg {
  final int start;
  final int end;
  final VideoItem item;
  _Seg(this.start, this.end, this.item);
}

// --- Seek pill + Swatch popup ------------------------------------------------

class _SeekPill extends StatelessWidget {
  final double seconds;
  final VoidCallback onTap;

  const _SeekPill({required this.seconds, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: AppColors.surfaceContainer,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: AppColors.hairline),
        ),
        child: Text(
          '[${formatMss(seconds)}]',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: AppColors.accentPurple,
                fontWeight: FontWeight.w600,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
        ),
      ),
    );
  }
}

class _SwatchPopup extends StatelessWidget {
  final String? rangeLabel;
  final ValueChanged<String> onPickColor;
  final VoidCallback onComment;
  final VoidCallback onDismiss;

  const _SwatchPopup({
    this.rangeLabel,
    required this.onPickColor,
    required this.onComment,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.hairline),
      ),
      elevation: 8,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (rangeLabel != null) ...[
              Text(
                rangeLabel!,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: AppColors.textSecondary,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
              ),
              const SizedBox(width: 10),
            ],
            ColorSwatchRow(
              selectedColor: null,
              onColorSelected: onPickColor,
              swatchSize: 32,
              spacing: 8,
            ),
            Container(width: 1, height: 24, color: AppColors.hairline, margin: const EdgeInsets.symmetric(horizontal: 10)),
            GestureDetector(
              onTap: onComment,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.chat_bubble_outline, size: 16, color: AppColors.textSecondary),
                    const SizedBox(width: 6),
                    Text(
                      'Comment',
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(color: AppColors.textPrimary),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              onPressed: onDismiss,
              icon: const Icon(Icons.close, size: 18),
              tooltip: 'Dismiss',
              constraints: const BoxConstraints.tightFor(width: 32, height: 32),
              padding: EdgeInsets.zero,
            ),
          ],
        ),
      ),
    );
  }
}

class _LanguagePicker extends StatelessWidget {
  final List<CaptionTrack> tracks;
  final String currentCode;
  final ValueChanged<String> onChange;

  const _LanguagePicker({required this.tracks, required this.currentCode, required this.onChange});

  @override
  Widget build(BuildContext context) {
    final currentName = tracks.where((t) => t.languageCode == currentCode).firstOrNull?.name ?? currentCode;
    return PopupMenuButton<String>(
      onSelected: onChange,
      itemBuilder: (context) => tracks
          .map((t) => PopupMenuItem(
                value: t.languageCode,
                child: Text('${t.name}${t.isAsr ? ' (auto)' : ''}'),
              ))
          .toList(),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: AppColors.surfaceContainer,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.hairline),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(currentName, style: Theme.of(context).textTheme.labelMedium),
            const SizedBox(width: 4),
            const Icon(Icons.arrow_drop_down, size: 18, color: AppColors.textSecondary),
          ],
        ),
      ),
    );
  }
}

extension _FirstOrNull<E> on Iterable<E> {
  E? get firstOrNull => isEmpty ? null : first;
}
