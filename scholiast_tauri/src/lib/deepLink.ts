import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { popIntentQueueAndExtractText } from "tauri-plugin-mobile-sharetarget-api";
import { extractVideoId } from "../routes/Player";
import { deliverGithubOAuth, parseGithubOAuthCallback } from "./githubOAuth";

const HTTP_URL_RE = /https?:\/\/[^\s"'<>]+/gi;

/**
 * Resolves a share/deep-link payload to an in-app route:
 * - `scholiast://open?url=<enc>` / `scholiast://share?url=<enc>`
 * - plain text containing the first http(s) URL (ACTION_SEND extraText)
 * YouTube URLs open the player; anything else is ignored.
 */
export function routeForSharedText(raw: string): string | null {
  let candidate = raw.trim();
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "scholiast:") {
      candidate = parsed.searchParams.get("url") ?? "";
    }
  } catch {
    // not a parseable URL — fall through to regex extraction
  }
  if (!/^https?:\/\//i.test(candidate)) {
    const match = HTTP_URL_RE.exec(raw);
    candidate = match?.[0] ?? "";
    HTTP_URL_RE.lastIndex = 0;
  }
  if (!candidate) return null;
  const videoId = extractVideoId(candidate);
  if (videoId) {
    return `/player?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`,
    )}`;
  }
  return `/reader?url=${encodeURIComponent(candidate)}`;
}

/** Global deep-link/share-intent listener. Mounted once from Home. */
export function useDeepLinks(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;
    let disposeListen: (() => void) | undefined;
    let disposeFocus: (() => void) | undefined;
    // One share arrives twice (SEND queue + rewritten VIEW intent) — route it once.
    let lastRoutedPath = "";
    let lastRoutedAt = 0;

    const navigateOnce = (path: string) => {
      const now = Date.now();
      if (path === lastRoutedPath && now - lastRoutedAt < 2000) return;
      lastRoutedPath = path;
      lastRoutedAt = now;
      navigate(path);
    };

    const handle = (urls: readonly string[] | string | null) => {
      if (disposed || !urls) return;
      for (const raw of typeof urls === "string" ? [urls] : urls) {
        // GitHub OAuth round-trip from the bridge page — completes in the
        // Settings card; route there so the result is visible.
        const oauth = parseGithubOAuthCallback(raw);
        if (oauth) {
          deliverGithubOAuth(oauth);
          navigateOnce("/settings");
          break;
        }
        const path = routeForSharedText(raw);
        if (path) {
          navigateOnce(path);
          break;
        }
      }
    };

    // Android ACTION_SEND (YouTube/Chrome share sheet) never reaches the
    // deep-link plugin — it only sees ACTION_VIEW. The sharetarget plugin
    // queues SEND text instead: drain it on launch and every re-focus
    // (warm share while the app is already running).
    const consumeShareQueue = () => {
      void popIntentQueueAndExtractText()
        .then((text) => {
          if (disposed || !text) return;
          const path = routeForSharedText(text);
          if (path) navigateOnce(path);
        })
        .catch(() => {
          /* plugin unavailable (desktop / older build) */
        });
    };

    try {
      void getCurrent()
        .then(handle)
        .catch(() => {});
      void onOpenUrl((urls) => handle(urls))
        .then((fn) => {
          if (disposed) fn();
          else disposeListen = fn;
        })
        .catch(() => {});
      consumeShareQueue();
      void listen("tauri://focus", consumeShareQueue)
        .then((fn) => {
          if (disposed) fn();
          else disposeFocus = fn;
        })
        .catch(() => {});
    } catch {
      /* tauri deep-link API unavailable (desktop test env / not configured) */
    }

    return () => {
      disposed = true;
      disposeListen?.();
      disposeFocus?.();
    };
  }, [navigate]);
}
