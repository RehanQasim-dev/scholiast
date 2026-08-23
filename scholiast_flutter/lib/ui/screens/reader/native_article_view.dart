import 'package:flutter/material.dart';

import 'package:scholiast_flutter/core/models/linear_article.dart';
import 'package:scholiast_flutter/core/models/page_highlight.dart';
import 'package:scholiast_flutter/core/theme/app_colors.dart';
import 'highlight_span_builder.dart';

/// Linux-friendly reader surface.
///
/// Renders the [LinearArticle] blocks with [SelectionArea] and paints
/// highlight backgrounds using [highlight_span_builder] which delegates to
/// `anchor.dart` ranges. This surface is fully testable on Linux without a
/// WebView.
class NativeArticleView extends StatelessWidget {
  final LinearArticle article;
  final List<PageHighlight> highlights;
  final String? activeHighlightId;
  final int fontStep;
  final bool isSerif;
  final ValueChanged<PageHighlight>? onHighlightTap;
  final ValueChanged<String>? onLinkTap;
  final void Function(String selectedText)? onSelectionCreated;

  const NativeArticleView({
    super.key,
    required this.article,
    this.highlights = const [],
    this.activeHighlightId,
    this.fontStep = 0,
    this.isSerif = false,
    this.onHighlightTap,
    this.onLinkTap,
    this.onSelectionCreated,
  });

  double get _fontSize => (16 + fontStep * 2).clamp(12, 28).toDouble();

  @override
  Widget build(BuildContext context) {
    if (article.blocks.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'No readable content',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.textSecondary,
                ),
          ),
        ),
      );
    }

    final fullText = buildFullArticleText(article);
    final offsets = buildBlockOffsets(article);

    final baseStyle = TextStyle(
      fontSize: _fontSize,
      height: 1.6,
      color: AppColors.textPrimary,
      fontFamily: isSerif ? 'Libre Caslon Text' : null,
    );

    return SelectionArea(
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 120),
        itemCount: article.blocks.length + 1,
        itemBuilder: (context, index) {
          if (index == 0) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (article.title != null && article.title!.isNotEmpty)
                    Text(
                      article.title!,
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                            fontFamily: isSerif ? 'Libre Caslon Text' : null,
                            fontSize: _fontSize + 8,
                          ),
                    ),
                  if (article.byline != null && article.byline!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      article.byline!,
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: AppColors.textSecondary,
                          ),
                    ),
                  ],
                  const Divider(height: 24, color: AppColors.hairline),
                ],
              ),
            );
          }

          final blockIndex = index - 1;
          final block = article.blocks[blockIndex];
          final blockSpans = highlightSpansForBlock(
            blockIndex: blockIndex,
            article: article,
            blockOffsets: offsets,
            fullText: fullText,
            highlights: highlights,
            activeHighlightId: activeHighlightId,
          );

          // Image block
          if (block.kind == 'img' && block.imgUrl != null) {
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network(
                      block.imgUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => Container(
                        height: 160,
                        decoration: BoxDecoration(
                          color: AppColors.surfaceContainer,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.hairline),
                        ),
                        alignment: Alignment.center,
                        child: const Icon(
                          Icons.broken_image_outlined,
                          color: AppColors.textTertiary,
                        ),
                      ),
                    ),
                  ),
                  if (block.imgAlt != null && block.imgAlt!.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      block.imgAlt!,
                      style: Theme.of(context).textTheme.labelSmall,
                    ),
                  ],
                ],
              ),
            );
          }

          // Heading blocks
          final isHeading = block.kind.startsWith('h');
          final headingStyle = isHeading
              ? Theme.of(context).textTheme.titleLarge?.copyWith(
                    fontSize: _fontSize + (block.kind == 'h1' ? 6 : 2),
                    fontFamily: isSerif ? 'Libre Caslon Text' : null,
                  )
              : null;

          // List block prefix
          final prefix = _listPrefix(block);

          final spans = buildBlockTextSpans(
            text: block.text,
            spans: blockSpans,
            onTapHighlight: (h) => onHighlightTap?.call(h),
            baseStyle: (isHeading ? headingStyle : baseStyle) ?? baseStyle,
          );

          final richText = RichText(
            text: TextSpan(children: spans),
          );

          // Inline annotations: links are already styled via spans; we add
          // tap handling for LinearAnn links by wrapping with GestureDetector
          // if needed. For now we render prefix + richText row.
          if (prefix != null) {
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    prefix,
                    style: baseStyle.copyWith(color: AppColors.textSecondary),
                  ),
                  const SizedBox(width: 8),
                  Expanded(child: richText),
                ],
              ),
            );
          }

          return Padding(
            padding: EdgeInsets.symmetric(
              vertical: isHeading ? 10 : 6,
            ),
            child: richText,
          );
        },
      ),
    );
  }

  String? _listPrefix(LinearBlock block) {
    if (block.kind == 'li' || block.kind == 'ul' || block.kind == 'ol') {
      if (block.listOrdinal != null) return '${block.listOrdinal}.';
      return '•';
    }
    return null;
  }
}
