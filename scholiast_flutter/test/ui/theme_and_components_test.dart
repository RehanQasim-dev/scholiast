import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:scholiast_flutter/core/audio/audio_models.dart';
import 'package:scholiast_flutter/core/sync/sync_models.dart';
import 'package:scholiast_flutter/core/theme/app_colors.dart';
import 'package:scholiast_flutter/core/theme/scholiast_theme.dart';
import 'package:scholiast_flutter/ui/components/color_swatch_row.dart';
import 'package:scholiast_flutter/ui/components/comment_editor_field.dart';
import 'package:scholiast_flutter/ui/components/sync_status_bar.dart';
import 'package:scholiast_flutter/ui/components/voice_bubble.dart';

void main() {
  group('Theme Tokens & AppColors Tests', () {
    test('AppColors matches required color values', () {
      expect(AppColors.background, const Color(0xFF0B0D14));
      expect(AppColors.surfaceElevated, const Color(0xFF151822));
      expect(AppColors.surfaceContainer, const Color(0xFF1C2030));
      expect(AppColors.surfaceContainerHighest, const Color(0xFF252B3D));
      expect(AppColors.hairline, const Color(0xFF232733));

      expect(AppColors.accentPurple, const Color(0xFF8B7CF6));
      expect(AppColors.accentPurpleHover, const Color(0xFF7C3AED));

      expect(AppColors.highlightYellow, const Color(0xFFFEF08A));
      expect(AppColors.highlightYellowBorder, const Color(0xFFEAB308));

      expect(AppColors.highlightGreen, const Color(0xFFBBF7D0));
      expect(AppColors.highlightGreenBorder, const Color(0xFF22C55E));

      expect(AppColors.highlightRed, const Color(0xFFFECACA));
      expect(AppColors.highlightRedBorder, const Color(0xFFEF4444));
    });

    test('AppColors.getHighlightColor maps names correctly', () {
      expect(AppColors.getHighlightColor('yellow'), AppColors.highlightYellow);
      expect(AppColors.getHighlightColor('YELLOW'), AppColors.highlightYellow);
      expect(AppColors.getHighlightColor('green'), AppColors.highlightGreen);
      expect(AppColors.getHighlightColor('red'), AppColors.highlightRed);
      expect(AppColors.getHighlightColor(null), AppColors.highlightYellow);
      expect(AppColors.getHighlightColor('unknown'), AppColors.highlightYellow);

      expect(AppColors.getHighlightBorderColor('yellow'), AppColors.highlightYellowBorder);
      expect(AppColors.getHighlightBorderColor('green'), AppColors.highlightGreenBorder);
      expect(AppColors.getHighlightBorderColor('red'), AppColors.highlightRedBorder);

      expect(AppColors.getHighlightTintColor('yellow'), AppColors.highlightYellowTint);
      expect(AppColors.getHighlightTintColor('green'), AppColors.highlightGreenTint);
      expect(AppColors.getHighlightTintColor('red'), AppColors.highlightRedTint);
    });

    test('ScholiastTheme.darkTheme configures dark Material 3 properly', () {
      final theme = ScholiastTheme.darkTheme;
      expect(theme.useMaterial3, isTrue);
      expect(theme.brightness, Brightness.dark);
      expect(theme.scaffoldBackgroundColor, AppColors.background);
      expect(theme.colorScheme.primary, AppColors.accentPurple);
      expect(theme.colorScheme.surface, AppColors.surfaceElevated);
      expect(theme.colorScheme.error, AppColors.danger);

      final extension = theme.extension<ScholiastCustomColors>();
      expect(extension, isNotNull);
      expect(extension!.background, AppColors.background);
      expect(extension.surfaceElevated, AppColors.surfaceElevated);
      expect(extension.accentPurple, AppColors.accentPurple);
      expect(extension.highlightYellow, AppColors.highlightYellow);
      expect(extension.highlightGreen, AppColors.highlightGreen);
      expect(extension.highlightRed, AppColors.highlightRed);
    });

    testWidgets('ScholiastThemeContextExtensions provides tokens in widget tree', (tester) async {
      late BuildContext capturedContext;

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Builder(
            builder: (context) {
              capturedContext = context;
              return const SizedBox.shrink();
            },
          ),
        ),
      );

      expect(capturedContext.scholiastColors.surfaceContainer, AppColors.surfaceContainer);
      expect(capturedContext.colorScheme.primary, AppColors.accentPurple);
      expect(capturedContext.textTheme.bodyLarge?.color, AppColors.textPrimary);
    });
  });

  group('SyncStatusBar & SyncStatusPill Tests', () {
    test('formatSyncRelativeTime formats intervals correctly', () {
      final now = DateTime.now().millisecondsSinceEpoch;
      expect(formatSyncRelativeTime(null), 'never');
      expect(formatSyncRelativeTime(0), 'never');
      expect(formatSyncRelativeTime(now - 10 * 1000), 'just now');
      expect(formatSyncRelativeTime(now - 5 * 60 * 1000), '5 min ago');
      expect(formatSyncRelativeTime(now - 3 * 3600 * 1000), '3 h ago');
      expect(formatSyncRelativeTime(now - 2 * 86400 * 1000), '2 d ago');
    });

    testWidgets('renders unauthenticated state and handles onConnect', (tester) async {
      bool connectCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: SyncStatusPill(
              status: SyncStatus.unauthenticated(),
              onConnect: () => connectCalled = true,
            ),
          ),
        ),
      );

      expect(find.text('Not connected'), findsOneWidget);
      expect(find.text('Connect'), findsOneWidget);

      await tester.tap(find.text('Connect'));
      await tester.pump();
      expect(connectCalled, isTrue);
    });

    testWidgets('renders syncing state with spinner and progress', (tester) async {
      final status = SyncStatus.syncing(
        progress: const SyncProgress(
          phase: 'page',
          done: 2,
          total: 10,
          title: 'Architecture Spec',
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: SyncStatusPill(status: status),
          ),
        ),
      );

      expect(find.text('Syncing… 3/10'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('renders error state and handles onRetry', (tester) async {
      bool retryCalled = false;
      final status = SyncStatus.error(error: 'Network unreachable');

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: SyncStatusPill(
              status: status,
              onRetry: () => retryCalled = true,
            ),
          ),
        ),
      );

      expect(find.text('Sync failed'), findsOneWidget);
      expect(find.byIcon(Icons.refresh), findsOneWidget);

      await tester.tap(find.byType(InkWell));
      await tester.pump();
      expect(retryCalled, isTrue);
    });

    testWidgets('renders idle state and handles onSyncNow', (tester) async {
      bool syncNowCalled = false;
      final now = DateTime.now().millisecondsSinceEpoch;
      final status = SyncStatus.idle(connected: true, lastSyncedAt: now);

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: SyncStatusBar(
              status: status,
              onSyncNow: () => syncNowCalled = true,
            ),
          ),
        ),
      );

      expect(find.text('Synced just now'), findsOneWidget);
      await tester.tap(find.byType(InkWell));
      await tester.pump();
      expect(syncNowCalled, isTrue);
    });

    testWidgets('SyncStatusCard renders progress and handles retry', (tester) async {
      bool retryCalled = false;
      final errorStatus = SyncStatus.error(error: 'CAS mismatch');

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: SyncStatusCard(
              status: errorStatus,
              onRetry: () => retryCalled = true,
            ),
          ),
        ),
      );

      expect(find.text('CAS mismatch'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await tester.pump();
      expect(retryCalled, isTrue);
    });
  });

  group('CommentEditorField Tests', () {
    testWidgets('renders text and placeholder', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: const Scaffold(
            body: CommentEditorField(
              placeholder: 'Type comment here…',
              initialText: 'Hello world',
            ),
          ),
        ),
      );

      expect(find.text('Hello world'), findsOneWidget);
    });

    testWidgets('submits comment on send button click', (tester) async {
      String? submittedText;
      final controller = TextEditingController(text: 'Initial text');

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: CommentEditorField(
              controller: controller,
              onSubmitted: (text) => submittedText = text,
            ),
          ),
        ),
      );

      await tester.tap(find.byIcon(Icons.arrow_upward));
      await tester.pump();
      expect(submittedText, 'Initial text');
    });

    testWidgets('handles cancel button click', (tester) async {
      bool cancelCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: CommentEditorField(
              onCancel: () => cancelCalled = true,
            ),
          ),
        ),
      );

      await tester.tap(find.byIcon(Icons.close));
      await tester.pump();
      expect(cancelCalled, isTrue);
    });

    testWidgets('handles voice note mic button click', (tester) async {
      bool micCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: CommentEditorField(
              onVoiceRecordPressed: () => micCalled = true,
            ),
          ),
        ),
      );

      await tester.tap(find.byIcon(Icons.mic_none));
      await tester.pump();
      expect(micCalled, isTrue);
    });

    testWidgets('formatting buttons apply markdown formatting', (tester) async {
      final controller = TextEditingController(text: 'sample text');

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: CommentEditorField(
              controller: controller,
            ),
          ),
        ),
      );

      // Select 'sample'
      controller.selection = const TextSelection(baseOffset: 0, extentOffset: 6);

      // Click Bold
      await tester.tap(find.byIcon(Icons.format_bold));
      await tester.pump();
      expect(controller.text, '**sample** text');

      // Click Italic on 'text'
      controller.selection = const TextSelection(baseOffset: 11, extentOffset: 15);
      await tester.tap(find.byIcon(Icons.format_italic));
      await tester.pump();
      expect(controller.text, '**sample** *text*');

      // Click Bullet list
      controller.selection = const TextSelection.collapsed(offset: 0);
      await tester.tap(find.byIcon(Icons.format_list_bulleted));
      await tester.pump();
      expect(controller.text, '- **sample** *text*');

      // Click Checklist
      controller.selection = const TextSelection.collapsed(offset: 0);
      await tester.tap(find.byIcon(Icons.check_box_outlined));
      await tester.pump();
      expect(controller.text, '- [ ] - **sample** *text*');
    });
  });

  group('VoiceBubble Tests', () {
    test('formatVoiceDuration formats duration', () {
      expect(formatVoiceDuration(Duration.zero), '0:00');
      expect(formatVoiceDuration(const Duration(seconds: 15)), '0:15');
      expect(formatVoiceDuration(const Duration(minutes: 2, seconds: 5)), '2:05');
      expect(formatVoiceDuration(const Duration(minutes: 12, seconds: 45)), '12:45');
    });

    testWidgets('renders recording state and triggers onStop / onCancel', (tester) async {
      bool stopCalled = false;
      bool cancelCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: VoiceBubble(
              state: VoiceBubbleState.recording,
              duration: const Duration(seconds: 15),
              onStop: () => stopCalled = true,
              onCancel: () => cancelCalled = true,
            ),
          ),
        ),
      );

      expect(find.text('0:15'), findsOneWidget);
      expect(find.text('Done'), findsOneWidget);

      await tester.tap(find.text('Done'));
      await tester.pump();
      expect(stopCalled, isTrue);

      await tester.tap(find.byIcon(Icons.close));
      await tester.pump();
      expect(cancelCalled, isTrue);
    });

    testWidgets('renders transcribing state', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: const Scaffold(
            body: VoiceBubble(
              state: VoiceBubbleState.transcribing,
            ),
          ),
        ),
      );

      expect(find.text('Transcribing…'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('renders error state and handles onRetry', (tester) async {
      bool retryCalled = false;

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: VoiceBubble(
              state: VoiceBubbleState.error,
              errorMessage: 'Microphone permission denied',
              onRetry: () => retryCalled = true,
            ),
          ),
        ),
      );

      expect(find.text('Microphone permission denied'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);

      await tester.tap(find.text('Retry'));
      await tester.pump();
      expect(retryCalled, isTrue);
    });

    testWidgets('updates waveform on amplitudeStream events', (tester) async {
      final controller = StreamController<AudioAmplitude>();

      await tester.pumpWidget(
        MaterialApp(
          theme: ScholiastTheme.darkTheme,
          home: Scaffold(
            body: VoiceBubble(
              state: VoiceBubbleState.recording,
              amplitudeStream: controller.stream,
            ),
          ),
        ),
      );

      controller.add(const AudioAmplitude(current: -20, max: 0, normalized: 0.75));
      await tester.pump();

      expect(find.byType(CustomPaint), findsWidgets);
      await controller.close();
    });
  });

  group('ColorSwatchRow Tests', () {
    testWidgets('renders 3 color swatches and responds to selection', (tester) async {
      String selected = 'yellow';

      await tester.pumpWidget(
        StatefulBuilder(
          builder: (context, setState) {
            return MaterialApp(
              theme: ScholiastTheme.darkTheme,
              home: Scaffold(
                body: ColorSwatchRow(
                  selectedColor: selected,
                  onColorSelected: (color) {
                    setState(() {
                      selected = color;
                    });
                  },
                ),
              ),
            );
          },
        ),
      );

      expect(find.byType(GestureDetector), findsNWidgets(3));

      // Tap green swatch
      await tester.tap(find.bySemanticsLabel('green highlight color'));
      await tester.pump();
      expect(selected, 'green');

      // Tap red swatch
      await tester.tap(find.bySemanticsLabel('red highlight color'));
      await tester.pump();
      expect(selected, 'red');
    });
  });
}
