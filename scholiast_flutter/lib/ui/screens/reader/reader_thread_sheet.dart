import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:scholiast_flutter/core/models/page_highlight.dart';
import 'package:scholiast_flutter/core/theme/app_colors.dart';
import 'package:scholiast_flutter/ui/components/color_swatch_row.dart';
import 'package:scholiast_flutter/ui/components/comment_editor_field.dart';

/// Thread sheet ported from `android/ThreadSheet.kt`.
///
/// Shows quote header + notes thread + reply editor + recolor/delete actions.
/// Rendered as a modal bottom sheet or an inline panel depending on caller.
class ReaderThreadSheet extends ConsumerStatefulWidget {
  final PageHighlight highlight;
  final Future<void> Function(String highlightId, String newColor) onRecolor;
  final Future<void> Function(String highlightId) onDelete;
  final Future<void> Function(String highlightId, String reply) onAddReply;
  final Future<void> Function(String highlightId, List<String> notes) onUpdateNotes;
  final VoidCallback? onClose;

  const ReaderThreadSheet({
    super.key,
    required this.highlight,
    required this.onRecolor,
    required this.onDelete,
    required this.onAddReply,
    required this.onUpdateNotes,
    this.onClose,
  });

  @override
  ConsumerState<ReaderThreadSheet> createState() => _ReaderThreadSheetState();
}

class _ReaderThreadSheetState extends ConsumerState<ReaderThreadSheet> {
  int? _editingIndex;

  String get _quoteText {
    final extras = widget.highlight.extras;
    final content = extras['content'] as String?;
    if (content != null && content.isNotEmpty) return content;
    final anchor = extras['anchor'];
    if (anchor is Map && anchor['quote'] is String) {
      return anchor['quote'] as String;
    }
    return 'Highlight';
  }

  @override
  Widget build(BuildContext context) {
    final highlight = widget.highlight;
    final notes = highlight.notes ?? const <String>[];
    final color = highlight.color ?? 'yellow';

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surfaceElevated,
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        border: Border(top: BorderSide(color: AppColors.hairline)),
      ),
      child: SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 12,
            bottom: MediaQuery.of(context).viewInsets.bottom + 16,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Drag handle
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.hairline,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 12),

              // Header row: quote + close
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 3,
                    height: 28,
                    decoration: BoxDecoration(
                      color: AppColors.getHighlightColor(color),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _quoteText,
                          style: const TextStyle(
                            fontSize: 13.5,
                            height: 1.45,
                            color: AppColors.textPrimary,
                            fontStyle: FontStyle.italic,
                          ),
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 6),
                        ColorSwatchRow(
                          selectedColor: color,
                          onColorSelected: (newColor) async {
                            await widget.onRecolor(highlight.id, newColor);
                          },
                          swatchSize: 22,
                          spacing: 8,
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 18, color: AppColors.textSecondary),
                    onPressed: widget.onClose,
                    tooltip: 'Close',
                    padding: const EdgeInsets.all(6),
                    constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  ),
                ],
              ),

              const SizedBox(height: 16),
              const Divider(height: 1, color: AppColors.hairline),
              const SizedBox(height: 12),

              // Notes thread
              if (notes.isNotEmpty)
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: notes.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (context, index) {
                      final note = notes[index];
                      final isEditing = _editingIndex == index;

                      if (isEditing) {
                        return CommentEditorField(
                          initialText: note,
                          autofocus: true,
                          minLines: 2,
                          placeholder: 'Edit note…',
                          onSubmitted: (newText) async {
                            final updated = List<String>.from(notes);
                            updated[index] = newText;
                            await widget.onUpdateNotes(highlight.id, updated);
                            if (mounted) setState(() => _editingIndex = null);
                          },
                          onCancel: () => setState(() => _editingIndex = null),
                        );
                      }

                      return Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: AppColors.surfaceContainer,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: AppColors.hairline),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Text(
                                note,
                                style: const TextStyle(
                                  fontSize: 14,
                                  height: 1.45,
                                  color: AppColors.textPrimary,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            InkWell(
                              onTap: () => setState(() => _editingIndex = index),
                              borderRadius: BorderRadius.circular(6),
                              child: const Padding(
                                padding: EdgeInsets.all(4),
                                child: Icon(Icons.edit_outlined,
                                    size: 16, color: AppColors.textTertiary),
                              ),
                            ),
                            InkWell(
                              onTap: () async {
                                final updated = List<String>.from(notes)
                                  ..removeAt(index);
                                await widget.onUpdateNotes(highlight.id, updated);
                              },
                              borderRadius: BorderRadius.circular(6),
                              child: const Padding(
                                padding: EdgeInsets.all(4),
                                child: Icon(Icons.delete_outline,
                                    size: 16, color: AppColors.textTertiary),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                )
              else
                Text(
                  'No notes yet. Add the first one below.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.textTertiary,
                      ),
                ),

              const SizedBox(height: 12),

              // Reply editor
              CommentEditorField(
                key: ValueKey('reply_${highlight.id}_${notes.length}'),
                placeholder: notes.isEmpty ? 'Add a note…' : 'Reply…',
                minLines: 2,
                onSubmitted: (text) async {
                  final trimmed = text.trim();
                  if (trimmed.isEmpty) return;
                  await widget.onAddReply(highlight.id, trimmed);
                },
              ),

              const SizedBox(height: 12),

              // Delete highlight action
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () async {
                    final confirmed = await showDialog<bool>(
                      context: context,
                      builder: (context) => AlertDialog(
                        title: const Text('Delete highlight?'),
                        content: const Text(
                          'This removes the highlight and its notes. This cannot be undone.',
                        ),
                        actions: [
                          TextButton(
                            onPressed: () => Navigator.pop(context, false),
                            child: const Text('Cancel'),
                          ),
                          TextButton(
                            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
                            onPressed: () => Navigator.pop(context, true),
                            child: const Text('Delete'),
                          ),
                        ],
                      ),
                    );
                    if (confirmed == true) {
                      await widget.onDelete(highlight.id);
                      widget.onClose?.call();
                    }
                  },
                  icon: const Icon(Icons.delete_outline, size: 16, color: AppColors.danger),
                  label: const Text(
                    'Delete highlight',
                    style: TextStyle(color: AppColors.danger, fontSize: 13),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Convenience: show the sheet as a modal bottom sheet.
Future<void> showReaderThreadSheet({
  required BuildContext context,
  required PageHighlight highlight,
  required Future<void> Function(String id, String color) onRecolor,
  required Future<void> Function(String id) onDelete,
  required Future<void> Function(String id, String reply) onAddReply,
  required Future<void> Function(String id, List<String> notes) onUpdateNotes,
  VoidCallback? onClose,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => ReaderThreadSheet(
      highlight: highlight,
      onRecolor: onRecolor,
      onDelete: onDelete,
      onAddReply: onAddReply,
      onUpdateNotes: onUpdateNotes,
      onClose: () => Navigator.pop(context),
    ),
  );
}
