/*
 * Native `<video>` player (specs/tauri-native-playback, task 02).
 *
 * Plays engine manifests with zero YouTube chrome: progressive muxed
 * streams directly, HD via the MSE adaptive engine, captions as a native
 * <track>. Drives the shared playerBridge backend (attachNative) so Chrome,
 * shortcuts, notes, and transcript consumers work unchanged. Any failure
 * reports through onFallback (task 03 routes to the iframe).
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { attachNative, detachNative, emitPlayerEvent } from "./playerBridge";
import { AdaptiveSession, choosePlayback } from "./adaptiveEngine";
import { fetchCaptionVtt, resolveManifest } from "./youtubeEngine";
import { PREF_KEYS, getPref } from "../lib/store";
import { usePlayerSnapshot } from "./playerBridge";

interface NativePlayerProps {
  videoId: string;
  onFallback: (reason: string) => void;
}

export default function NativePlayer({ videoId, onFallback }: NativePlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionRef = useRef<AdaptiveSession | null>(null);
  const [captionUrl, setCaptionUrl] = useState<string | null>(null);
  const snapshot = usePlayerSnapshot();
  const fallbackRef = useRef(onFallback);
  fallbackRef.current = onFallback;

  const manifestQuery = useQuery({
    queryKey: ["native-stream", videoId],
    queryFn: () => resolveManifest(videoId),
    // URLs expire: resolved per mount (per session), never cached across.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  // Captions: preferred speech language from the manifest's own track list,
  // VTT blob for the <track>. Optional — video plays without it.
  useEffect(() => {
    const manifest = manifestQuery.data;
    if (!manifest) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    void (async () => {
      const lang = (await getPref<string>(PREF_KEYS.speechLanguage, "en").catch(
        () => "en",
      )) ?? "en";
      const track =
        manifest.captions.find((c) => c.languageCode === lang) ??
        manifest.captions.find((c) => c.languageCode.startsWith("en")) ??
        manifest.captions[0];
      if (!track || cancelled) return;
      try {
        const vtt = await fetchCaptionVtt(track.baseUrl);
        if (cancelled) return;
        blobUrl = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));
        setCaptionUrl(blobUrl);
      } catch {
        /* captions are optional — video plays without them */
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [videoId, manifestQuery.data]);

  // Attach the shared bridge backend to this element.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    attachNative(el);
    return () => detachNative();
  }, []);

  // Caption visibility follows the shared toggle.
  useEffect(() => {
    const track = videoRef.current?.textTracks?.[0];
    if (track) track.mode = snapshot.captionsEnabled ? "showing" : "disabled";
  }, [snapshot.captionsEnabled, captionUrl]);

  // Feed the element once the manifest lands.
  useEffect(() => {
    const el = videoRef.current;
    const manifest = manifestQuery.data;
    if (!el || !manifest) return;
    if (manifest.title) emitPlayerEvent("onTitle", manifest.title);
    const plan = choosePlayback(manifest);
    if (!plan) {
      fallbackRef.current("no playable streams");
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    if (plan.mode === "progressive" && plan.progressive) {
      el.src = plan.progressive.url;
    } else if (plan.video && plan.audio) {
      // Segment downloads ride the Rust-side fetch like everything else —
      // googlevideo range requests must not depend on page CORS.
      const session = new AdaptiveSession(
        el,
        {
          video: plan.video,
          audio: plan.audio,
        },
        tauriFetch as typeof fetch,
      );
      sessionRef.current = session;
      session.start(controller.signal).catch((err: unknown) => {
        if (!cancelled) {
          fallbackRef.current(
            err instanceof Error ? err.message : "adaptive engine failed",
          );
        }
      });
    }
    return () => {
      cancelled = true;
      controller.abort();
      sessionRef.current?.destroy();
      sessionRef.current = null;
    };
  }, [manifestQuery.data]);

  useEffect(() => {
    if (manifestQuery.isError) {
      const err = manifestQuery.error;
      fallbackRef.current(err instanceof Error ? err.message : "resolve failed");
    }
  }, [manifestQuery.isError, manifestQuery.error]);

  return (
    <video
      ref={videoRef}
      data-testid="native-video"
      className="h-full w-full bg-black"
      controls={false}
      playsInline
      crossOrigin="anonymous"
      preload="metadata"
      onCanPlay={() => emitPlayerEvent("onPlayerReady")}
      onError={() => fallbackRef.current("video element error")}
    >
      {captionUrl ? (
        <track kind="captions" srcLang="en" label="Captions" src={captionUrl} default />
      ) : null}
    </video>
  );
}
