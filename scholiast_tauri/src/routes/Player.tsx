import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, useSearchParams } from "react-router-dom";
import CommentEditorSheet from "../components/CommentEditorSheet";
import { toast } from "../components/Toast";
import PanelTabs from "../components/PanelTabs";
import StudyDock from "../components/StudyDock";
import useIsNarrow from "../hooks/useIsNarrow";
import { addNote, invokeCommand, upsertVideo } from "../lib/ipc";
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

type SheetState = "balanced" | "focus";

export default function Player() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const url = params.get("url") ?? "";
  const resumeAt = Number(params.get("resume") ?? "0");
  const videoId = useMemo(() => extractVideoId(url), [url]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const isNarrow = useIsNarrow();
  const [noteOpen, setNoteOpen] = useState(false);
  const [sheet, setSheet] = useState<SheetState>("balanced");
  const [videoTitle, setVideoTitle] = useState("");
  const edgeStartRef = useRef<{ x: number; y: number } | null>(null);
  const videoSwipeRef = useRef<{ x: number; y: number } | null>(null);

  const videoQuery = useQuery({
    queryKey: ["video", url],
    queryFn: () => upsertVideo({ url }),
    enabled: Boolean(url && videoId),
    staleTime: Infinity,
  });
  const urlHash = videoQuery.data?.urlHash ?? null;

  const handleFabAddNote = useCallback(async () => {
    if (!urlHash) return;
    const videoTime = getPlayerSnapshot().time;
    try {
      await addNote({ urlHash, videoTime });
    } catch {
      setNoteOpen(true);
    }
  }, [urlHash]);

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
  usePlayerEvent("onTitle", (t) => setVideoTitle(t));

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
      playerBridge.commands.play();
      void handleFabAddNote();
    }
  };

  const handleWorkspaceScroll = useCallback(() => {
    const el = workspaceRef.current;
    if (!el || !isNarrow) return;
    const top = el.scrollTop;
    if (top > 140 && sheet !== "focus") {
      setSheet("focus");
    } else if (top < 24 && sheet === "focus") {
      setSheet("balanced");
    }
  }, [isNarrow, sheet]);

  const isFocus = sheet === "focus" && isNarrow;

  const handleEdgeTouchStart = useCallback((e: React.TouchEvent) => {
    const x = e.touches[0]?.clientX ?? 0;
    const y = e.touches[0]?.clientY ?? 0;
    if (x < 24) edgeStartRef.current = { x, y };
    else edgeStartRef.current = null;
  }, []);
  const handleEdgeTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = edgeStartRef.current;
      edgeStartRef.current = null;
      if (!start) return;
      const endX = e.changedTouches[0]?.clientX ?? start.x;
      const endY = e.changedTouches[0]?.clientY ?? start.y;
      const dx = endX - start.x;
      const dy = Math.abs(endY - start.y);
      if (dx > 72 && dy < 80) navigate("/home");
    },
    [navigate],
  );

  const handleVideoTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    videoSwipeRef.current = { x: t.clientX, y: t.clientY };
  }, []);
  const handleVideoTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const start = videoSwipeRef.current;
      videoSwipeRef.current = null;
      if (!start) return;
      const end = e.changedTouches[0];
      if (!end) return;
      const dx = end.clientX - start.x;
      const dy = end.clientY - start.y;
      if (dy > 80 && Math.abs(dx) < 60) navigate("/home");
    },
    [navigate],
  );

  return (
    <section
      ref={containerRef}
      onTouchStart={handleEdgeTouchStart}
      onTouchEnd={handleEdgeTouchEnd}
      className="flex h-full min-h-0 flex-col bg-base"
      style={isNarrow ? { paddingTop: "var(--sc-safe-top)" } : undefined}
    >
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div
          ref={stageRef}
          data-testid="player-stage"
          onTouchStart={handleVideoTouchStart}
          onTouchEnd={handleVideoTouchEnd}
          className={`relative shrink-0 overflow-hidden bg-black lg:w-[65%] lg:flex-none ${isFocus ? "sticky top-0 z-10 border-b border-hairline" : ""}`}
          style={
            isNarrow
              ? isFocus
                ? { height: 44 }
                : { aspectRatio: "16 / 9", maxHeight: "42vh", width: "100%" }
              : { aspectRatio: "16 / 9", minHeight: 0 }
          }
        >
          {videoId ? (
            <>
              <PlayerHost />
              <Chrome stageRef={stageRef} onCaptureClick={() => void captureFrame()} collapsed={isFocus} title={videoTitle} />
              <div aria-hidden className="sc-yt-mask hidden lg:block" style={{ display: isFocus ? "none" : undefined }} />
            </>
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-text-2">
              {url ? "That link isn't a YouTube video URL." : "Open a video from Home to start watching."}
            </div>
          )}
        </div>

        <aside
          ref={workspaceRef}
          onScroll={handleWorkspaceScroll}
          className="min-h-0 flex-1 overflow-y-auto border-t border-hairline bg-surface lg:w-[35%] lg:flex-none lg:border-t-0 lg:border-l"
        >
          <PanelTabs url={url} videoId={videoId} />
        </aside>
      </div>

      {videoId && urlHash ? (
        <StudyDock
          urlHash={urlHash}
          onCapture={() => void captureFrame()}
          onNewNote={() => void handleFabAddNote()}
        />
      ) : null}

      {videoId && urlHash && (
        <CommentEditorSheet
          open={noteOpen}
          target={{ urlHash, currentTime: getPlayerSnapshot().time }}
          onClose={() => setNoteOpen(false)}
        />
      )}
    </section>
  );
}
