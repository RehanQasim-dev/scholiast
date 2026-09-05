/*
 * Adaptive playback engine (specs/tauri-native-playback, task 02).
 *
 * Plan selection is pure (unit-tested); the MSE session appends init +
 * media bytes for one video + one audio track. Progressive-first: a 720p+
 * muxed stream plays directly. Anything unrecoverable throws, and the
 * caller falls back to the legacy iframe (PRODUCT 8).
 */

import type { StreamFormatView, StreamManifestView } from "../lib/readerIpc";

export interface PlaybackPlan {
  mode: "progressive" | "adaptive";
  progressive?: StreamFormatView;
  video?: StreamFormatView;
  audio?: StreamFormatView;
}

/** `video/mp4; codecs="avc1…"` — the SourceBuffer recipe. */
export function composeMime(format: StreamFormatView): string {
  return format.codecs ? `${format.mime}; ${format.codecs}` : format.mime;
}

const byPixelsDesc = (a: StreamFormatView, b: StreamFormatView) =>
  (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0);

const byAudioQualityDesc = (a: StreamFormatView, b: StreamFormatView) =>
  (b.bitrate ?? b.audioSampleRate ?? 0) - (a.bitrate ?? a.audioSampleRate ?? 0);

/**
 * Pick how to play a manifest. HD prefers ≤1080p video (bandwidth sanity;
 * 4K VP9/AV1 melts mobile decoders) with the best audio; anything below
 * that falls back to whatever muxed progressive exists.
 */
export function choosePlayback(manifest: StreamManifestView): PlaybackPlan | null {
  const progressive = manifest.streams
    .filter((s) => s.kind === "progressive")
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
  if (progressive && (progressive.height ?? 0) >= 720) {
    return { mode: "progressive", progressive };
  }
  const videos = manifest.streams
    .filter((s) => s.kind === "videoOnly")
    .sort(byPixelsDesc);
  const audios = manifest.streams
    .filter((s) => s.kind === "audio")
    .sort(byAudioQualityDesc);
  const video = videos.find((v) => (v.height ?? 0) <= 1080) ?? videos[0];
  const audio = audios[0];
  if (video && audio) return { mode: "adaptive", video, audio };
  if (progressive) return { mode: "progressive", progressive };
  return null;
}

function parseRange(range: string): [number, number] {
  const [s, e] = range.split("-").map(Number);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s) {
    throw new Error(`bad range ${range}`);
  }
  return [s, e];
}

const CHUNK_BYTES = 1024 * 1024;

/**
 * One MSE session over a `<video>` element. Appends init + media for both
 * tracks sequentially; seeking ahead of the buffered frontier stalls until
 * the appender catches up (documented v1 limitation).
 */
export class AdaptiveSession {
  private mediaSource: MediaSource | null = null;
  private objectUrl: string | null = null;
  private aborted = false;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly plan: { video: StreamFormatView; audio: StreamFormatView },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async start(signal?: AbortSignal): Promise<void> {
    if (typeof MediaSource === "undefined") {
      throw new Error("no MediaSource");
    }
    const tracks = [this.plan.video, this.plan.audio] as const;
    for (const track of tracks) {
      if (
        typeof MediaSource.isTypeSupported === "function" &&
        !MediaSource.isTypeSupported(composeMime(track))
      ) {
        throw new Error(`unsupported mime ${composeMime(track)}`);
      }
    }
    this.mediaSource = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    this.video.src = this.objectUrl;
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.mediaSource?.removeEventListener("sourceopen", onOpen);
        resolve();
      };
      const onAbort = () => reject(new Error("aborted"));
      this.mediaSource?.addEventListener("sourceopen", onOpen, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
    });
    if (this.aborted || signal?.aborted) throw new Error("aborted");
    await Promise.all(tracks.map((t) => this.appendTrack(t, signal)));
    if (!this.aborted && this.mediaSource.readyState === "open") {
      this.mediaSource.endOfStream();
    }
  }

  private async appendTrack(
    track: StreamFormatView,
    signal?: AbortSignal,
  ): Promise<void> {
    const ms = this.mediaSource;
    if (!ms) throw new Error("no media source");
    const sb = ms.addSourceBuffer(composeMime(track));
    const put = (bytes: ArrayBuffer): Promise<void> =>
      new Promise((resolve, reject) => {
        sb.addEventListener("updateend", () => resolve(), { once: true });
        sb.addEventListener("error", () => reject(new Error("append failed")), { once: true });
        sb.appendBuffer(bytes);
      });
    // Init segment first (required before any media).
    if (!track.initRange) throw new Error("missing init range");
    const [initStart, initEnd] = parseRange(track.initRange);
    await put(await this.range(track.url, initStart, initEnd, signal));
    // Media starts after the sidx index (skipped — parsers tolerate its
    // absence but choke if it lands mid-segment).
    let cursor = initEnd + 1;
    if (track.indexRange) {
      const [, indexEnd] = parseRange(track.indexRange);
      cursor = Math.max(cursor, indexEnd + 1);
    }
    const total = track.contentLength ? Number(track.contentLength) : NaN;
    for (;;) {
      if (this.aborted || signal?.aborted) throw new Error("aborted");
      const end = Number.isFinite(total)
        ? Math.min(cursor + CHUNK_BYTES - 1, total - 1)
        : cursor + CHUNK_BYTES - 1;
      const chunk = await this.range(track.url, cursor, end, signal);
      if (chunk.byteLength === 0) break;
      await put(chunk);
      if (chunk.byteLength < CHUNK_BYTES) break;
      cursor += chunk.byteLength;
      if (Number.isFinite(total) && cursor >= total) break;
    }
  }

  private async range(
    url: string,
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const res = await this.fetchImpl(url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal,
    });
    if (res.status !== 206 && res.status !== 200) {
      throw new Error(`range HTTP ${res.status}`);
    }
    return res.arrayBuffer();
  }

  destroy(): void {
    this.aborted = true;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.mediaSource = null;
  }
}
