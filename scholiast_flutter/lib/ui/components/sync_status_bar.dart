import 'package:flutter/material.dart';
import '../../core/sync/sync_models.dart';
import '../../core/theme/app_colors.dart';

/// Relative time formatter for sync timestamps.
String formatSyncRelativeTime(int? timestampMs) {
  if (timestampMs == null || timestampMs <= 0) return 'never';
  final now = DateTime.now().millisecondsSinceEpoch;
  final diffMs = (now - timestampMs).abs();
  final seconds = diffMs ~/ 1000;
  if (seconds < 60) return 'just now';
  final minutes = seconds ~/ 60;
  if (minutes < 60) return '$minutes min ago';
  final hours = minutes ~/ 60;
  if (hours < 24) return '$hours h ago';
  final days = hours ~/ 24;
  return '$days d ago';
}

/// Compact glassmorphic sync pill widget representing Google Drive sync state.
class SyncStatusPill extends StatelessWidget {
  final SyncStatus status;
  final VoidCallback? onConnect;
  final VoidCallback? onRetry;
  final VoidCallback? onSyncNow;
  final bool compact;

  const SyncStatusPill({
    super.key,
    required this.status,
    this.onConnect,
    this.onRetry,
    this.onSyncNow,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final isUnauthenticated = !status.connected || status.state == SyncState.unauthenticated;
    final isSyncing = status.syncing || status.state == SyncState.syncing;
    final isError = status.state == SyncState.error || (status.lastError != null && !isSyncing);

    final (label, dotColor) = _pillStateInfo(isUnauthenticated, isSyncing, isError);

    final VoidCallback? tapAction = switch ((isUnauthenticated, isSyncing, isError)) {
      (true, _, _) => onConnect,
      (_, _, true) => onRetry ?? onSyncNow,
      (_, false, false) => onSyncNow,
      _ => null,
    };

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: tapAction,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: EdgeInsets.symmetric(
            horizontal: compact ? 8 : 10,
            vertical: compact ? 4 : 5,
          ),
          decoration: BoxDecoration(
            color: AppColors.surfaceContainer.withValues(alpha: 0.85),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: isError ? AppColors.danger.withValues(alpha: 0.5) : AppColors.hairline,
              width: 1,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (isSyncing)
                const SizedBox(
                  width: 10,
                  height: 10,
                  child: CircularProgressIndicator(
                    strokeWidth: 1.5,
                    color: AppColors.accentPurple,
                  ),
                )
              else
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: dotColor,
                    shape: BoxShape.circle,
                  ),
                ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textPrimary,
                    letterSpacing: 0.1,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (isUnauthenticated && onConnect != null) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.accentPurpleWeak,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Text(
                    'Connect',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppColors.accentPurple,
                    ),
                  ),
                ),
              ] else if (isError && onRetry != null) ...[
                const SizedBox(width: 6),
                const Icon(
                  Icons.refresh,
                  size: 14,
                  color: AppColors.danger,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  (String, Color) _pillStateInfo(bool isUnauth, bool isSyncing, bool isError) {
    if (isUnauth) {
      return ('Not connected', AppColors.textSecondary);
    }
    if (isError) {
      return ('Sync failed', AppColors.danger);
    }
    if (isSyncing) {
      final p = status.progress;
      if (p != null && p.phase == 'discovering') {
        return ('Looking for changes…', AppColors.accentPurple);
      }
      if (p != null && p.total > 0) {
        return ('Syncing… ${p.done + 1}/${p.total}', AppColors.accentPurple);
      }
      return ('Syncing…', AppColors.accentPurple);
    }
    if (status.lastSyncedAt != null) {
      return ('Synced ${formatSyncRelativeTime(status.lastSyncedAt)}', AppColors.success);
    }
    return ('Connected', AppColors.success);
  }
}

/// Rich sync status card component displaying progress percentage, bar, and error info.
class SyncStatusCard extends StatelessWidget {
  final SyncStatus status;
  final VoidCallback? onRetry;
  final VoidCallback? onSyncNow;

  const SyncStatusCard({
    super.key,
    required this.status,
    this.onRetry,
    this.onSyncNow,
  });

  @override
  Widget build(BuildContext context) {
    final failed = status.state == SyncState.error;
    final syncing = status.syncing || status.state == SyncState.syncing;
    final progress = status.progress;
    final isIndeterminate = progress == null || progress.total <= 0;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: failed
            ? AppColors.dangerWeak
            : AppColors.surfaceElevated,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: failed ? AppColors.danger : AppColors.hairline,
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (failed) ...[
            Row(
              children: [
                const Icon(Icons.error_outline, size: 16, color: AppColors.danger),
                const SizedBox(width: 6),
                const Text(
                  'Sync failed',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.danger,
                  ),
                ),
                const Spacer(),
                if (onRetry != null)
                  TextButton.icon(
                    onPressed: onRetry,
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    icon: const Icon(Icons.refresh, size: 14, color: AppColors.danger),
                    label: const Text(
                      'Retry',
                      style: TextStyle(fontSize: 12, color: AppColors.danger),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              status.lastError ?? 'Check your network connection and try again.',
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.textSecondary,
              ),
            ),
          ] else ...[
            Row(
              children: [
                Text(
                  syncing
                      ? (isIndeterminate ? 'Looking for changes…' : 'Syncing…')
                      : (status.connected ? 'Google Drive Synced' : 'Not Connected'),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                const Spacer(),
                if (syncing && !isIndeterminate && progress != null)
                  Text(
                    '${(progress.done / progress.total * 100).round()}%',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
              ],
            ),
            if (syncing) ...[
              const SizedBox(height: 8),
              if (isIndeterminate)
                const LinearProgressIndicator(
                  backgroundColor: AppColors.surfaceContainer,
                  color: AppColors.accentPurple,
                )
              else
                LinearProgressIndicator(
                  value: (progress?.total ?? 1) > 0
                      ? (progress!.done / progress.total).clamp(0.0, 1.0)
                      : 0.0,
                  backgroundColor: AppColors.surfaceContainer,
                  color: AppColors.accentPurple,
                ),
              const SizedBox(height: 8),
              Row(
                children: [
                  if (progress?.title != null)
                    Expanded(
                      child: Text(
                        progress!.title!,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  if (progress != null && progress.total > 0)
                    Text(
                      '${progress.done + 1} / ${progress.total}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textTertiary,
                      ),
                    ),
                ],
              ),
            ] else if (status.lastSyncedAt != null) ...[
              const SizedBox(height: 4),
              Text(
                'Last synced: ${formatSyncRelativeTime(status.lastSyncedAt)}',
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

/// Full sync status bar container with pill and optional action buttons.
class SyncStatusBar extends StatelessWidget {
  final SyncStatus status;
  final VoidCallback? onConnect;
  final VoidCallback? onRetry;
  final VoidCallback? onSyncNow;

  const SyncStatusBar({
    super.key,
    required this.status,
    this.onConnect,
    this.onRetry,
    this.onSyncNow,
  });

  @override
  Widget build(BuildContext context) {
    return SyncStatusPill(
      status: status,
      onConnect: onConnect,
      onRetry: onRetry,
      onSyncNow: onSyncNow,
    );
  }
}
