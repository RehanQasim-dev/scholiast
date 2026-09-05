/*
 * youtubei.js engine (specs/tauri-native-playback, pivot from Rust core).
 *
 * Externally maintained InnerTube client: VISIONOS stream resolution,
 * sig+n deciphering (webview function evaluation), caption tracks.
 * The spike (/tmp/opencode/yt-spike/spike.mjs) proved every call below
 * against live YouTube; this module is its in-app port. Output shape
 * matches StreamManifestView so NativePlayer stays engine-agnostic.
 */

import { Innertube, Platform } from "youtubei.js";
import type {
  ManifestCaptionView,
  StreamFormatView,
  StreamManifestView,
} from "../lib/readerIpc";

let evaluatorInstalled = false;

/** youtubei.js v18 ships no JS evaluator; the webview provides one. */
function ensureEvaluator(): void {
  if (evaluatorInstalled) return;
  evaluatorInstalled = true;
  const shim = Platform.shim as unknown as {
    eval: (
      data: { output: string },
      env: Record<string, string | number | boolean | null | undefined>,
    ) => unknown;
  };
  shim.eval = ((data: { output: string }, args: Record<string, unknown>) => {
    const names = Object.keys(args);
    const values = names.map((name) => args[name]);
    // The emitted script is self-contained and ends in `return { sig?, n? }`
    // — it runs as a function body, mirroring the spike's node:vm wrapper.
    const fn = new Function(...names, data.output);
    return fn(...values);
  }) as typeof shim.eval;
}

let sessionPromise: Promise<Awaited<ReturnType<typeof Innertube.create>>> | null = null;

function session(): Promise<Awaited<ReturnType<typeof Innertube.create>>> {
  ensureEvaluator();
  if (!sessionPromise) {
    sessionPromise = Innertube.create({ generate_session_locally: true }).catch(
      (err: unknown) => {
        sessionPromise = null;
        throw err;
      },
    );
  }
  return sessionPromise;
}

/** Test seam: drop the cached session (mirrors store.ts / voice patterns). */
export function resetEngineForTests(): void {
  sessionPromise = null;
  evaluatorInstalled = false;
}

function toStreamView(format: {
  itag?: number;
  mime_type?: string;
  quality_label?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  audio_sample_rate?: number;
  audio_channels?: number;
  content_length?: number | string;
  init_range?: { start?: number; end?: number } | null;
  index_range?: { start?: number; end?: number } | null;
  has_audio?: boolean;
  has_video?: boolean;
  url?: string | null;
}): StreamFormatView | null {
  if (format.itag === undefined || !format.url) return null;
  const [mime = "", codecsRaw = ""] = (format.mime_type ?? "").split(";");
  const range = (r?: { start?: number; end?: number } | null) =>
    r?.start !== undefined && r?.end !== undefined ? `${r.start}-${r.end}` : undefined;
  const kind =
    format.has_audio && format.has_video
      ? "progressive"
      : format.has_audio
        ? "audio"
        : format.has_video
          ? "videoOnly"
          : null;
  if (!kind) return null;
  return {
    itag: format.itag,
    kind,
    mime: mime.trim(),
    codecs: codecsRaw.trim(),
    qualityLabel: format.quality_label ?? null,
    bitrate: format.bitrate ?? null,
    width: format.width ?? null,
    height: format.height ?? null,
    fps: format.fps ?? null,
    audioSampleRate: format.audio_sample_rate ?? null,
    audioChannels: format.audio_channels ?? null,
    contentLength:
      format.content_length === undefined || format.content_length === null
        ? null
        : String(format.content_length),
    initRange: range(format.init_range) ?? null,
    indexRange: range(format.index_range) ?? null,
    url: format.url,
  };
}

function playabilityError(status: string, reason: string): Error {
  const hay = `${status} ${reason}`.toLowerCase();
  if (hay.includes("private")) return new Error("this video is private");
  if (hay.includes("premium") || hay.includes("members") || hay.includes("payment")) {
    return new Error("this video needs a purchase or membership");
  }
  if (hay.includes("country") || hay.includes("region")) {
    return new Error("this video is blocked in your country");
  }
  if (hay.includes("bot")) {
    return new Error("YouTube temporarily blocked anonymous access from this network");
  }
  if (status === "LOGIN_REQUIRED") return new Error("this video needs a YouTube login");
  if (status === "LIVE_STREAM_OFFLINE") return new Error("this stream hasn't started yet");
  return new Error(`video unavailable: ${reason || status}`);
}

/**
 * Fresh per-session manifest (spike recipe: VISIONOS client — the only one
 * whose adaptive formats carry URLs — then decipher). URLs expire; never
 * persist them.
 */
export async function resolveManifest(videoId: string): Promise<StreamManifestView> {
  const id = videoId.trim();
  if (!id) throw new Error("bad video id");
  const yt = await session();
  const info = await yt.getBasicInfo(id, { client: "VISIONOS" });
  const status = info.playability_status?.status ?? "";
  if (status !== "OK") {
    throw playabilityError(status, info.playability_status?.reason ?? "");
  }
  const details = info.basic_info;
  if (details?.id && details.id !== id) {
    throw new Error("got a substitute video response");
  }
  const player = yt.session.player;
  const raw = [
    ...(info.streaming_data?.formats ?? []),
    ...(info.streaming_data?.adaptive_formats ?? []),
  ];
  const streams: StreamFormatView[] = [];
  for (const format of raw) {
    try {
      const deciphered = await format.decipher(player);
      if (deciphered) format.url = deciphered;
    } catch {
      continue;
    }
    const view = toStreamView(format);
    if (view) streams.push(view);
  }
  if (streams.length === 0) throw new Error("no playable streams found");
  const captions: ManifestCaptionView[] = (
    info.captions?.caption_tracks ?? []
  ).flatMap((track): ManifestCaptionView[] => {
    if (!track.base_url) return [];
    return [
      {
        languageCode: track.language_code ?? "",
        name: track.name?.text ?? track.language_code ?? "",
        baseUrl: track.base_url,
        isAsr: track.kind === "asr",
      },
    ];
  });
  return {
    videoId: id,
    title: details?.title ?? null,
    lengthSeconds: details?.duration ? Math.round(details.duration) : null,
    streams,
    hlsUrl: info.streaming_data?.hls_manifest_url ?? null,
    captions,
  };
}

/** Timedtext fetch for one caption track — what `<track>` loads. */
export async function fetchCaptionVtt(trackUrl: string): Promise<string> {
  const url = trackUrl.includes("fmt=") ? trackUrl : `${trackUrl}&fmt=vtt`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`captions HTTP ${res.status}`);
  return res.text();
}
