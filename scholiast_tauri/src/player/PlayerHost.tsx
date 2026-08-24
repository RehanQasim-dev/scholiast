import { useEffect, useRef } from "react";
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

const IFRAME_API_URL = "https://www.youtube.com/iframe_api";

let apiPromise: Promise<YTNamespace> | null = null;
let constructing: Promise<YTPlayerLike> | null = null;
let ytPlayer: YTPlayerLike | null = null;
let stageDiv: HTMLDivElement | null = null;
let parkedHost: HTMLDivElement | null = null;

function loadIframeApi(): Promise<YTNamespace> {
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
      document.head.appendChild(tag);
    });
  }
  return apiPromise;
}

function ensurePlayer(): Promise<YTPlayerLike> {
  if (ytPlayer) return Promise.resolve(ytPlayer);
  if (!constructing) {
    constructing = loadIframeApi().then((YT) => {
      if (ytPlayer) return ytPlayer;
      if (!stageDiv) {
        stageDiv = document.createElement("div");
        stageDiv.dataset.scholiastStage = "";
        stageDiv.style.cssText =
          "position:relative;width:100%;height:100%;background:#000";
      }
      const mount = document.createElement("div");
      stageDiv.appendChild(mount);
      const initialId = playerBridge.peekPendingVideoId();
      ytPlayer = new YT.Player(mount, {
        width: "100%",
        height: "100%",
        ...(initialId ? { videoId: initialId } : {}),
        playerVars: {
          origin: window.location.origin,
          rel: 0,
          playsinline: 1,
          controls: 0,
          fs: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          disablekb: 1,
          enablejsapi: 1,
          autoplay: 1,
        },
      });
      playerBridge.markConstructed(initialId);
      return ytPlayer;
    });
  }
  return constructing;
}

export default function PlayerHost() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    ensurePlayer().then((p) => {
      if (cancelled || !stageDiv) return;
      container.appendChild(stageDiv);
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
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full"
    />
  );
}
