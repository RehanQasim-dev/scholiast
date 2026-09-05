/*
 * hls.js transport over the Rust-side fetch (specs/tauri-native-playback).
 *
 * WebViews can't play HLS natively and their own fetch is CORS-blocked
 * against Google hosts, so hls.js runs with this custom loader: every
 * manifest/segment/key request issues from Rust (no CORS, residential
 * IP), with the video's PO token replayed as `pot` on googlevideo URLs.
 */

import type {
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderResponse,
  LoaderStats,
} from "hls.js";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/** Token replayed onto segment URLs; set per video by NativePlayer. */
let potToken: string | null = null;

/** Test seam: drop the replayed token (mirrors store.ts patterns). */
export function resetHlsLoaderForTests(): void {
  potToken = null;
}

export function setHlsPotToken(token: string | null): void {
  potToken = token;
}

/** Append `pot` to googlevideo URLs lacking one; everything else untouched. */
export function withPot(url: string, token: string | null): string {
  if (!token) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.hostname.endsWith(".googlevideo.com")) return url;
  if (parsed.searchParams.has("pot")) return url;
  parsed.searchParams.set("pot", token);
  return parsed.toString();
}

function freshStats(): LoaderStats {
  return { aborted: false, loaded: 0, retry: 0 } as LoaderStats;
}

/** hls.js Loader driving every request through the Tauri HTTP plugin. */
export class TauriFetchLoader implements Loader<LoaderContext> {
  public readonly stats: LoaderStats = freshStats();
  public context: LoaderContext | null = null;
  private controller: AbortController | null = null;

  public load(
    context: LoaderContext,
    _config: LoaderConfiguration,
    callbacks: LoaderCallbacks<LoaderContext>,
  ): void {
    this.context = context;
    const controller = new AbortController();
    this.controller = controller;
    const stats = this.stats;
    const headers: Record<string, string> = { ...(context.headers ?? {}) };
    if (context.rangeStart !== undefined || context.rangeEnd !== undefined) {
      headers.Range = `bytes=${context.rangeStart ?? 0}-${context.rangeEnd ?? ""}`;
    }
    tauriFetch(withPot(context.url, potToken), {
      headers,
      signal: controller.signal,
    }).then(
      (res) => void deliver(res),
      (err: unknown) => void fail(err),
    );

    const deliver = async (res: Response) => {
      try {
        // A resolve racing abort() must not report success (real fetch
        // rejects here; mocks and cross-thread races may not).
        if (stats.aborted || controller.signal.aborted) {
          stats.aborted = true;
          callbacks.onAbort?.(stats, context, null);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data =
          context.responseType === "arraybuffer"
            ? await res.arrayBuffer()
            : await res.text();
        const response: LoaderResponse = { url: context.url, data };
        stats.loaded = typeof data === "string" ? data.length : data.byteLength;
        callbacks.onSuccess(response, stats, context, null);
      } catch (err) {
        fail(err);
      }
    };

    const fail = (err: unknown) => {
      if (controller.signal.aborted) {
        stats.aborted = true;
        callbacks.onAbort?.(stats, context, null);
        return;
      }
      callbacks.onError(
        { code: 0, text: err instanceof Error ? err.message : String(err) },
        context,
        null,
        stats,
      );
    };
  }

  public abort(): void {
    this.stats.aborted = true;
    this.controller?.abort();
  }

  public destroy(): void {
    this.abort();
    this.controller = null;
    this.context = null;
  }
}
