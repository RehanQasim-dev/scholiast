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

export const IFRAME_API_URL = "https://www.youtube.com/iframe_api";

let apiPromise: Promise<YTNamespace> | null = null;
let constructing: Promise<YTPlayerLike> | null = null;
let ytPlayer: YTPlayerLike | null = null;
let stageDiv: HTMLDivElement | null = null;
let parkedHost: HTMLDivElement | null = null;
let iframeObserver: MutationObserver | null = null;

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

export function resetPlayerHostForTests() {
  apiPromise = null;
  constructing = null;
  ytPlayer = null;
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

function ensurePlayer(): Promise<YTPlayerLike> {
  if (ytPlayer) return Promise.resolve(ytPlayer);
  if (!constructing) {
    constructing = loadIframeApi().then((YT) => {
      if (ytPlayer) return ytPlayer;
      if (!stageDiv) {
        stageDiv = document.createElement("div");
        stageDiv.dataset.scholiastStage = "";
        stageDiv.style.cssText =
          "position:relative;width:100%;height:100%;background:#000;overflow:hidden";
      }
      const mount = document.createElement("div");
      stageDiv.appendChild(mount);
      observeIframeReferrerPolicy(stageDiv);
      const initialId = playerBridge.peekPendingVideoId();
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
          autoplay: 1,
        },
      });
      playerBridge.markConstructed(initialId);
      requestAnimationFrame(() => patchIframeReferrerPolicy(stageDiv!));
      setTimeout(() => patchIframeReferrerPolicy(stageDiv!), 500);
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
  }, []);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full [&_iframe]:border-0"
    />
  );
}
