import { useEffect, useRef } from "react";
import { invokeCommand } from "../lib/ipc";
import { playerBridge, type YTPlayerLike } from "./playerBridge";

interface YTPlayerOptions {
  width?: string;
  height?: string;
  videoId?: string;
  playerVars?: Record<string, string | number>;
}

interface YTNamespace {
  Player: new (
    element: HTMLElement,
    options: YTPlayerOptions,
  ) => YTPlayerLike;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const IFRAME_API_URL = "https://www.youtube.com/iframe_api";

let apiPromise: Promise<YTNamespace> | null = null;
let constructing: Promise<YTPlayerLike> | null = null;
let ytPlayer: YTPlayerLike | null = null;
let stageDiv: HTMLDivElement | null = null;
let parkedHost: HTMLDivElement | null = null;
let iframeObserver: MutationObserver | null = null;
let playerServerUrl: string | null = null;
let serverUrlChecked = false;
let activeAdapterCleanup: (() => void) | null = null;

export async function resolvePlayerServerUrl(): Promise<string | null> {
  if (serverUrlChecked) return playerServerUrl;
  try {
    const url = await invokeCommand<string | null>("get_player_server_url");
    playerServerUrl = url ?? null;
  } catch {
    playerServerUrl = null;
  }
  serverUrlChecked = true;
  return playerServerUrl;
}

export function setPlayerServerUrlForTests(url: string | null) {
  playerServerUrl = url;
  serverUrlChecked = true;
}

export function getYoutubeOrigin(origin = window.location.origin): string {
  if (origin.startsWith("http://") || origin.startsWith("https://")) return origin;
  return "https://app.scholiast.desktop";
}

export function patchIframeReferrerPolicy(root: HTMLElement) {
  const iframe = root.querySelector("iframe") as HTMLIFrameElement | null;
  if (iframe && iframe.getAttribute("referrerpolicy") !== "strict-origin-when-cross-origin") {
    iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    try {
      (iframe as unknown as { referrerPolicy: string }).referrerPolicy =
        "strict-origin-when-cross-origin";
    } catch {
      /* readonly in some engines */
    }
  }
}

export function observeIframeReferrerPolicy(root: HTMLElement) {
  patchIframeReferrerPolicy(root);
  if (iframeObserver) return;
  iframeObserver = new MutationObserver(() => patchIframeReferrerPolicy(root));
  iframeObserver.observe(root, { childList: true, subtree: true });
}

export function createPlayerServerAdapter(
  iframe: HTMLIFrameElement,
  initialVideoId: string | null,
): { adapter: YTPlayerLike; cleanup: () => void } {
  let cachedTime = 0;
  let cachedDuration = 0;
  let cachedState = -1;
  let cachedTitle = "";
  let cachedVideoId = initialVideoId ?? "";
  let captionsAvailable = false;
  const listeners = new Map<string, Set<(e: { data: number }) => void>>();

  function postCmd(command: string, args: Record<string, unknown> = {}) {
    try {
      iframe.contentWindow?.postMessage(
        {
          target: "scholiast-player",
          command,
          ...args,
        },
        "*",
      );
    } catch (_) {}
  }

  function onMessage(e: MessageEvent) {
    const data = e.data;
    if (!data || data.source !== "scholiast-player") return;
    if (data.type === "onPlayerReady") {
      listeners.get("onReady")?.forEach((fn) => fn({ data: 1 }));
    } else if (data.type === "onStateChange") {
      cachedState = data.data;
      listeners.get("onStateChange")?.forEach((fn) => fn({ data: data.data }));
    } else if (data.type === "onError") {
      listeners.get("onError")?.forEach((fn) => fn({ data: data.data }));
    } else if (data.type === "onTimeUpdate") {
      if (typeof data.time === "number") cachedTime = data.time;
      if (typeof data.duration === "number") cachedDuration = data.duration;
    } else if (data.type === "onTitle") {
      if (typeof data.title === "string") cachedTitle = data.title;
      listeners.get("onReady")?.forEach((fn) => fn({ data: 1 }));
    } else if (data.type === "onCaptionsAvailable") {
      captionsAvailable = Boolean(data.available);
      listeners.get("onReady")?.forEach((fn) => fn({ data: 1 }));
    }
  }

  window.addEventListener("message", onMessage);

  const adapter: YTPlayerLike = {
    playVideo: () => postCmd("play"),
    pauseVideo: () => postCmd("pause"),
    seekTo: (seconds: number) => {
      cachedTime = Math.max(0, seconds);
      postCmd("seekTo", { seconds });
    },
    getCurrentTime: () => cachedTime,
    getDuration: () => cachedDuration,
    getVideoData: () => ({ title: cachedTitle, video_id: cachedVideoId }),
    getPlayerState: () => cachedState,
    setPlaybackRate: (rate: number) => postCmd("setRate", { rate }),
    setVolume: (volume: number) => postCmd("setVolume", { volume }),
    loadVideoById: (videoId: string) => {
      cachedVideoId = videoId;
      cachedTime = 0;
      cachedDuration = 0;
      postCmd("loadVideo", { videoId });
    },
    loadModule: (module: string) => postCmd("loadModule", { module }),
    unloadModule: (module: string) => postCmd("unloadModule", { module }),
    setOption: (module: string, option: string, value: unknown) => {
      if (module === "captions") {
        postCmd("setCaptions", { enabled: Boolean(value) });
      } else {
        postCmd("setOption", { module, option, value });
      }
    },
    getOption: (module: string, option: string) => {
      if (module === "captions" && option === "tracklist") {
        return captionsAvailable ? [{ languageCode: "en" }] : [];
      }
      return null;
    },
    addEventListener: (event: string, listener: (e: { data: number }) => void) => {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
    },
    removeEventListener: (event: string, listener: (e: { data: number }) => void) => {
      listeners.get(event)?.delete(listener);
    },
  };

  return {
    adapter,
    cleanup: () => {
      window.removeEventListener("message", onMessage);
      listeners.clear();
    },
  };
}

export function resetPlayerHostForTests() {
  apiPromise = null;
  constructing = null;
  ytPlayer = null;
  playerServerUrl = null;
  serverUrlChecked = false;
  if (activeAdapterCleanup) {
    activeAdapterCleanup();
    activeAdapterCleanup = null;
  }
  if (iframeObserver) {
    iframeObserver.disconnect();
    iframeObserver = null;
  }
  stageDiv?.remove();
  stageDiv = null;
  parkedHost?.remove();
  parkedHost = null;
  delete (window as unknown as Record<string, unknown>).YT;
  delete (window as unknown as Record<string, unknown>).onYouTubeIframeAPIReady;
}

export function loadIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise<YTNamespace>((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (window.YT) resolve(window.YT);
      };
      const tag = document.createElement("script");
      tag.src = IFRAME_API_URL;
      tag.referrerPolicy = "strict-origin-when-cross-origin";
      tag.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      document.head.appendChild(tag);
    });
  }
  return apiPromise;
}

function ensurePlayer(preferredVideoId?: string | null): Promise<YTPlayerLike> {
  if (ytPlayer) return Promise.resolve(ytPlayer);
  if (!constructing) {
    constructing = (async () => {
      if (ytPlayer) return ytPlayer;
      if (!stageDiv) {
        stageDiv = document.createElement("div");
        stageDiv.dataset.scholiastStage = "";
        stageDiv.style.cssText =
          "position:relative;width:100%;height:100%;background:#000;overflow:hidden";
      }

      const initialId = preferredVideoId || playerBridge.peekPendingVideoId();
      const serverUrl = await resolvePlayerServerUrl();

      if (serverUrl) {
        // Desktop / loopback server mode: Eliminates Error 153 by hosting the player
        // on 127.0.0.1 which provides a valid HTTP Referer to YouTube's embed server.
        const iframe = document.createElement("iframe");
        iframe.src = `${serverUrl}${initialId ? `?v=${encodeURIComponent(initialId)}` : ""}`;
        iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        iframe.setAttribute(
          "allow",
          "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
        );
        iframe.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;";
        stageDiv.appendChild(iframe);
        observeIframeReferrerPolicy(stageDiv);

        const { adapter, cleanup } = createPlayerServerAdapter(iframe, initialId);
        activeAdapterCleanup = cleanup;
        ytPlayer = adapter;
        playerBridge.markConstructed(initialId);
        return ytPlayer;
      }

      // Fallback: Direct YouTube Iframe API mode for dev server & web environments
      const YT = await loadIframeApi();
      if (ytPlayer) return ytPlayer;
      const mount = document.createElement("div");
      stageDiv.appendChild(mount);
      observeIframeReferrerPolicy(stageDiv);
      ytPlayer = new YT.Player(mount, {
        width: "100%",
        height: "100%",
        ...(initialId ? { videoId: initialId } : {}),
        playerVars: {
          origin: getYoutubeOrigin(),
          widget_referrer: getYoutubeOrigin(),
          rel: 0,
          playsinline: 1,
          controls: 0,
          fs: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          disablekb: 1,
          enablejsapi: 1,
          autoplay: 0,
        },
      });
      playerBridge.markConstructed(initialId);
      requestAnimationFrame(() => patchIframeReferrerPolicy(stageDiv!));
      setTimeout(() => patchIframeReferrerPolicy(stageDiv!), 500);
      return ytPlayer;
    })();
  }
  return constructing;
}

export interface PlayerHostProps {
  videoId?: string | null;
}

export default function PlayerHost({ videoId }: PlayerHostProps = {}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (videoId) {
      playerBridge.commands.loadVideo(videoId);
    }
  }, [videoId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    ensurePlayer(videoId).then((p) => {
      if (cancelled || !stageDiv) return;
      container.appendChild(stageDiv);
      patchIframeReferrerPolicy(stageDiv);
      playerBridge.attach(p);
    });
    return () => {
      cancelled = true;
      playerBridge.commands.pause();
      playerBridge.detach();
      if (stageDiv) {
        parkedHost ??= document.createElement("div");
        parkedHost.appendChild(stageDiv);
      }
    };
  }, [videoId]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:border-0"
    />
  );
}
