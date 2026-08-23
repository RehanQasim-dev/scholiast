import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../features/player/player_state_notifier.dart';
import 'player_web_controller.dart';

/// The player chrome overlay — transparent tap layer, centered play/pause,
/// bottom seek bar with current/total time and −15s/+15s, speed menu (0.5×–2×).
/// Mirrors `android/.../ui/player/PlayerChrome.kt` in layout and behavior.
///
/// Auto-hides after 4 s of playback; any interaction keeps it alive.
class PlayerChrome extends StatefulWidget {
  final PlayerState state;
  final PlayerWebController? controller;
  final VoidCallback? onBack;
  final VoidCallback? onToggleFullscreen;
  final VoidCallback? onOpenInYouTube;

  const PlayerChrome({
    super.key,
    required this.state,
    this.controller,
    this.onBack,
    this.onToggleFullscreen,
    this.onOpenInYouTube,
  });

  @override
  State<PlayerChrome> createState() => _PlayerChromeState();
}

class _PlayerChromeState extends State<PlayerChrome> {
  bool _visible = true;
  int _keepAlive = 0;
  Timer? _hideTimer;

  @override
  void didUpdateWidget(covariant PlayerChrome oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state.isPlaying != widget.state.isPlaying) {
      if (!widget.state.isPlaying) {
        setState(() => _visible = true);
        _cancelTimer();
      } else {
        _scheduleHide();
      }
    }
  }

  @override
  void dispose() {
    _cancelTimer();
    super.dispose();
  }

  void _bump() {
    setState(() {
      _visible = true;
      _keepAlive++;
    });
    _scheduleHide();
  }

  void _scheduleHide() {
    _cancelTimer();
    if (!widget.state.isPlaying) return;
    _hideTimer = Timer(const Duration(milliseconds: 4000), () {
      if (mounted && widget.state.isPlaying) {
        setState(() => _visible = false);
      }
    });
  }

  void _cancelTimer() {
    _hideTimer?.cancel();
    _hideTimer = null;
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        // Tap the video → toggle chrome.
        Positioned.fill(
          child: GestureDetector(
            onTap: () {
              setState(() => _visible = !_visible);
              if (_visible) {
                _bump();
              } else {
                _cancelTimer();
              }
            },
            behavior: HitTestBehavior.translucent,
            child: const SizedBox.expand(),
          ),
        ),

        if (!_isReady(widget.state) && !widget.state.isError)
          const Center(
            child: SizedBox(
              width: 40,
              height: 40,
              child: CircularProgressIndicator(),
            ),
          ),

        if (widget.state.isError)
          _EmbedBlockedOverlay(
            message: widget.state.errorMessage ?? 'Video can\'t be played',
            onOpenInYouTube: widget.onOpenInYouTube,
          ),

        if (_visible && _isReady(widget.state) && !widget.state.isError)
          _ChromeControls(
            state: widget.state,
            controller: widget.controller,
            onBack: widget.onBack,
            onToggleFullscreen: widget.onToggleFullscreen,
            onOpenInYouTube: widget.onOpenInYouTube,
            onInteraction: _bump,
            onDismiss: () => setState(() => _visible = false),
            keepAlive: _keepAlive,
          ),
      ],
    );
  }

  bool _isReady(PlayerState s) => s.duration != null && s.duration! > 0 || s.isPlaying || s.currentTime > 0;
}

/// Compact helper — player is ready once we have a duration or playback started.
extension on PlayerState {
  bool get isError => errorMessage != null && errorMessage!.isNotEmpty;
}

class _ChromeControls extends StatefulWidget {
  final PlayerState state;
  final PlayerWebController? controller;
  final VoidCallback? onBack;
  final VoidCallback? onToggleFullscreen;
  final VoidCallback? onOpenInYouTube;
  final VoidCallback onInteraction;
  final VoidCallback onDismiss;
  final int keepAlive;

  const _ChromeControls({
    required this.state,
    this.controller,
    this.onBack,
    this.onToggleFullscreen,
    this.onOpenInYouTube,
    required this.onInteraction,
    required this.onDismiss,
    required this.keepAlive,
  });

  @override
  State<_ChromeControls> createState() => _ChromeControlsState();
}

class _ChromeControlsState extends State<_ChromeControls> {
  double? _dragTime;

  @override
  Widget build(BuildContext context) {
    final state = widget.state;
    return GestureDetector(
      onTap: widget.onDismiss,
      behavior: HitTestBehavior.opaque,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Colors.black.withValues(alpha: 0.75),
              Colors.transparent,
              Colors.black.withValues(alpha: 0.75),
            ],
          ),
        ),
        child: Stack(
          children: [
            // Top bar: Back · Title
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 44,
                        height: 44,
                        child: IconButton(
                          onPressed: () {
                            widget.onBack?.call();
                            widget.onInteraction();
                          },
                          icon: const Icon(Icons.arrow_back, color: Colors.white),
                          tooltip: 'Back',
                        ),
                      ),
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 8),
                          child: Text(
                            state.title?.isNotEmpty == true ? state.title! : 'YouTube Video',
                            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w500,
                                ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Centered controls: −15s · Play/Pause · +15s
            Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _SkipButton(
                    label: '−15',
                    onTap: () {
                      widget.controller?.seekTo((state.currentTime - 15).clamp(0, double.infinity));
                      widget.onInteraction();
                    },
                  ),
                  const SizedBox(width: 24),
                  GestureDetector(
                    onTap: () {
                      if (state.isPlaying) {
                        widget.controller?.pause();
                      } else {
                        widget.controller?.play();
                      }
                      widget.onInteraction();
                    },
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.black.withValues(alpha: 0.65),
                      ),
                      alignment: Alignment.center,
                      child: Icon(
                        state.isPlaying ? Icons.pause : Icons.play_arrow,
                        color: Colors.white,
                        size: 44,
                      ),
                    ),
                  ),
                  const SizedBox(width: 24),
                  _SkipButton(
                    label: '+15',
                    onTap: () {
                      final target = state.currentTime + 15;
                      final clamped = state.duration != null ? target.clamp(0.0, state.duration!) : target;
                      widget.controller?.seekTo(clamped);
                      widget.onInteraction();
                    },
                  ),
                ],
              ),
            ),

            // Bottom bar: time · seek · duration · speed · fullscreen
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 56,
                        child: Text(
                          formatMss(_dragTime ?? state.currentTime),
                          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                color: Colors.white,
                                fontFeatures: const [FontFeature.tabularFigures()],
                              ),
                          textAlign: TextAlign.end,
                        ),
                      ),
                      Expanded(
                        child: SliderTheme(
                          data: SliderThemeData(
                            activeTrackColor: AppColors.accentPurple,
                            inactiveTrackColor: Colors.white.withValues(alpha: 0.24),
                            thumbColor: AppColors.accentPurple,
                            thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 8),
                            trackHeight: 4,
                            overlayShape: SliderComponentShape.noOverlay,
                          ),
                          child: Slider(
                            value: (_dragTime ?? state.currentTime)
                                .clamp(0.0, (state.duration ?? state.currentTime).clamp(1.0, double.infinity))
                                .toDouble(),
                            min: 0,
                            max: (state.duration ?? state.currentTime.clamp(1.0, double.infinity)).toDouble(),
                            onChanged: (v) {
                              setState(() => _dragTime = v);
                              widget.onInteraction();
                            },
                            onChangeEnd: (v) {
                              widget.controller?.seekTo(v);
                              setState(() => _dragTime = null);
                              widget.onInteraction();
                            },
                          ),
                        ),
                      ),
                      SizedBox(
                        width: 56,
                        child: Text(
                          formatMss(state.duration ?? 0),
                          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                color: Colors.white,
                                fontFeatures: const [FontFeature.tabularFigures()],
                              ),
                        ),
                      ),
                      _SpeedMenu(
                        current: 1.0,
                        onSelect: (rate) {
                          widget.controller?.setRate(rate);
                          widget.onInteraction();
                        },
                      ),
                      SizedBox(
                        width: 44,
                        height: 44,
                        child: IconButton(
                          onPressed: () {
                            widget.onToggleFullscreen?.call();
                            widget.onInteraction();
                          },
                          icon: Icon(
                            state.isPlaying ? Icons.fullscreen_exit : Icons.fullscreen,
                            color: Colors.white,
                          ),
                          tooltip: 'Fullscreen',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SkipButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;

  const _SkipButton({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 52,
        height: 52,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Colors.black.withValues(alpha: 0.5),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
            fontSize: 15,
          ),
        ),
      ),
    );
  }
}

class _SpeedMenu extends StatefulWidget {
  final double current;
  final ValueChanged<double> onSelect;

  const _SpeedMenu({required this.current, required this.onSelect});

  @override
  State<_SpeedMenu> createState() => _SpeedMenuState();
}

class _SpeedMenuState extends State<_SpeedMenu> {
  bool _expanded = false;

  static const _options = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        SizedBox(
          width: 48,
          height: 48,
          child: TextButton(
            onPressed: () => setState(() => _expanded = !_expanded),
            child: Text(
              _formatRate(widget.current),
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ),
        ),
        if (_expanded)
          Positioned(
            bottom: 52,
            right: 0,
            child: Material(
              color: AppColors.surfaceElevated,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: BorderSide(color: Colors.white.withValues(alpha: 0.10)),
              ),
              elevation: 8,
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  children: [
                    for (final chunk in _chunked(_options, 3))
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            for (final rate in chunk)
                              Padding(
                                padding: const EdgeInsets.only(right: 6),
                                child: _SpeedChip(
                                  rate: rate,
                                  selected: rate == widget.current,
                                  onTap: () {
                                    widget.onSelect(rate);
                                    setState(() => _expanded = false);
                                  },
                                ),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }

  String _formatRate(double r) =>
      r.toString().replaceAll(RegExp(r'\.?0+$'), '') + '×';
}

List<List<T>> _chunked<T>(List<T> list, int size) {
  final out = <List<T>>[];
  for (var i = 0; i < list.length; i += size) {
    out.add(list.sublist(i, (i + size).clamp(0, list.length)));
  }
  return out;
}

class _SpeedChip extends StatelessWidget {
  final double rate;
  final bool selected;
  final VoidCallback onTap;

  const _SpeedChip({required this.rate, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 64,
        height: 40,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(10),
          color: selected ? AppColors.accentPurple : Colors.white.withValues(alpha: 0.08),
        ),
        alignment: Alignment.center,
        child: Text(
          rate.toString().replaceAll(RegExp(r'\.?0+$'), '') + '×',
          style: TextStyle(
            fontWeight: selected ? FontWeight.bold : FontWeight.normal,
            color: selected ? AppColors.onAccent : Colors.white,
            fontSize: 13,
          ),
        ),
      ),
    );
  }
}

class _EmbedBlockedOverlay extends StatelessWidget {
  final String message;
  final VoidCallback? onOpenInYouTube;

  const _EmbedBlockedOverlay({required this.message, this.onOpenInYouTube});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black.withValues(alpha: 0.72),
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, color: AppColors.danger, size: 48),
          const SizedBox(height: 16),
          Text(
            message,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(color: Colors.white),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          Text(
            'Transcript annotation still works for this video.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 20),
          if (onOpenInYouTube != null)
            ElevatedButton.icon(
              onPressed: onOpenInYouTube,
              icon: const Icon(Icons.open_in_new),
              label: const Text('Open in YouTube'),
            ),
        ],
      ),
    );
  }
}

/// `M:SS`, or `H:MM:SS` past an hour. Tabular figures.
String formatMss(double seconds) {
  final total = seconds.toInt().clamp(0, 1 << 31);
  final h = total ~/ 3600;
  final m = (total % 3600) ~/ 60;
  final s = total % 60;
  if (h > 0) {
    return '$h:${m.toString().padLeft(2, '0')}:${s.toString().padLeft(2, '0')}';
  }
  return '$m:${s.toString().padLeft(2, '0')}';
}
