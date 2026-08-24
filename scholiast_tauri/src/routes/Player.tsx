import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ToastHost, toast } from "../components/Toast";
import PanelTabs from "../components/PanelTabs";
import { invokeCommand } from "../lib/ipc";
import Chrome from "../player/Chrome";
import PlayerHost from "../player/PlayerHost";
import {
  getPlayerSnapshot,
  playerBridge,
  subscribePlayerState,
  usePlayerEvent,
} from "../player/playerBridge";

const VIDEO_ID_RE =
  /(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})/;

export function extractVideoId(input: string): string | null {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  const match = raw.match(VIDEO_ID_RE);
  return match ? (match[1] ?? null) : null;
}

async function persistResume(url: string, seconds: number) {
  try {
    await invoke("set_resume_at", { url, resumeAt: seconds });
  } catch {
    /* command arrives with task-02; failures are silently ignored */
  }
}

interface CaptureOut {
  path: string;
  w: number;
  h: number;
  urlHash: string;
}

export default function Player() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const url = params.get("url") ?? "";
  const resumeAt = Number(params.get("resume") ?? "0");
  const videoId = useMemo(() => extractVideoId(url), [url]);
  const stageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!url) return;
    if (!videoId) toast("That link isn't a YouTube video URL");
  }, [url, videoId]);

  useEffect(() => {
    if (videoId) playerBridge.commands.loadVideo(videoId);
  }, [videoId]);

  usePlayerEvent("onPlayerReady", () => {
    if (resumeAt > 0) playerBridge.commands.seekTo(resumeAt);
  });

  useEffect(() => {
    if (!url || !videoId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribePlayerState(() => {
      const { time } = getPlayerSnapshot();
      if (time <= 0) return;
      clearTimeout(timer);
      timer = setTimeout(() => void persistResume(url, time), 5000);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [url, videoId]);

  const captureFrame = async () => {
    const stage = stageRef.current;
    if (!stage || !url) return;
    playerBridge.commands.pause();
    const box = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    try {
      const data = await invokeCommand<CaptureOut>("capture_frame", {
        url,
        rect: {
          x: Math.round(box.left * dpr),
          y: Math.round(box.top * dpr),
          w: Math.round(box.width * dpr),
          h: Math.round(box.height * dpr),
        },
      });
      navigate("/frame", {
        state: {
          urlHash: data.urlHash,
          url,
          tmpPath: data.path,
          w: data.w,
          h: data.h,
          videoTime: getPlayerSnapshot().time,
        },
      });
    } catch {
      toast("Couldn't capture the frame — the player may be DRM-protected.");
      playerBridge.commands.play();
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col bg-base lg:grid lg:[grid-template-columns:minmax(0,1fr)_min(max(38%,360px),55%)]">
      <ToastHost />
      <div
        ref={stageRef}
        className="relative aspect-video shrink-0 overflow-hidden bg-black lg:aspect-auto lg:min-h-0"
      >
        {videoId ? (
          <>
            <PlayerHost />
            <Chrome
              stageRef={stageRef}
              onCaptureClick={() => void captureFrame()}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-2">
            {url
              ? "That link isn't a YouTube video URL."
              : "Open a video from Home to start watching."}
          </div>
        )}
      </div>
      <aside className="min-h-0 flex-1 overflow-y-auto border-t border-hairline bg-surface lg:border-t-0 lg:border-l">
        <PanelTabs url={url} videoId={videoId} />
      </aside>
    </section>
  );
}
