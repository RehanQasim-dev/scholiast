import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:scholiast_flutter/core/models/linear_article.dart';
import 'package:scholiast_flutter/core/theme/app_colors.dart';
import 'package:scholiast_flutter/features/reader/reader_state_notifier.dart';
import 'package:scholiast_flutter/ui/components/color_swatch_row.dart';
import 'native_article_view.dart';
import 'reader_thread_sheet.dart';
import 'reader_web_controller.dart';
import 'reader_web_view_host.dart';

/// Reader screen — top bar + article surface + selection swatches + thread sheet.
///
/// Wired through `readerStateNotifierProvider.family(url)`.
/// On Android the live WebView is used; on Linux/desktop and in tests the
/// [NativeArticleView] renders [LinearArticle] blocks with `anchor.dart` ranges
/// (fully unit-testable).
class ReaderScreen extends ConsumerStatefulWidget {
  final String url;
  final LinearArticle? initialArticle;
  final ReaderWebController? webController;
  final bool forceNativeView;

  const ReaderScreen({
    super.key,
    required this.url,
    this.initialArticle,
    this.webController,
    this.forceNativeView = false,
  });

  @override
  ConsumerState<ReaderScreen> createState() => _ReaderScreenState();
}

class _ReaderScreenState extends ConsumerState<ReaderScreen> {
  String? _pendingSelectionText;
  bool _showSelectionRow = false;
  double _scrollPct = 0;

  @override
  void initState() {
    super.initState();
    // Seed initialArticle if provided and state has no article yet.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.initialArticle != null) {
        final notifier = ref.read(readerStateNotifierProvider(widget.url).notifier);
        final current = ref.read(readerStateNotifierProvider(widget.url));
        if (current.article == null) {
          notifier.setArticle(widget.initialArticle!);
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(readerStateNotifierProvider(widget.url));
    final notifier = ref.read(readerStateNotifierProvider(widget.url).notifier);

    // Paint highlights into WebView when state changes (best-effort).
    final controller = widget.webController;
    if (controller != null && controller.isReady) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        controller.paintHighlights(state.highlights);
      });
    }

    final useWebView = !widget.forceNativeView &&
        state.article == null &&
        widget.url.isNotEmpty &&
        controller == null;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: _buildTopBar(context, state, notifier),
      body: Column(
        children: [
          if (_showSelectionRow && _pendingSelectionText != null)
            _buildSelectionRow(state, notifier),

          if (state.isLoading)
            const LinearProgressIndicator(
              color: AppColors.accentPurple,
              backgroundColor: AppColors.surfaceContainer,
            ),

          if (state.errorMessage != null)
            Container(
              width: double.infinity,
              color: AppColors.dangerWeak,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, size: 16, color: AppColors.danger),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      state.errorMessage!,
                      style: const TextStyle(fontSize: 12, color: AppColors.danger),
                    ),
                  ),
                  TextButton(
                    onPressed: () => notifier.clearError(),
                    child: const Text('Dismiss'),
                  ),
                ],
              ),
            ),

          Expanded(
            child: _buildBody(
              context: context,
              state: state,
              notifier: notifier,
              useWebView: useWebView,
            ),
          ),

          // Scroll position indicator when using WebView
          if (useWebView && _scrollPct > 0)
            LinearProgressIndicator(
              value: _scrollPct.clamp(0, 1),
              color: AppColors.accentPurple,
              backgroundColor: AppColors.surfaceContainer,
              minHeight: 2,
            ),
        ],
      ),
      bottomSheet: _buildThreadSheet(state, notifier),
    );
  }

  PreferredSizeWidget _buildTopBar(
    BuildContext context,
    ReaderState state,
    ReaderStateNotifier notifier,
  ) {
    return AppBar(
      backgroundColor: AppColors.background,
      surfaceTintColor: Colors.transparent,
      title: Text(
        state.article?.title ?? _domainOf(state.url.isNotEmpty ? state.url : widget.url),
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      actions: [
        // Demo helper for widget tests — triggers a pending selection row.
        IconButton(
          key: const Key('reader-demo-selection'),
          tooltip: 'Demo selection',
          onPressed: () => setState(() {
            _pendingSelectionText = 'Demo selected text';
            _showSelectionRow = true;
          }),
          icon: const Icon(Icons.highlight_outlined, size: 18),
        ),
        IconButton(
          tooltip: 'Decrease font size',
          onPressed: state.fontStep > -4
              ? () {
                  final next = (state.fontStep - 1).clamp(-4, 6);
                  notifier.setFontStep(next);
                  widget.webController?.setReaderTheme(
                    fontStep: next,
                    isSerif: state.isSerif,
                  );
                }
              : null,
          icon: const Icon(Icons.text_decrease, size: 18),
        ),
        Center(
          child: Text(
            '${(16 + state.fontStep * 2).clamp(12, 28)}',
            style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
        ),
        IconButton(
          tooltip: 'Increase font size',
          onPressed: state.fontStep < 6
              ? () {
                  final next = (state.fontStep + 1).clamp(-4, 6);
                  notifier.setFontStep(next);
                  widget.webController?.setReaderTheme(
                    fontStep: next,
                    isSerif: state.isSerif,
                  );
                }
              : null,
          icon: const Icon(Icons.text_increase, size: 18),
        ),
        const SizedBox(width: 4),
        IconButton(
          tooltip: state.isSerif ? 'Sans-serif' : 'Serif',
          onPressed: () {
            final next = !state.isSerif;
            notifier.setSerif(next);
            widget.webController?.setReaderTheme(
              fontStep: state.fontStep,
              isSerif: next,
            );
          },
          icon: Icon(
            state.isSerif ? Icons.article_outlined : Icons.article,
            size: 18,
            color: state.isSerif ? AppColors.accentPurple : AppColors.textSecondary,
          ),
        ),
        const SizedBox(width: 4),
      ],
    );
  }

  Widget _buildSelectionRow(ReaderState state, ReaderStateNotifier notifier) {
    return Container(
      color: AppColors.surfaceElevated,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              _pendingSelectionText ?? '',
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textSecondary,
                fontStyle: FontStyle.italic,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: 12),
          ColorSwatchRow(
            selectedColor: 'yellow',
            onColorSelected: (color) async {
              final text = _pendingSelectionText;
              if (text == null || text.trim().isEmpty) return;
              await notifier.createHighlight(text: text.trim(), color: color);
              if (mounted) {
                setState(() {
                  _pendingSelectionText = null;
                  _showSelectionRow = false;
                });
              }
              unawaited(widget.webController?.commitPending() ?? Future.value());
            },
            swatchSize: 24,
            spacing: 8,
          ),
          IconButton(
            icon: const Icon(Icons.close, size: 16, color: AppColors.textTertiary),
            onPressed: () => setState(() {
              _pendingSelectionText = null;
              _showSelectionRow = false;
            }),
            tooltip: 'Dismiss',
            padding: const EdgeInsets.all(4),
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          ),
        ],
      ),
    );
  }

  Widget _buildBody({
    required BuildContext context,
    required ReaderState state,
    required ReaderStateNotifier notifier,
    required bool useWebView,
  }) {
    if (useWebView) {
      return ReaderWebViewHost(
        url: widget.url,
        controller: widget.webController,
        onReady: (_) {
          widget.webController?.paintHighlights(state.highlights);
          widget.webController?.setReaderTheme(
            fontStep: state.fontStep,
            isSerif: state.isSerif,
          );
        },
        onHighlightCreated: (payload) async {
          final text = payload['text'] as String? ?? payload['quote'] as String? ?? '';
          final color = payload['color'] as String? ?? 'yellow';
          final anchor = payload['anchor'];
          Map<String, dynamic>? extras;
          if (anchor is Map) {
            extras = {'anchor': Map<String, dynamic>.from(anchor)};
          }
          if (text.isNotEmpty) {
            await notifier.createHighlight(
              text: text,
              color: color,
              extras: extras,
            );
          }
        },
        onHighlightUpdated: (id, payload) async {
          // Recolor or anchor update
          final color = payload['color'] as String?;
          if (color != null && id.isNotEmpty) {
            await notifier.recolorHighlight(id, color);
          }
        },
        onHighlightDeleted: (id, _) async {
          if (id.isNotEmpty) await notifier.deleteHighlight(id);
        },
        onLinkTap: (href) {
          // Hand off to host app / external browser if needed
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Link: $href')),
          );
        },
        onScrollPct: (pct) => setState(() => _scrollPct = pct),
        onSelectionState: (hasSelection, text) {
          if (hasSelection && text.trim().isNotEmpty) {
            setState(() {
              _pendingSelectionText = text;
              _showSelectionRow = true;
            });
          } else {
            setState(() {
              _pendingSelectionText = null;
              _showSelectionRow = false;
            });
          }
        },
      );
    }

    final article = state.article ?? widget.initialArticle;
    if (article == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.article_outlined, size: 40, color: AppColors.textDisabled),
              const SizedBox(height: 12),
              Text(
                'No article loaded',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      color: AppColors.textSecondary,
                    ),
              ),
              const SizedBox(height: 8),
              Text(
                widget.url,
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              // Demo trigger for selection row (useful on desktop without real selection)
              OutlinedButton(
                onPressed: () => setState(() {
                  _pendingSelectionText = 'Demo selected text';
                  _showSelectionRow = true;
                }),
                child: const Text('Simulate selection'),
              ),
            ],
          ),
        ),
      );
    }

    return NativeArticleView(
      article: article,
      highlights: state.highlights,
      activeHighlightId: state.activeHighlightId,
      fontStep: state.fontStep,
      isSerif: state.isSerif,
      onHighlightTap: (h) => notifier.setActiveHighlight(h.id),
      onSelectionCreated: (selectedText) {
        setState(() {
          _pendingSelectionText = selectedText;
          _showSelectionRow = true;
        });
      },
    );
  }

  Widget? _buildThreadSheet(ReaderState state, ReaderStateNotifier notifier) {
    final active = state.activeHighlight;
    if (!state.isThreadSheetOpen || active == null) return null;

    return ReaderThreadSheet(
      highlight: active,
      onRecolor: (id, color) => notifier.recolorHighlight(id, color),
      onDelete: (id) => notifier.deleteHighlight(id),
      onAddReply: (id, reply) => notifier.addNoteReply(id, reply),
      onUpdateNotes: (id, notes) => notifier.updateHighlightNotes(id, notes),
      onClose: () => notifier.setThreadSheetOpen(false),
    );
  }

  static String _domainOf(String url) {
    try {
      final uri = Uri.parse(url);
      if (uri.host.isNotEmpty) return uri.host.replaceFirst('www.', '');
    } catch (_) {}
    return url.isEmpty ? 'Reader' : url;
  }
}
