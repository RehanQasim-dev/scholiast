import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { extractVideoId } from "../routes/Player";

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
  if (!videoId) return null;
  return `/player?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}`;
}

/** Global deep-link/share-intent listener. Mounted once from Home. */
export function useDeepLinks(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let disposed = false;
    let disposeListen: (() => void) | undefined;

    const handle = (urls: readonly string[] | string | null) => {
      if (disposed || !urls) return;
      for (const raw of typeof urls === "string" ? [urls] : urls) {
        const path = routeForSharedText(raw);
        if (path) {
          navigate(path);
          break;
        }
      }
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
    } catch {
      /* tauri deep-link API unavailable (desktop test env / not configured) */
    }

    return () => {
      disposed = true;
      disposeListen?.();
    };
  }, [navigate]);
}
