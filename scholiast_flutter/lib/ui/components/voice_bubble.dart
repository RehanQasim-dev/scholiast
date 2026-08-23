import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/audio/audio_models.dart';
import '../../core/theme/app_colors.dart';

/// Lifecycle phase of the voice recording bubble.
enum VoiceBubbleState {
  recording,
  transcribing,
  error,
  idle,
}

/// Formats millisecond or [Duration] elapsed time into `M:SS` or `MM:SS`.
String formatVoiceDuration(Duration duration) {
  final minutes = duration.inMinutes;
  final seconds = duration.inSeconds % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}

/// Floating glassmorphic voice note recording bubble with live waveform visualizer,
/// duration counter, transcribing indicator, and stop/cancel actions.
class VoiceBubble extends StatefulWidget {
  final VoiceBubbleState state;
  final Duration duration;
  final Stream<Duration>? durationStream;
  final Stream<AudioAmplitude>? amplitudeStream;
  final String? errorMessage;
  final VoidCallback? onStop;
  final VoidCallback? onCancel;
  final VoidCallback? onRetry;
  final int waveformBarCount;

  const VoiceBubble({
    super.key,
    this.state = VoiceBubbleState.recording,
    this.duration = Duration.zero,
    this.durationStream,
    this.amplitudeStream,
    this.errorMessage,
    this.onStop,
    this.onCancel,
    this.onRetry,
    this.waveformBarCount = 18,
  });

  @override
  State<VoiceBubble> createState() => _VoiceBubbleState();
}

class _VoiceBubbleState extends State<VoiceBubble> with SingleTickerProviderStateMixin {
  StreamSubscription<AudioAmplitude>? _amplitudeSub;
  StreamSubscription<Duration>? _durationSub;
  late Duration _currentDuration;
  final List<double> _amplitudeHistory = [];
  late AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _currentDuration = widget.duration;
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);

    _initWaveform();
    _subscribeStreams();
  }

  void _initWaveform() {
    _amplitudeHistory.clear();
    for (int i = 0; i < widget.waveformBarCount; i++) {
      _amplitudeHistory.add(0.1);
    }
  }

  void _subscribeStreams() {
    _amplitudeSub?.cancel();
    if (widget.amplitudeStream != null) {
      _amplitudeSub = widget.amplitudeStream!.listen((amp) {
        if (!mounted) return;
        setState(() {
          _amplitudeHistory.removeAt(0);
          _amplitudeHistory.add(amp.normalized.clamp(0.08, 1.0));
        });
      });
    }

    _durationSub?.cancel();
    if (widget.durationStream != null) {
      _durationSub = widget.durationStream!.listen((d) {
        if (!mounted) return;
        setState(() {
          _currentDuration = d;
        });
      });
    }
  }

  @override
  void didUpdateWidget(covariant VoiceBubble oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.duration != oldWidget.duration && widget.durationStream == null) {
      _currentDuration = widget.duration;
    }
    if (widget.amplitudeStream != oldWidget.amplitudeStream ||
        widget.durationStream != oldWidget.durationStream) {
      _subscribeStreams();
    }
  }

  @override
  void dispose() {
    _amplitudeSub?.cancel();
    _durationSub?.cancel();
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOutCubic,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: widget.state == VoiceBubbleState.error
              ? AppColors.danger.withValues(alpha: 0.6)
              : AppColors.hairline,
          width: 1,
        ),
        boxShadow: const [
          BoxShadow(
            color: Colors.black45,
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: switch (widget.state) {
        VoiceBubbleState.recording => _buildRecordingContent(),
        VoiceBubbleState.transcribing => _buildTranscribingContent(),
        VoiceBubbleState.error => _buildErrorContent(),
        VoiceBubbleState.idle => const SizedBox.shrink(),
      },
    );
  }

  Widget _buildRecordingContent() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Pulsing recording indicator dot
        AnimatedBuilder(
          animation: _pulseController,
          builder: (context, _) {
            final scale = 1.0 + (_pulseController.value * 0.3);
            final alpha = 0.4 + (_pulseController.value * 0.6);
            return Stack(
              alignment: Alignment.center,
              children: [
                Transform.scale(
                  scale: scale,
                  child: Container(
                    width: 14,
                    height: 14,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.danger.withValues(alpha: 0.25 * alpha),
                    ),
                  ),
                ),
                Container(
                  width: 8,
                  height: 8,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    color: AppColors.danger,
                  ),
                ),
              ],
            );
          },
        ),
        const SizedBox(width: 8),
        // Live duration counter
        Text(
          formatVoiceDuration(_currentDuration),
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            fontFeatures: [FontFeature.tabularFigures()],
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(width: 12),
        // Waveform bars
        SizedBox(
          width: widget.waveformBarCount * 4.0,
          height: 22,
          child: CustomPaint(
            painter: _WaveformPainter(
              amplitudes: _amplitudeHistory,
              color: AppColors.accentPurple,
            ),
          ),
        ),
        const SizedBox(width: 12),
        // Cancel / Discard button
        if (widget.onCancel != null)
          IconButton(
            icon: const Icon(Icons.close, size: 16),
            tooltip: 'Cancel recording',
            color: AppColors.textSecondary,
            padding: const EdgeInsets.all(4),
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
            onPressed: widget.onCancel,
          ),
        // Stop / Transcribe button
        if (widget.onStop != null) ...[
          const SizedBox(width: 4),
          Material(
            color: AppColors.accentPurple,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              onTap: widget.onStop,
              borderRadius: BorderRadius.circular(16),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                child: const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.stop,
                      size: 14,
                      color: AppColors.onAccent,
                    ),
                    SizedBox(width: 4),
                    Text(
                      'Done',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.onAccent,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildTranscribingContent() {
    return const Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        SizedBox(
          width: 14,
          height: 14,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            color: AppColors.accentPurple,
          ),
        ),
        SizedBox(width: 10),
        Text(
          'Transcribing…',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }

  Widget _buildErrorContent() {
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const Icon(Icons.error_outline, size: 16, color: AppColors.danger),
        const SizedBox(width: 8),
        Flexible(
          child: Text(
            widget.errorMessage ?? 'Recording failed',
            style: const TextStyle(
              fontSize: 12,
              color: AppColors.danger,
              fontWeight: FontWeight.w500,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        const SizedBox(width: 8),
        if (widget.onRetry != null)
          TextButton(
            onPressed: widget.onRetry,
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: const Text('Retry', style: TextStyle(fontSize: 12, color: AppColors.accentPurple)),
          ),
        if (widget.onCancel != null)
          IconButton(
            icon: const Icon(Icons.close, size: 14),
            tooltip: 'Discard',
            color: AppColors.textSecondary,
            padding: const EdgeInsets.all(4),
            constraints: const BoxConstraints(minWidth: 24, minHeight: 24),
            onPressed: widget.onCancel,
          ),
      ],
    );
  }
}

class _WaveformPainter extends CustomPainter {
  final List<double> amplitudes;
  final Color color;

  _WaveformPainter({
    required this.amplitudes,
    required this.color,
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (amplitudes.isEmpty) return;

    final barWidth = 2.0;
    final spacing = (size.width - (amplitudes.length * barWidth)) / (amplitudes.length - 1).clamp(1, 100);
    final paint = Paint()
      ..color = color
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.fill;

    for (int i = 0; i < amplitudes.length; i++) {
      final x = i * (barWidth + spacing);
      final heightFactor = amplitudes[i].clamp(0.08, 1.0);
      final barHeight = (size.height * heightFactor).clamp(3.0, size.height);
      final y = (size.height - barHeight) / 2;

      final rrect = RRect.fromRectAndRadius(
        Rect.fromLTWH(x, y, barWidth, barHeight),
        const Radius.circular(1),
      );
      canvas.drawRRect(rrect, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _WaveformPainter oldDelegate) {
    return oldDelegate.amplitudes != amplitudes || oldDelegate.color != color;
  }
}
