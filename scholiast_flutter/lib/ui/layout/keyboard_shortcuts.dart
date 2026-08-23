import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Intents for desktop keyboard shortcuts.
class NavigateHomeIntent extends Intent {
  const NavigateHomeIntent();
}

class NavigatePlayerIntent extends Intent {
  const NavigatePlayerIntent();
}

class TogglePlayPauseIntent extends Intent {
  const TogglePlayPauseIntent();
}

class UndoIntent extends Intent {
  const UndoIntent();
}

class RedoIntent extends Intent {
  const RedoIntent();
}

class EscapeIntent extends Intent {
  const EscapeIntent();
}

/// Wraps a subtree with desktop-wide keyboard shortcuts.
///
/// Shortcuts:
/// - Ctrl+H → home
/// - Ctrl+P → player
/// - Space (when player focused / no text field) → play/pause
/// - Ctrl+Z → undo (reader/frame)
/// - Ctrl+Shift+Z / Ctrl+Y → redo
/// - Esc → unwind (close sheet / exit mode / pop)
///
/// Uses [Shortcuts] + [Actions] + [Focus] traversal so that text fields
/// retain normal editing (undo via framework) unless explicitly handled.
class DesktopShortcuts extends StatelessWidget {
  final VoidCallback? onNavigateHome;
  final VoidCallback? onNavigatePlayer;
  final VoidCallback? onTogglePlayPause;
  final VoidCallback? onUndo;
  final VoidCallback? onRedo;
  final VoidCallback? onEscape;
  final Widget child;
  final FocusNode? focusNode;
  final bool autofocus;

  const DesktopShortcuts({
    super.key,
    this.onNavigateHome,
    this.onNavigatePlayer,
    this.onTogglePlayPause,
    this.onUndo,
    this.onRedo,
    this.onEscape,
    required this.child,
    this.focusNode,
    this.autofocus = true,
  });

  @override
  Widget build(BuildContext context) {
    return Shortcuts(
      shortcuts: <ShortcutActivator, Intent>{
        const SingleActivator(LogicalKeyboardKey.keyH, control: true):
            const NavigateHomeIntent(),
        const SingleActivator(LogicalKeyboardKey.keyP, control: true):
            const NavigatePlayerIntent(),
        const SingleActivator(LogicalKeyboardKey.space):
            const TogglePlayPauseIntent(),
        const SingleActivator(LogicalKeyboardKey.keyZ, control: true):
            const UndoIntent(),
        const SingleActivator(LogicalKeyboardKey.keyZ, control: true, shift: true):
            const RedoIntent(),
        const SingleActivator(LogicalKeyboardKey.keyY, control: true):
            const RedoIntent(),
        const SingleActivator(LogicalKeyboardKey.escape):
            const EscapeIntent(),
      },
      child: Actions(
        actions: <Type, Action<Intent>>{
          NavigateHomeIntent: CallbackAction<NavigateHomeIntent>(
            onInvoke: (_) {
              onNavigateHome?.call();
              return null;
            },
          ),
          NavigatePlayerIntent: CallbackAction<NavigatePlayerIntent>(
            onInvoke: (_) {
              onNavigatePlayer?.call();
              return null;
            },
          ),
          TogglePlayPauseIntent: CallbackAction<TogglePlayPauseIntent>(
            onInvoke: (_) {
              // Avoid stealing Space from text fields.
              final focused = FocusManager.instance.primaryFocus;
              final ctx = focused?.context;
              if (ctx != null) {
                final w = focused?.context?.widget;
                if (w is EditableText ||
                    w is TextField ||
                    w is TextFormField) {
                  return null;
                }
                if (ctx.findAncestorWidgetOfExactType<EditableText>() != null) {
                  return null;
                }
                final el = ctx as Element;
                try {
                  var found = false;
                  el.visitAncestorElements((ancestor) {
                    if (ancestor.widget is EditableText) {
                      found = true;
                      return false;
                    }
                    return true;
                  });
                  if (found) return null;
                } catch (_) {}
              }
              onTogglePlayPause?.call();
              return null;
            },
          ),
          UndoIntent: CallbackAction<UndoIntent>(
            onInvoke: (_) {
              onUndo?.call();
              return null;
            },
          ),
          RedoIntent: CallbackAction<RedoIntent>(
            onInvoke: (_) {
              onRedo?.call();
              return null;
            },
          ),
          EscapeIntent: CallbackAction<EscapeIntent>(
            onInvoke: (_) {
              onEscape?.call();
              return null;
            },
          ),
        },
        child: Focus(
          focusNode: focusNode,
          autofocus: autofocus,
          canRequestFocus: true,
          skipTraversal: false,
          includeSemantics: true,
          child: child,
        ),
      ),
    );
  }
}

/// A focus-traversal wrapper that ensures Tab / Shift+Tab cycle through
/// desktop chrome (sidebar, content, actions) in a sensible order.
class DesktopFocusTraversal extends StatelessWidget {
  final Widget child;

  const DesktopFocusTraversal({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return FocusTraversalGroup(
      policy: OrderedTraversalPolicy(),
      child: child,
    );
  }
}
