import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers/core_providers.dart';
import '../../../core/stt/stt_models.dart';
import '../../../core/stt/whisper_model_manager.dart';
import '../../../core/sync/sync_models.dart';
import '../../../core/theme/app_colors.dart';
import '../../components/sync_status_bar.dart';
import '../../../features/settings/settings_prefs.dart';
import '../../../features/sync/sync_providers.dart';

/// The Settings screen. Sections: Sync (Google Drive), Speech (transcriber +
/// local Whisper model manager) and a Danger zone for destructive wipes.
///
/// Layout is capped to max 600dp and centered for tablet readability.
class SettingsScreen extends ConsumerWidget {
  final VoidCallback? onBack;
  /// Injectable destructive callbacks for tests / host wiring.
  /// When null, buttons show a TODO snackbar (drive wipe handlers not yet implemented).
  final Future<void> Function()? onWipeLocalOverride;
  final Future<void> Function()? onWipeDriveOverride;

  const SettingsScreen({
    super.key,
    this.onBack,
    this.onWipeLocalOverride,
    this.onWipeDriveOverride,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        leading: onBack != null
            ? IconButton(
                onPressed: onBack,
                icon: const Icon(Icons.arrow_back),
              )
            : null,
        title: const Text('Settings'),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 600),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _SectionTitle('Sync'),
                const _SyncSection(),
                const SizedBox(height: 8),
                _SectionTitle('Speech'),
                const _SpeechSection(),
                const SizedBox(height: 8),
                _SectionTitle('Whisper models'),
                const _WhisperModelsSection(),
                const SizedBox(height: 8),
                _SectionTitle('Danger zone'),
              _DangerZoneSection(
                onWipeLocalOverride: onWipeLocalOverride,
                onWipeDriveOverride: onWipeDriveOverride,
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String text;

  const _SectionTitle(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 8),
      child: Text(text, style: Theme.of(context).textTheme.titleMedium),
    );
  }
}

// ---------------------------------------------------------------------------
// Sync — uses syncStatusStreamProvider + syncControllerProvider + SyncStatusBar
// ---------------------------------------------------------------------------

class _SyncSection extends ConsumerWidget {
  const _SyncSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusAsync = ref.watch(syncStatusStreamProvider);
    final status = statusAsync.value ??
        const SyncStatus(state: SyncState.unauthenticated);
    final connected = status.connected &&
        status.state != SyncState.unauthenticated;
    final syncing = status.syncing || status.state == SyncState.syncing;

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              connected
                  ? 'Connected to Google Drive'
                  : 'Not connected',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 8),
            // Required sync status bar (pill) consuming the status stream.
            SyncStatusBar(
              status: status,
              onConnect: () => _connectDrive(context, ref),
              onRetry: () => ref.read(syncControllerProvider.notifier).syncNow(),
              onSyncNow: () => ref.read(syncControllerProvider.notifier).syncNow(),
            ),
            const SizedBox(height: 12),
            SyncStatusCard(
              status: status,
              onRetry: () => ref.read(syncControllerProvider.notifier).syncNow(),
              onSyncNow: () => ref.read(syncControllerProvider.notifier).syncNow(),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                if (connected) ...[
                  OutlinedButton(
                    onPressed: syncing
                        ? null
                        : () async {
                            await ref.read(syncControllerProvider.notifier).disconnectDrive();
                          },
                    child: const Text('Disconnect'),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: syncing ? null : () => ref.read(syncControllerProvider.notifier).syncNow(),
                    child: const Text('Sync now'),
                  ),
                ] else
                  ElevatedButton(
                    onPressed: () => _connectDrive(context, ref),
                    child: const Text('Connect Google Drive'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _connectDrive(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await ref.read(syncControllerProvider.notifier).connectDrive();
    messenger.showSnackBar(
      SnackBar(
        content:
            Text(ok ? 'Google Drive connected' : 'Connection failed'),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Speech — STT engine picker, speech language + preferred transcriber dropdowns
// ---------------------------------------------------------------------------

class _SpeechSection extends ConsumerWidget {
  const _SpeechSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefsAsync = ref.watch(settingsPrefsProvider);

    return prefsAsync.maybeWhen(
      data: (prefs) => Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'STT engine',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              DropdownMenu<SttProvider>(
                width: 320,
                initialSelection: prefs.preferredTranscriber,
                label: const Text('Preferred transcriber'),
                dropdownMenuEntries: [
                  for (final p in SttProvider.values)
                    DropdownMenuEntry(value: p, label: p.shortLabel),
                ],
                onSelected: (provider) {
                  if (provider == null) return;
                  ref.read(settingsPrefsProvider.future).then(
                    (pp) => pp.setPreferredTranscriber(provider),
                  ).whenComplete(() => ref.invalidate(settingsPrefsProvider));
                },
              ),
              const SizedBox(height: 12),
              Text(
                'Preferred transcriber',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              DropdownMenu<SttProvider>(
                width: 320,
                initialSelection: prefs.preferredTranscriber,
                dropdownMenuEntries: [
                  for (final p in SttProvider.values)
                    DropdownMenuEntry(value: p, label: p.displayName),
                ],
                onSelected: (provider) {
                  if (provider == null) return;
                  ref.read(settingsPrefsProvider.future).then(
                    (pp) => pp.setPreferredTranscriber(provider),
                  ).whenComplete(() => ref.invalidate(settingsPrefsProvider));
                },
              ),
              const SizedBox(height: 16),
              Text(
                'Speech language',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              const SizedBox(height: 8),
              DropdownMenu<String?>(
                width: 320,
                initialSelection: prefs.speechLanguage,
                label: const Text('Language'),
                dropdownMenuEntries: [
                  for (final lang in speechLanguages)
                    DropdownMenuEntry(
                      value: lang,
                      label: speechLanguageLabel(lang),
                    ),
                ],
                onSelected: (lang) {
                  ref.read(settingsPrefsProvider.future).then(
                    (pp) => pp.setSpeechLanguage(lang),
                  ).whenComplete(() => ref.invalidate(settingsPrefsProvider));
                },
              ),
            ],
          ),
        ),
      ),
      orElse: () => const Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: EdgeInsets.all(16),
          child: Center(child: CircularProgressIndicator()),
        ),
      ),
    );
  }
}

extension on SttProvider {
  String get shortLabel => switch (this) {
        SttProvider.localWhisper => 'Local',
        SttProvider.groq => 'Groq',
        SttProvider.openAi => 'OpenAI',
        SttProvider.gemini => 'Gemini',
      };
}

class _WhisperModelsSection extends ConsumerStatefulWidget {
  const _WhisperModelsSection();

  @override
  ConsumerState<_WhisperModelsSection> createState() =>
      _WhisperModelsSectionState();
}

class _WhisperModelsSectionState extends ConsumerState<_WhisperModelsSection> {
  List<WhisperModelInfo>? _models;
  final Map<String, double> _progress = {};
  final Set<String> _downloading = {};

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _reload() async {
    final models =
        await ref.read(whisperModelManagerProvider).getAvailableModels();
    if (mounted) setState(() => _models = models);
  }

  @override
  Widget build(BuildContext context) {
    final prefs = ref.watch(settingsPrefsProvider).value;
    final activeModelId = prefs?.activeWhisperModelId;
    final manager = ref.read(whisperModelManagerProvider);

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Active model',
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                      Text(
                        activeModelId == null || activeModelId.isEmpty
                            ? 'Tiny English (built-in default)'
                            : activeModelId,
                        style: Theme.of(context)
                            .textTheme
                            .bodyLarge
                            ?.copyWith(color: AppColors.accentPurpleLight),
                      ),
                    ],
                  ),
                ),
                if (activeModelId != null && activeModelId.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.accentPurpleWeak,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: const Text(
                      'ACTIVE',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: AppColors.accentPurple,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            if (_models == null)
              const Center(child: CircularProgressIndicator())
            else
              for (final model in _models!)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(
                    children: [
                      Row(
                        children: [
                          Icon(
                            model.isDownloaded
                                ? Icons.check_circle
                                : Icons.download_outlined,
                            size: 18,
                            color: model.isDownloaded
                                ? AppColors.success
                                : AppColors.textTertiary,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(model.name,
                                    style:
                                        Theme.of(context).textTheme.bodyMedium),
                                Text(
                                  '${_sizeLabel(model.sizeBytes)} · ${model.fileName}',
                                  style: Theme.of(context).textTheme.labelSmall,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          if (_downloading.contains(model.id))
                            const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          else if (!model.isDownloaded)
                            TextButton(
                              onPressed: () => _download(manager, model),
                              child: const Text('Download'),
                            )
                          else if (model.id != activeModelId)
                            TextButton(
                              onPressed: () async {
                                await prefs?.setActiveWhisperModelId(model.id);
                                ref.invalidate(settingsPrefsProvider);
                              },
                              child: const Text('Use'),
                            ),
                          if (model.isDownloaded && model.id != activeModelId)
                            IconButton(
                              tooltip: 'Delete model',
                              onPressed: () => _delete(manager, model),
                              icon: const Icon(Icons.delete_outline,
                                  size: 18, color: AppColors.danger),
                            ),
                        ],
                      ),
                      if (_downloading.contains(model.id) &&
                          _progress.containsKey(model.id))
                        Padding(
                          padding: const EdgeInsets.only(top: 4, left: 26, right: 8),
                          child: LinearProgressIndicator(
                            value: _progress[model.id]!.clamp(0.0, 1.0),
                            backgroundColor: AppColors.surfaceContainer,
                            color: AppColors.accentPurple,
                          ),
                        ),
                    ],
                  ),
                ),
          ],
        ),
      ),
    );
  }

  Future<void> _download(
    WhisperModelManager manager,
    WhisperModelInfo model,
  ) async {
    setState(() {
      _downloading.add(model.id);
      _progress[model.id] = 0.0;
    });
    try {
      // Use streaming variant for progress when available.
      final stream = manager.downloadModelStream(model.id);
      await for (final p in stream) {
        if (mounted) setState(() => _progress[model.id] = p);
      }
      await ref.read(settingsPrefsProvider.future).then(
            (p) => p.setActiveWhisperModelId(model.id),
          );
      ref.invalidate(settingsPrefsProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Download failed: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _downloading.remove(model.id);
          _progress.remove(model.id);
        });
      }
      await _reload();
    }
  }

  Future<void> _delete(
    WhisperModelManager manager,
    WhisperModelInfo model,
  ) async {
    await manager.deleteModel(model.id);
    final prefs = ref.read(settingsPrefsProvider).value;
    if (prefs?.activeWhisperModelId == model.id) {
      await prefs?.setActiveWhisperModelId(null);
      ref.invalidate(settingsPrefsProvider);
    }
    await _reload();
  }

  String _sizeLabel(int bytes) {
    final mb = bytes / (1024 * 1024);
    if (mb >= 1024) return '${(mb / 1024).toStringAsFixed(1)} GB';
    return '${mb.round()} MB';
  }
}

// ---------------------------------------------------------------------------
// Danger zone — destructive red styling with injectable TODO callbacks
// ---------------------------------------------------------------------------

class _DangerZoneSection extends ConsumerWidget {
  final Future<void> Function()? onWipeLocalOverride;
  final Future<void> Function()? onWipeDriveOverride;

  const _DangerZoneSection({
    this.onWipeLocalOverride,
    this.onWipeDriveOverride,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Card(
      margin: EdgeInsets.zero,
      color: AppColors.surfaceElevated,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: AppColors.danger.withValues(alpha: 0.4)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.warning_amber_rounded,
                    size: 16, color: AppColors.danger),
                const SizedBox(width: 6),
                Text(
                  'Danger zone',
                  style: Theme.of(context)
                      .textTheme
                      .titleSmall
                      ?.copyWith(color: AppColors.danger),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Destructive actions are irreversible. Local wipes delete '
              'notes and frames on this device; the Drive wipe deletes every '
              'remote sync record.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.danger,
                side: BorderSide(color: AppColors.danger.withValues(alpha: 0.7)),
              ),
              onPressed: () => _confirmLocalWipe(context, ref),
              icon: const Icon(Icons.delete_outline, size: 18),
              label: const Text('Delete local data…'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.danger,
                side: BorderSide(color: AppColors.danger.withValues(alpha: 0.7)),
              ),
              onPressed: () => _confirmDriveWipe(context, ref),
              icon: const Icon(Icons.delete_outline, size: 18),
              label: const Text('Delete all data on Google Drive…'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmLocalWipe(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete local data?'),
        content: const Text(
          'This permanently deletes all pages, annotations, video items and '
          'frame images stored on this device. Your settings and the Drive '
          'connection are kept.',
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
    if (confirmed != true) return;

    if (onWipeLocalOverride != null) {
      await onWipeLocalOverride!.call();
      return;
    }
    await ref.read(videoPageDaoProvider).deleteAllPages();
    await ref.read(frameStoreProvider).clearAll();
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Local data deleted')),
      );
    }
  }

  Future<void> _confirmDriveWipe(BuildContext context, WidgetRef ref) async {
    var confirmText = '';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete all data on Google Drive?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'This permanently deletes every synced page record, frame image '
              'and diagram blob from the app\'s Drive appdata folder. Local '
              'annotations are untouched.',
            ),
            const SizedBox(height: 12),
            TextField(
              autofocus: true,
              onChanged: (value) => confirmText = value.trim(),
              decoration: const InputDecoration(
                labelText: 'Type DELETE to confirm',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          StatefulBuilder(
            builder: (context, setState) => TextButton(
              style: TextButton.styleFrom(foregroundColor: AppColors.danger),
              onPressed:
                  confirmText == 'DELETE' ? () => Navigator.pop(context, true) : null,
              child: const Text('Delete'),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true) return;

    if (onWipeDriveOverride != null) {
      await onWipeDriveOverride!.call();
      return;
    }
    // TODO: Drive wipe handler not yet implemented for full sync-engine path.
    // Current path delegates to GoogleDriveClient.wipeAppData when available.
    try {
      final deleted =
          await ref.read(driveClientProvider).wipeAppData(interactive: true);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Deleted $deleted remote file(s)')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Drive wipe failed: $e')),
        );
      }
    }
  }
}
