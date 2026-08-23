import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/database/entities/video_page_entity.dart';
import '../../core/providers/core_providers.dart';

/// Filter mode for the Home library view.
enum HomeFilter {
  all,
  videos,
  articles,
  withHighlights,
}

/// Active filter mode in the Home screen.
final homeFilterProvider = StateProvider<HomeFilter>((ref) {
  return HomeFilter.all;
});

/// Search query string in the Home screen.
final homeSearchQueryProvider = StateProvider<String>((ref) {
  return '';
});

/// Observes all pages from the database and filters them reactively by [homeFilterProvider]
/// and [homeSearchQueryProvider].
final homePagesStreamProvider = StreamProvider<List<VideoPageEntity>>((ref) {
  final dao = ref.watch(videoPageDaoProvider);
  final filter = ref.watch(homeFilterProvider);
  final query = ref.watch(homeSearchQueryProvider).trim().toLowerCase();

  return dao.watchAllPages().map((pages) {
    return pages.where((page) {
      // 1. Filter by category
      final isVideo = (page.videoId != null && page.videoId!.isNotEmpty) ||
          page.url.contains('youtube.com') ||
          page.url.contains('youtu.be');

      switch (filter) {
        case HomeFilter.all:
          break;
        case HomeFilter.videos:
          if (!isVideo) return false;
          break;
        case HomeFilter.articles:
          if (isVideo) return false;
          break;
        case HomeFilter.withHighlights:
          final hasHl = page.highlightsJson.isNotEmpty && page.highlightsJson != '[]';
          final hasItems = page.itemsJson.isNotEmpty && page.itemsJson != '[]';
          if (!hasHl && !hasItems) return false;
          break;
      }

      // 2. Filter by search query
      if (query.isNotEmpty) {
        final titleMatch = page.title?.toLowerCase().contains(query) ?? false;
        final urlMatch = page.url.toLowerCase().contains(query);
        final highlightsMatch = page.highlightsJson.toLowerCase().contains(query);
        final itemsMatch = page.itemsJson.toLowerCase().contains(query);

        if (!titleMatch && !urlMatch && !highlightsMatch && !itemsMatch) {
          return false;
        }
      }

      return true;
    }).toList();
  });
});

/// Observes recent video pages for the Home video shelf.
final homeRecentVideosStreamProvider = StreamProvider<List<VideoPageEntity>>((ref) {
  final dao = ref.watch(videoPageDaoProvider);
  return dao.watchRecent(limit: 50).map((pages) {
    return pages.where((p) =>
      (p.videoId != null && p.videoId!.isNotEmpty) ||
      p.url.contains('youtube.com') ||
      p.url.contains('youtu.be')
    ).toList();
  });
});

/// Observes pages with highlights or reader content for the Pages tab.
final homePagesWithHighlightsStreamProvider = StreamProvider<List<VideoPageEntity>>((ref) {
  final dao = ref.watch(videoPageDaoProvider);
  return dao.watchPagesWithHighlights();
});
