import { useEffect, useRef, useSyncExternalStore } from "react";

export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

export interface Handlers {
  onPlayerReady(): void;
  onStateChange(state: number): void;
  onError(code: number): void;
  onTimeUpdate(seconds: number): void;
  onDuration(seconds: number): void;
  onTitle(title: string): void;
  onCaptionsAvailable(available: boolean): void;
}

export type PlayerEventName = keyof Handlers;

export interface YTPlayerLike {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoData(): { title?: string; video_id?: string };
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  setVolume(volume: number): void;
  loadVideoById(videoId: string): void;
  loadModule(module: string): void;
  unloadModule(module: string): void;
  setOption(module: string, option: string, value: unknown): void;
  getOption(module: string, option: string): unknown;
  addEventListener(event: string, listener: (e: { data: number }) => void): void;
  removeEventListener(event: string, listener: (e: { data: number }) => void): void;
}

export interface PlayerSnapshot {
  time: number;
  duration: number;
  playing: boolean;
  rate: number;
  volume: number;
  captionsEnabled: boolean;
}

const POLL_INTERVAL_MS = 250;
const RATE_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export { RATE_STEPS };

let player: YTPlayerLike | null = null;
let ready = false;
let listening = false;
let pendingVideoId: string | null = null;
let currentLoadedVideoId: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastRate = 1;
let lastVolume = 100;
let lastCaptionsEnabled = true;
let captionRefreshTimers: ReturnType<typeof setTimeout>[] = [];

let snapshot: PlayerSnapshot = {
  time: 0,
  duration: 0,
  playing: false,
  rate: lastRate,
  volume: lastVolume,
  captionsEnabled: lastCaptionsEnabled,
};

const snapshotSubs = new Set<() => void>();
type EventListenerFn = (payload?: unknown) => void;
const listeners = new Map<PlayerEventName, Set<EventListenerFn>>();

function patch(part: Partial<PlayerSnapshot>) {
  let changed = false;
  for (const key of Object.keys(part) as (keyof PlayerSnapshot)[]) {
    if (part[key] !== undefined && part[key] !== snapshot[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return;
  snapshot = { ...snapshot, ...part };
  snapshotSubs.forEach((fn) => fn());
}

function emit<K extends PlayerEventName>(
  name: K,
  ...args: Parameters<Handlers[K]>
) {
  const set = listeners.get(name);
  if (!set) return;
  const handler = args.length > 0 ? args[0] : undefined;
  set.forEach((fn) => {
    fn(handler);
  });
}

function startPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!ready || !player) return;
    try {
      const seconds = player.getCurrentTime();
      patch({ time: seconds });
      emit("onTimeUpdate", seconds);
    } catch {
      /* transient during seeks */
    }
  }, POLL_INTERVAL_MS);
}

function stopPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function reportMetadata() {
  if (!player) return;
  try {
    const data = player.getVideoData();
    if (data?.title) emit("onTitle", data.title);
  } catch {
    /* not populated yet */
  }
  try {
    const d = player.getDuration();
    if (d > 0) {
      patch({ duration: d });
      emit("onDuration", d);
    }
  } catch {
    /* not populated yet */
  }
}

function reportCaptions() {
  let has = false;
  try {
    const tracks = player?.getOption("captions", "tracklist");
    has = Array.isArray(tracks) && tracks.length > 0;
  } catch {
    has = false;
  }
  emit("onCaptionsAvailable", has);
}

function applyCaptions(enabled: boolean) {
  if (!player) return;
  try {
    if (enabled) {
      player.loadModule("captions");
      const tracks = player.getOption("captions", "tracklist");
      if (Array.isArray(tracks) && tracks.length > 0) {
        player.setOption("captions", "track", tracks[0]);
      } else {
        player.setOption("captions", "track", { languageCode: "en" });
      }
    } else {
      player.unloadModule("captions");
      player.setOption("captions", "track", {});
    }
  } catch {
    /* captions module unavailable */
  }
}

function applySettings() {
  if (!player) return;
  try {
    player.setPlaybackRate(lastRate);
  } catch {
    /* not accepted yet */
  }
  try {
    player.setVolume(lastVolume);
  } catch {
    /* not accepted yet */
  }
  applyCaptions(lastCaptionsEnabled);
}

function flushPendingLoad() {
  if (pendingVideoId && pendingVideoId !== currentLoadedVideoId) {
    commands.loadVideo(pendingVideoId);
  }
}

function scheduleCaptionRefreshes() {
  clearCaptionRefreshes();
  for (const delay of [1000, 3000, 6000]) {
    captionRefreshTimers.push(
      setTimeout(() => {
        reportMetadata();
        reportCaptions();
        applySettings();
      }, delay),
    );
  }
}

function clearCaptionRefreshes() {
  captionRefreshTimers.forEach(clearTimeout);
  captionRefreshTimers = [];
}

function startSession() {
  ready = true;
  applySettings();
  emit("onPlayerReady");
  reportMetadata();
  reportCaptions();
  scheduleCaptionRefreshes();
  flushPendingLoad();
}

function handleStateChange(data: number) {
  emit("onStateChange", data);
  const playing = data === YT_STATE.PLAYING || data === YT_STATE.BUFFERING;
  patch({ playing });
  if (data === YT_STATE.PLAYING) {
    reportMetadata();
    reportCaptions();
    startPoll();
  } else if (data === YT_STATE.PAUSED) {
    stopPoll();
  } else if (data === YT_STATE.ENDED) {
    stopPoll();
    try {
      const d = player?.getDuration() ?? 0;
      patch({ time: d, playing: false });
      emit("onTimeUpdate", d);
    } catch {
      /* player gone */
    }
  } else if (data === YT_STATE.UNSTARTED || data === YT_STATE.CUED) {
    stopPoll();
  }
}

function handleError(data: number) {
  stopPoll();
  emit("onError", data);
}

export const commands = {
  loadVideo(videoId: string) {
    if (!videoId) return;
    pendingVideoId = videoId;
    if (!player || !ready) return;
    if (currentLoadedVideoId === videoId) {
      commands.play();
      return;
    }
    currentLoadedVideoId = videoId;
    patch({ time: 0, duration: 0 });
    try {
      player.loadVideoById(videoId);
    } catch {
      /* player mid-reload */
    }
    setTimeout(() => {
      applySettings();
      reportCaptions();
    }, 1500);
  },
  seekTo(seconds: number) {
    patch({ time: Math.max(0, seconds) });
    if (!ready || !player) return;
    let wasPlaying = false;
    try {
      const state = player.getPlayerState();
      wasPlaying =
        state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING;
    } catch {
      /* unreadable state */
    }
    try {
      player.seekTo(Math.max(0, seconds), true);
      if (wasPlaying) player.playVideo();
    } catch {
      /* seek rejected */
    }
  },
  play() {
    if (!ready || !player) return;
    try {
      player.playVideo();
    } catch {
      /* autoplay rejection surfaces via onStateChange */
    }
  },
  pause() {
    if (!ready || !player) return;
    try {
      player.pauseVideo();
    } catch {
      /* already stopped */
    }
  },
  setRate(rate: number) {
    lastRate = rate;
    patch({ rate });
    if (ready && player) {
      try {
        player.setPlaybackRate(rate);
      } catch {
        /* rate rejected */
      }
    }
  },
  setVolume(volume: number) {
    const v = Math.min(100, Math.max(0, Math.round(volume)));
    lastVolume = v;
    patch({ volume: v });
    if (ready && player) {
      try {
        player.setVolume(v);
      } catch {
        /* volume rejected */
      }
    }
  },
  setCaptions(enabled: boolean) {
    lastCaptionsEnabled = enabled;
    patch({ captionsEnabled: enabled });
    if (ready && player) applyCaptions(enabled);
  },
};

export const playerBridge = {
  commands,

  events: {
    on<K extends PlayerEventName>(name: K, handler: Handlers[K]): () => void {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      const fn = handler as EventListenerFn;
      set.add(fn);
      return () => {
        set?.delete(fn);
      };
    },
  },

  attach(target: YTPlayerLike) {
    if (player !== target) {
      detachListeners();
      player = target;
    }
    if (!listening) {
      player.addEventListener("onReady", onReadyListener);
      player.addEventListener("onStateChange", onStateChangeListener);
      player.addEventListener("onError", onErrorListener);
      listening = true;
    }
    if (!ready) startSession();
  },

  detach() {
    detachListeners();
    listening = false;
    stopPoll();
    clearCaptionRefreshes();
    ready = false;
    patch({ playing: false });
  },

  peekPendingVideoId(): string | null {
    return pendingVideoId;
  },

  markConstructed(videoId: string | null) {
    currentLoadedVideoId = videoId;
  },

  resetForTests() {
    detachListeners();
    listening = false;
    stopPoll();
    clearCaptionRefreshes();
    player = null;
    ready = false;
    pendingVideoId = null;
    currentLoadedVideoId = null;
    lastRate = 1;
    lastVolume = 100;
    lastCaptionsEnabled = true;
    snapshot = {
      time: 0,
      duration: 0,
      playing: false,
      rate: 1,
      volume: 100,
      captionsEnabled: true,
    };
    snapshotSubs.clear();
    listeners.clear();
  },
};

const onReadyListener = () => {
  reportMetadata();
  reportCaptions();
  flushPendingLoad();
};
const onStateChangeListener = (e: { data: number }) => handleStateChange(e.data);
const onErrorListener = (e: { data: number }) => handleError(e.data);

function detachListeners() {
  if (!player) return;
  player.removeEventListener("onReady", onReadyListener);
  player.removeEventListener("onStateChange", onStateChangeListener);
  player.removeEventListener("onError", onErrorListener);
}

export function getPlayerSnapshot(): PlayerSnapshot {
  return snapshot;
}

export function subscribePlayerState(fn: () => void): () => void {
  snapshotSubs.add(fn);
  return () => {
    snapshotSubs.delete(fn);
  };
}

export function usePlayerSnapshot(): PlayerSnapshot {
  return useSyncExternalStore(subscribePlayerState, getPlayerSnapshot);
}

export function usePlayerEvent<K extends PlayerEventName>(
  name: K,
  handler: Handlers[K],
): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(
    () =>
      playerBridge.events.on(name, ((payload: unknown) => {
        (ref.current as (p?: unknown) => void)(payload);
      }) as Handlers[K]),
    [name],
  );
}
