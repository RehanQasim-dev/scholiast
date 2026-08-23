import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/algorithms/normalize.dart';
import '../../../features/player/player_state_notifier.dart';
import 'player_chrome.dart';
import 'player_web_controller.dart';
import 'player_web_view.dart';
import 'transcript_panel.dart';

/// The player screen shell — YouTube WebView on the left (landscape) or on
/// top at 16:9 (portrait), with a tabbed [Notes · Transcript] panel docked
/// right (fixed share, min 320dp) or below.
///
/// One [PlayerWebView] instance is created per screen composition and reused
/// across videos — switching videos only calls the controller's `loadVideo`.
///
/// The screen is wired to [playerStateNotifierProvider.family] keyed by the
/// normalized watch URL (so the same videoId with different params shares state).
class PlayerScreen extends ConsumerStatefulWidget {
  final String videoId;
  final String? title;
  final VoidCallback? onBack;
  final PlayerWebController? controllerOverride;

  const PlayerScreen({
    super.key,
    required this.videoId,
    this.title,
    this.onBack,
    this.controllerOverride,
  });

  @override
  ConsumerState<PlayerScreen> createState() => _PlayerScreenState();
}

class _PlayerScreenState extends ConsumerState<PlayerScreen>
    implements PlayerWebEvents {
  PlayerWebController? _inAppController;
  bool _isFullscreen = false;
  int _selectedTab = 0;

  String get _url =>
      normalizeUrl('https://www.youtube.com/watch?v=${widget.videoId}');

  PlayerWebController? get _effectiveController =>
      widget.controllerOverride ?? _inAppController;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(playerStateNotifierProvider(_url).notifier).loadVideo(_url);
    });
  }

  @override
  void didUpdateWidget(covariant PlayerScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.videoId != oldWidget.videoId) {
      ref.read(playerStateNotifierProvider(_url).notifier).loadVideo(_url);
      _effectiveController?.loadVideo(widget.videoId);
    }
  }

  // --- PlayerWebEvents -------------------------------------------------------

  @override
  void onPlayerReady() {}

  @override
  void onStateChange(int state) {
    final isPlaying = state == 1 || state == 3;
    ref.read(playerStateNotifierProvider(_url).notifier).setPlaying(isPlaying);
  }

  @override
  void onError(int code) {
    // ignore: invalid_use_of_visible_for_testing_member, invalid_use_of_protected_member
    ref.read(playerStateNotifierProvider(_url).notifier).state = ref
        .read(playerStateNotifierProvider(_url))
        .copyWith(errorMessage: _errorMessage(code));
  }

  String _errorMessage(int code) {
    switch (code) {
      case 2:
        return 'Invalid video ID or parameter';
      case 5:
        return 'HTML5 player error';
      case 100:
        return 'Video not found or removed';
      case 101:
      case 150:
        return "Video can't be played in this app";
      default:
        return 'Player error ($code)';
    }
  }

  @override
  void onTimeUpdate(double timeSeconds) {
    ref
        .read(playerStateNotifierProvider(_url).notifier)
        .onTimeUpdate(timeSeconds);
  }

  @override
  void onDuration(double durationSeconds) {
    ref
        .read(playerStateNotifierProvider(_url).notifier)
        .setDuration(durationSeconds);
  }

  @override
  void onTitle(String title) {
    final current = ref.read(playerStateNotifierProvider(_url));
    if (current.title != title) {
      // ignore: invalid_use_of_visible_for_testing_member, invalid_use_of_protected_member
      ref.read(playerStateNotifierProvider(_url).notifier).state =
          current.copyWith(title: title);
    }
  }

  @override
  void onCaptionsAvailable(bool available) {}

  @override
  void onCaptureResult(String? dataUrl, int width, int height, String? error) {}

  void _seekTo(double seconds) {
    ref.read(playerStateNotifierProvider(_url).notifier).seekTo(seconds);
    _effectiveController?.seekTo(seconds);
  }

  void _onWebControllerCreated(PlayerWebController c) {
    _inAppController = c;
    c.setEventsListener(this);
    if (widget.videoId.isNotEmpty) c.loadVideo(widget.videoId);
    // If an override was already bound, rebind to the new controller's listener.
    widget.controllerOverride?.setEventsListener(this);
  }

  @override
  Widget build(BuildContext context) {
    final playerState = ref.watch(playerStateNotifierProvider(_url));
    final isLandscape =
        MediaQuery.of(context).orientation == Orientation.landscape;

    if (isLandscape) {
      return _buildLandscape(context, playerState);
    } else {
      return _buildPortrait(context, playerState);
    }
  }

  Widget _buildLandscape(BuildContext context, PlayerState playerState) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final totalWidth = constraints.maxWidth;
          final panelWidth =
              (totalWidth * 0.38).clamp(320.0, totalWidth * 0.55);
          if (_isFullscreen) {
            return _PlayerStage(
              videoId: widget.videoId,
              playerState: playerState,
              controller: _effectiveController,
              useWebView: widget.controllerOverride == null,
              events: this,
              onControllerCreated: _onWebControllerCreated,
              onSeek: _seekTo,
              onToggleFullscreen: () =>
                  setState(() => _isFullscreen = !_isFullscreen),
              onBack: widget.onBack,
            );
          }
          return Row(
            children: [
              Expanded(
                child: _PlayerStage(
                  videoId: widget.videoId,
                  playerState: playerState,
                  controller: _effectiveController,
                  useWebView: widget.controllerOverride == null,
                  events: this,
                  onControllerCreated: _onWebControllerCreated,
                  onSeek: _seekTo,
                  onToggleFullscreen: () =>
                      setState(() => _isFullscreen = !_isFullscreen),
                  onBack: widget.onBack,
                ),
              ),
              Container(
                  width: 1, color: Colors.white.withValues(alpha: 0.12)),
              SizedBox(
                width: panelWidth,
                child: _PanelSlot(
                  url: _url,
                  videoId: widget.videoId,
                  selectedTab: _selectedTab,
                  onTabChanged: (i) => setState(() => _selectedTab = i),
                  onSeek: _seekTo,
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildPortrait(BuildContext context, PlayerState playerState) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            AspectRatio(
              aspectRatio: 16 / 9,
              child: _PlayerStage(
                videoId: widget.videoId,
                playerState: playerState,
                controller: _effectiveController,
                useWebView: widget.controllerOverride == null,
                events: this,
                onControllerCreated: _onWebControllerCreated,
                onSeek: _seekTo,
                onToggleFullscreen: () =>
                    setState(() => _isFullscreen = !_isFullscreen),
                onBack: widget.onBack,
              ),
            ),
            Expanded(
              child: Container(
                color: Theme.of(context).scaffoldBackgroundColor,
                child: _PanelSlot(
                  url: _url,
                  videoId: widget.videoId,
                  selectedTab: _selectedTab,
                  onTabChanged: (i) => setState(() => _selectedTab = i),
                  onSeek: _seekTo,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlayerStage extends StatelessWidget {
  final String videoId;
  final PlayerState playerState;
  final PlayerWebController? controller;
  final bool useWebView;
  final PlayerWebEvents events;
  final void Function(PlayerWebController c) onControllerCreated;
  final void Function(double seconds) onSeek;
  final VoidCallback? onToggleFullscreen;
  final VoidCallback? onBack;

  const _PlayerStage({
    required this.videoId,
    required this.playerState,
    required this.controller,
    required this.useWebView,
    required this.events,
    required this.onControllerCreated,
    required this.onSeek,
    this.onToggleFullscreen,
    this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black,
      child: Stack(
        children: [
          Positioned.fill(
            child: useWebView
                ? PlayerWebView(
                    videoId: videoId,
                    events: events,
                    onControllerCreated: onControllerCreated,
                  )
                : Container(color: Colors.black),
          ),
          Positioned.fill(
            child: PlayerChrome(
              state: playerState,
              controller: controller,
              onBack: onBack,
              onToggleFullscreen: onToggleFullscreen,
              onOpenInYouTube: () {},
            ),
          ),
        ],
      ),
    );
  }
}

class _PanelSlot extends StatelessWidget {
  final String url;
  final String videoId;
  final int selectedTab;
  final ValueChanged<int> onTabChanged;
  final void Function(double seconds) onSeek;

  const _PanelSlot({
    required this.url,
    required this.videoId,
    required this.selectedTab,
    required this.onTabChanged,
    required this.onSeek,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        TabBar(
          tabs: const [Tab(text: 'Notes'), Tab(text: 'Transcript')],
          selectedIndex: selectedTab,
          onTabChanged: onTabChanged,
        ),
        Expanded(
          child: selectedTab == 0
              ? _NotesPlaceholder(onSeek: onSeek)
              : TranscriptPanel(url: url, videoId: videoId, onSeek: onSeek),
        ),
      ],
    );
  }
}

class TabBar extends StatelessWidget {
  final List<Tab> tabs;
  final int selectedIndex;
  final ValueChanged<int> onTabChanged;

  const TabBar(
      {super.key,
      required this.tabs,
      required this.selectedIndex,
      required this.onTabChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: Row(
        children: [
          for (var i = 0; i < tabs.length; i++)
            Expanded(
              child: GestureDetector(
                onTap: () => onTabChanged(i),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  decoration: BoxDecoration(
                    border: Border(
                      bottom: BorderSide(
                        color: i == selectedIndex
                            ? Theme.of(context).colorScheme.primary
                            : Colors.transparent,
                        width: 2,
                      ),
                    ),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    tabs[i].text ?? '',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: i == selectedIndex
                              ? Theme.of(context).colorScheme.primary
                              : Theme.of(context).textTheme.bodyMedium?.color,
                          fontWeight: i == selectedIndex
                              ? FontWeight.w600
                              : FontWeight.w400,
                        ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _NotesPlaceholder extends StatelessWidget {
  final void Function(double seconds) onSeek;

  const _NotesPlaceholder({required this.onSeek});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.note_add_outlined, size: 40, color: Colors.grey),
            const SizedBox(height: 12),
            Text('No notes yet',
                style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(
              'Timestamped notes appear here',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
