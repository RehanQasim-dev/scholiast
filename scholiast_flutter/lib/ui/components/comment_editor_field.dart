import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../core/theme/app_colors.dart';

/// Supported markdown format commands for the comment editor.
enum CommentFormatCommand {
  bold,
  italic,
  code,
  bulletList,
  checklist,
  link,
}

/// Rich comment and note editor field with markdown toolbar, keyboard shortcuts,
/// voice note trigger, and send/cancel actions.
class CommentEditorField extends StatefulWidget {
  final TextEditingController? controller;
  final FocusNode? focusNode;
  final String placeholder;
  final String? initialText;
  final ValueChanged<String>? onSubmitted;
  final VoidCallback? onCancel;
  final VoidCallback? onVoiceRecordPressed;
  final ValueChanged<String>? onChanged;
  final bool isSubmitting;
  final bool autofocus;
  final bool allowEmptySubmit;
  final int minLines;
  final int? maxLines;

  const CommentEditorField({
    super.key,
    this.controller,
    this.focusNode,
    this.placeholder = 'Write a note…',
    this.initialText,
    this.onSubmitted,
    this.onCancel,
    this.onVoiceRecordPressed,
    this.onChanged,
    this.isSubmitting = false,
    this.autofocus = false,
    this.allowEmptySubmit = false,
    this.minLines = 3,
    this.maxLines,
  });

  @override
  State<CommentEditorField> createState() => _CommentEditorFieldState();
}

class _CommentEditorFieldState extends State<CommentEditorField> {
  late TextEditingController _controller;
  late FocusNode _focusNode;
  bool _ownsController = false;
  bool _ownsFocusNode = false;

  @override
  void initState() {
    super.initState();
    if (widget.controller != null) {
      _controller = widget.controller!;
    } else {
      _controller = TextEditingController(text: widget.initialText ?? '');
      _ownsController = true;
    }

    if (widget.focusNode != null) {
      _focusNode = widget.focusNode!;
    } else {
      _focusNode = FocusNode();
      _ownsFocusNode = true;
    }
  }

  @override
  void dispose() {
    if (_ownsController) {
      _controller.dispose();
    }
    if (_ownsFocusNode) {
      _focusNode.dispose();
    }
    super.dispose();
  }

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty && !widget.allowEmptySubmit) return;
    widget.onSubmitted?.call(_controller.text);
  }

  void _cancel() {
    widget.onCancel?.call();
  }

  void _applyFormat(CommentFormatCommand command) {
    final value = _controller.value;
    final text = value.text;
    final selection = value.selection;

    switch (command) {
      case CommentFormatCommand.bold:
        _wrapSelection('**', '**');
        break;
      case CommentFormatCommand.italic:
        _wrapSelection('*', '*');
        break;
      case CommentFormatCommand.code:
        _wrapSelection('`', '`');
        break;
      case CommentFormatCommand.bulletList:
        _insertLinePrefix('- ');
        break;
      case CommentFormatCommand.checklist:
        _insertLinePrefix('- [ ] ');
        break;
      case CommentFormatCommand.link:
        _insertLink();
        break;
    }
  }

  void _wrapSelection(String prefix, String suffix) {
    final value = _controller.value;
    final text = value.text;
    final selection = value.selection;

    if (!selection.isValid || selection.isCollapsed) {
      final pos = selection.isValid ? selection.baseOffset : text.length;
      final newText = text.replaceRange(pos, pos, '$prefix$suffix');
      _controller.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(offset: pos + prefix.length),
      );
    } else {
      final start = selection.start;
      final end = selection.end;
      final selectedText = text.substring(start, end);

      if (selectedText.startsWith(prefix) && selectedText.endsWith(suffix) &&
          selectedText.length >= prefix.length + suffix.length) {
        // Unwrap
        final unwrapped = selectedText.substring(prefix.length, selectedText.length - suffix.length);
        final newText = text.replaceRange(start, end, unwrapped);
        _controller.value = TextEditingValue(
          text: newText,
          selection: TextSelection(
            baseOffset: start,
            extentOffset: start + unwrapped.length,
          ),
        );
      } else {
        // Wrap
        final wrapped = '$prefix$selectedText$suffix';
        final newText = text.replaceRange(start, end, wrapped);
        _controller.value = TextEditingValue(
          text: newText,
          selection: TextSelection(
            baseOffset: start + prefix.length,
            extentOffset: end + prefix.length,
          ),
        );
      }
    }
    widget.onChanged?.call(_controller.text);
  }

  void _insertLinePrefix(String prefix) {
    final value = _controller.value;
    final text = value.text;
    final selection = value.selection;
    final pos = selection.isValid ? selection.start : text.length;

    // Find start of current line
    final lineStart = text.lastIndexOf('\n', pos == 0 ? 0 : pos - 1) + 1;
    final lineSub = text.substring(lineStart);

    if (lineSub.startsWith(prefix)) {
      // Remove prefix
      final newText = text.replaceRange(lineStart, lineStart + prefix.length, '');
      final newOffset = (pos - prefix.length).clamp(0, newText.length);
      _controller.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(offset: newOffset),
      );
    } else {
      // Insert prefix
      final newText = text.replaceRange(lineStart, lineStart, prefix);
      _controller.value = TextEditingValue(
        text: newText,
        selection: TextSelection.collapsed(offset: pos + prefix.length),
      );
    }
    widget.onChanged?.call(_controller.text);
  }

  void _insertLink() {
    final value = _controller.value;
    final text = value.text;
    final selection = value.selection;

    if (selection.isValid && !selection.isCollapsed) {
      final selectedText = text.substring(selection.start, selection.end);
      final linkText = '[$selectedText](url)';
      final newText = text.replaceRange(selection.start, selection.end, linkText);
      _controller.value = TextEditingValue(
        text: newText,
        selection: TextSelection(
          baseOffset: selection.start + selectedText.length + 3,
          extentOffset: selection.start + selectedText.length + 6,
        ),
      );
    } else {
      final pos = selection.isValid ? selection.baseOffset : text.length;
      const linkText = '[link](url)';
      final newText = text.replaceRange(pos, pos, linkText);
      _controller.value = TextEditingValue(
        text: newText,
        selection: TextSelection(
          baseOffset: pos + 1,
          extentOffset: pos + 5,
        ),
      );
    }
    widget.onChanged?.call(_controller.text);
  }

  @override
  Widget build(BuildContext context) {
    return CallbackShortcuts(
      bindings: <ShortcutActivator, VoidCallback>{
        const SingleActivator(LogicalKeyboardKey.escape): _cancel,
        const SingleActivator(LogicalKeyboardKey.enter, control: true): _submit,
        const SingleActivator(LogicalKeyboardKey.enter, meta: true): _submit,
        const SingleActivator(LogicalKeyboardKey.keyB, control: true): () => _applyFormat(CommentFormatCommand.bold),
        const SingleActivator(LogicalKeyboardKey.keyB, meta: true): () => _applyFormat(CommentFormatCommand.bold),
        const SingleActivator(LogicalKeyboardKey.keyI, control: true): () => _applyFormat(CommentFormatCommand.italic),
        const SingleActivator(LogicalKeyboardKey.keyI, meta: true): () => _applyFormat(CommentFormatCommand.italic),
      },
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surfaceElevated,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.hairline, width: 1),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
              child: TextField(
                controller: _controller,
                focusNode: _focusNode,
                autofocus: widget.autofocus,
                minLines: widget.minLines,
                maxLines: widget.maxLines,
                style: const TextStyle(
                  fontSize: 14.5,
                  height: 1.5,
                  color: AppColors.textPrimary,
                ),
                cursorColor: AppColors.accentPurple,
                onChanged: widget.onChanged,
                decoration: InputDecoration(
                  hintText: widget.placeholder,
                  hintStyle: const TextStyle(
                    color: AppColors.textDisabled,
                    fontSize: 14,
                  ),
                  filled: false,
                  isDense: true,
                  contentPadding: EdgeInsets.zero,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                ),
              ),
            ),
            const Divider(height: 1, color: AppColors.hairline),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
              child: Row(
                children: [
                  // Formatting bar
                  _FormatBarButton(
                    icon: Icons.format_bold,
                    tooltip: 'Bold (Ctrl+B)',
                    onPressed: () => _applyFormat(CommentFormatCommand.bold),
                  ),
                  _FormatBarButton(
                    icon: Icons.format_italic,
                    tooltip: 'Italic (Ctrl+I)',
                    onPressed: () => _applyFormat(CommentFormatCommand.italic),
                  ),
                  _FormatBarButton(
                    icon: Icons.code,
                    tooltip: 'Inline code',
                    onPressed: () => _applyFormat(CommentFormatCommand.code),
                  ),
                  _FormatBarButton(
                    icon: Icons.format_list_bulleted,
                    tooltip: 'Bullet list',
                    onPressed: () => _applyFormat(CommentFormatCommand.bulletList),
                  ),
                  _FormatBarButton(
                    icon: Icons.check_box_outlined,
                    tooltip: 'Checklist',
                    onPressed: () => _applyFormat(CommentFormatCommand.checklist),
                  ),
                  _FormatBarButton(
                    icon: Icons.link,
                    tooltip: 'Insert link',
                    onPressed: () => _applyFormat(CommentFormatCommand.link),
                  ),
                  const Spacer(),
                  // Voice note mic button
                  if (widget.onVoiceRecordPressed != null)
                    _FormatBarButton(
                      icon: Icons.mic_none,
                      tooltip: 'Record voice note',
                      iconColor: AppColors.accentPurple,
                      onPressed: widget.onVoiceRecordPressed,
                    ),
                  // Cancel button
                  if (widget.onCancel != null) ...[
                    const SizedBox(width: 2),
                    IconButton(
                      icon: const Icon(Icons.close, size: 18),
                      tooltip: 'Cancel (Esc)',
                      color: AppColors.textSecondary,
                      padding: const EdgeInsets.all(6),
                      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                      onPressed: _cancel,
                    ),
                  ],
                  const SizedBox(width: 4),
                  // Send / Submit button
                  ValueListenableBuilder<TextEditingValue>(
                    valueListenable: _controller,
                    builder: (context, val, _) {
                      final hasContent = val.text.trim().isNotEmpty || widget.allowEmptySubmit;
                      return Material(
                        color: hasContent && !widget.isSubmitting
                            ? AppColors.accentPurple
                            : AppColors.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(8),
                        child: InkWell(
                          onTap: hasContent && !widget.isSubmitting ? _submit : null,
                          borderRadius: BorderRadius.circular(8),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            child: widget.isSubmitting
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: AppColors.onAccent,
                                    ),
                                  )
                                : Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        Icons.arrow_upward,
                                        size: 16,
                                        color: hasContent
                                            ? AppColors.onAccent
                                            : AppColors.textDisabled,
                                      ),
                                    ],
                                  ),
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FormatBarButton extends StatelessWidget {
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final Color? iconColor;

  const _FormatBarButton({
    required this.icon,
    required this.tooltip,
    this.onPressed,
    this.iconColor,
  });

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: Icon(icon, size: 18, color: iconColor ?? AppColors.textSecondary),
      tooltip: tooltip,
      padding: const EdgeInsets.all(6),
      constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
      onPressed: onPressed,
    );
  }
}
