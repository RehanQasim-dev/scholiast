import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/database/entities/video_page_entity.dart';
import '../../../core/providers/core_providers.dart';
import '../../../core/sync/sync_models.dart';
import '../../../core/theme/app_colors.dart';
import '../../components/sync_status_bar.dart';
import '../../../features/home/home_providers.dart';
import '../../../features/sync/sync_providers.dart';

/// The Home screen: search, filter chips, sync pill and the annotation
/// library (videos as thumbnail cards, articles as rows).
///
/// - Search field is bound to [homeSearchQueryProvider].
/// - Filter chips drive [homeFilterProvider].
/// - Cards show favicon/letter avatar, cleaned title, host, annotation count, relative date.
/// - Tap navigates via `Navigator.pushNamed` (`/reader?url=` for articles, `/player?url=` for videos).
/// - Long-press deletes via [videoPageDaoProvider] with confirm dialog.
/// - Responsive single-column → multi-column grid at ~900px.
class HomeScreen extends ConsumerWidget {
  final void Function(VideoPageEntity page)? onOpenPage;
  final VoidCallback? onOpenSettings;

  const HomeScreen({super.key, this.onOpenPage, this.onOpenSettings});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pagesAsync = ref.watch(homePagesStreamProvider);
    final filter = ref.watch(homeFilterProvider);
    final query = ref.watch(homeSearchQueryProvider);
    final syncStatus = ref.watch(syncStatusStreamProvider).value ??
        const SyncStatus(state: SyncState.unauthenticated);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 16, 12, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      'Scholiast',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  SyncStatusPill(
                    status: syncStatus,
                    compact: true,
                    onConnect: () => _connectDrive(context, ref),
                  ),
                  const SizedBox(width: 4),
                  IconButton(
                    onPressed: onOpenSettings,
                    icon: const Icon(Icons.settings_outlined),
                    tooltip: 'Settings',
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: TextField(
                key: const Key('home-search-field'),
                onChanged: (value) =>
                    ref.read(homeSearchQueryProvider.notifier).state = value,
                decoration: InputDecoration(
                  hintText: 'Search pages',
                  prefixIcon:
                      const Icon(Icons.search, color: AppColors.textSecondary),
                ),
                controller: TextEditingController(text: query)
                  ..selection = TextSelection.collapsed(offset: query.length),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              height: 36,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 24),
                children: [
                  for (final f in HomeFilter.values)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChip(
                        label: Text(f.label),
                        selected: f == filter,
                        onSelected: (_) => ref
                            .read(homeFilterProvider.notifier)
                            .state = f,
                        showCheckmark: false,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: pagesAsync.when(
                loading: () =>
                    const Center(child: CircularProgressIndicator()),
                error: (error, _) => Center(
                  child: Text(
                    'Could not load library',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                ),
                data: (pages) {
                  if (pages.isEmpty) {
                    return _EmptyLibrary(filter: filter);
                  }
                  return LayoutBuilder(
                    builder: (context, constraints) {
                      final isWide = constraints.maxWidth >= 900;
                      if (isWide) {
                        // Cell height must fit the card's intrinsic content:
                        // a 16:9 thumbnail + title/meta block. Derive the
                        // aspect from the actual cell width so the grid never
                        // overflows the card at any viewport size.
                        const hPadding = 24.0;
                        const gap = 12.0;
                        final cellWidth =
                            (constraints.maxWidth - hPadding * 2 - gap) / 2;
                        final aspect = cellWidth / (cellWidth * 9 / 16 + 92);
                        return GridView.builder(
                          padding:
                              const EdgeInsets.fromLTRB(24, 4, 24, 24),
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: 2,
                            mainAxisSpacing: 12,
                            crossAxisSpacing: 12,
                            childAspectRatio: aspect,
                          ),
                          itemCount: pages.length,
                          itemBuilder: (context, index) {
                            final page = pages[index];
                            return _PageCard(
                              page: page,
                              onTap: () => _openPage(context, page),
                              onDelete: () => _confirmDelete(context, ref, page),
                            );
                          },
                        );
                      }
                      return ListView.separated(
                        padding: const EdgeInsets.fromLTRB(24, 4, 24, 24),
                        itemCount: pages.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 12),
                        itemBuilder: (context, index) {
                          final page = pages[index];
                          if (page.isVideo) {
                            return VideoCard(
                              page: page,
                              onTap: () => _openPage(context, page),
                              onLongPress: () =>
                                  _confirmDelete(context, ref, page),
                            );
                          }
                          return ArticleRow(
                            page: page,
                            onTap: () => _openPage(context, page),
                            onLongPress: () =>
                                _confirmDelete(context, ref, page),
                          );
                        },
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _openPage(BuildContext context, VideoPageEntity page) {
    if (onOpenPage != null) {
      onOpenPage!.call(page);
      return;
    }
    final isVideo = page.isVideo;
    final route = isVideo
        ? '/player?url=${Uri.encodeComponent(page.url)}'
        : '/reader?url=${Uri.encodeComponent(page.url)}';
    try {
      Navigator.of(context).pushNamed(route);
    } catch (_) {}
  }

  Future<void> _confirmDelete(
    BuildContext context,
    WidgetRef ref,
    VideoPageEntity page,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete page?'),
        content: Text(
          'Remove "${cleanTitle(page.title) ?? page.url}" from your library? Annotations will be deleted.',
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
    await ref.read(videoPageDaoProvider).deletePage(page.urlHash);
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Page deleted')),
      );
    }
  }

  Future<void> _connectDrive(BuildContext context, WidgetRef ref) async {
    final messenger = ScaffoldMessenger.of(context);
    final ok = await ref.read(syncControllerProvider.notifier).connectDrive();
    messenger.showSnackBar(
      SnackBar(
        content: Text(ok ? 'Google Drive connected' : 'Connection failed'),
      ),
    );
  }
}

extension on HomeFilter {
  String get label => switch (this) {
        HomeFilter.all => 'All',
        HomeFilter.videos => 'Videos',
        HomeFilter.articles => 'Articles',
        HomeFilter.withHighlights => 'Highlighted',
      };
}

extension on VideoPageEntity {
  bool get isVideo =>
      (videoId != null && videoId!.isNotEmpty) ||
      url.contains('youtube.com') ||
      url.contains('youtu.be');
}

class _PageCard extends StatelessWidget {
  final VideoPageEntity page;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const _PageCard({
    required this.page,
    required this.onTap,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    if (page.isVideo) {
      return VideoCard(page: page, onTap: onTap, onLongPress: onDelete);
    }
    return ArticleRow(page: page, onTap: onTap, onLongPress: onDelete);
  }
}

class VideoCard extends StatelessWidget {
  final VideoPageEntity page;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  const VideoCard({super.key, required this.page, this.onTap, this.onLongPress});

  @override
  Widget build(BuildContext context) {
    final highlightCount = page.highlights.length + page.items.length;
    return Material(
      color: AppColors.surfaceElevated,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.hairline),
      ),
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 16 / 9,
            child: Image.network(
              'https://img.youtube.com/vi/${page.videoId}/hqdefault.jpg',
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => Container(
                color: AppColors.surfaceContainer,
                alignment: Alignment.center,
                child: const Icon(
                  Icons.play_circle_outline,
                  size: 40,
                  color: AppColors.textTertiary,
                ),
              ),
            ),
          ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    cleanTitle(page.title) ?? page.url,
                    style: Theme.of(context).textTheme.titleSmall,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '$highlightCount ${highlightCount == 1 ? 'note' : 'notes'}'
                    ' · ${_relativeTime(page.updatedAt)}'
                    ' · ${domainOf(page.url)}',
                    style: Theme.of(context).textTheme.bodySmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
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

class ArticleRow extends StatelessWidget {
  final VideoPageEntity page;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  const ArticleRow({super.key, required this.page, this.onTap, this.onLongPress});

  @override
  Widget build(BuildContext context) {
    final highlightCount = page.highlights.length;
    final host = domainOf(page.url);
    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
        child: Row(
          children: [
            SizedBox(
              width: 40,
              height: 40,
              child: Stack(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.surfaceContainer,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.hairline),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      host.replaceFirst('www.', '').isEmpty
                          ? '?'
                          : host
                              .replaceFirst('www.', '')
                              .characters
                              .first
                              .toUpperCase(),
                      style: Theme.of(context)
                          .textTheme
                          .titleSmall
                          ?.copyWith(color: AppColors.accentPurpleLight),
                    ),
                  ),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.network(
                      'https://$host/favicon.ico',
                      width: 40,
                      height: 40,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const SizedBox.shrink(),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    cleanTitle(page.title) ?? page.url,
                    style: Theme.of(context).textTheme.bodyLarge,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    '${host.isEmpty ? '—' : host} · $highlightCount ${highlightCount == 1 ? 'highlight' : 'highlights'}'
                    ' · ${_relativeTime(page.updatedAt)}',
                    style: Theme.of(context).textTheme.bodySmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
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

class _EmptyLibrary extends StatelessWidget {
  final HomeFilter filter;

  const _EmptyLibrary({required this.filter});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.auto_stories_outlined,
            size: 56,
            color: AppColors.textDisabled,
          ),
          const SizedBox(height: 16),
          Text(
            'Nothing here yet',
            style: Theme.of(context)
                .textTheme
                .titleMedium
                ?.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: 8),
          Text(
            'Share any webpage or video to Scholiast',
            style: Theme.of(context)
                .textTheme
                .bodyMedium
                ?.copyWith(color: AppColors.textTertiary),
          ),
        ],
      ),
    );
  }
}

String? cleanTitle(String? title) {
  if (title == null || title.trim().isEmpty) return null;
  final index = title.lastIndexOf(' | ');
  return index > 0 ? title.substring(0, index) : title;
}

String domainOf(String url) {
  try {
    return Uri.parse(url).host;
  } catch (_) {
    return url;
  }
}

String _relativeTime(int timestampMs) {
  final diffMs = DateTime.now().millisecondsSinceEpoch - timestampMs;
  final minutes = diffMs ~/ 60000;
  if (minutes < 1) return 'just now';
  if (minutes < 60) return '$minutes min ago';
  final hours = minutes ~/ 60;
  if (hours < 24) return '${hours}h ago';
  final days = hours ~/ 24;
  if (days < 7) return '${days}d ago';
  return '${days ~/ 7}w ago';
}
