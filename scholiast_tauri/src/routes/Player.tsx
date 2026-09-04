import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { toast } from "../components/Toast";
import PanelTabs from "../components/PanelTabs";
import SplitterPane from "../components/SplitterPane";
import useIsNarrow from "../hooks/useIsNarrow";
import useIsTablet from "../hooks/useIsTablet";
import { invokeCommand, upsertVideo } from "../lib/ipc";
import Chrome from "../player/Chrome";
import PlayerHost from "../player/PlayerHost";
import TabletVideoDock from "../components/player/TabletVideoDock";
import type { ActiveComposerState } from "../components/NotesTab";
import {
  getPlayerSnapshot,
  playerBridge,
  subscribePlayerState,
  usePlayerEvent,
  YT_STATE,
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
  } catch {}
}

export interface CaptureOut {
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
  const isTablet = useIsTablet();
  const isMobile = isNarrow && !isTablet;

  const [sheet, setSheet] = useState<SheetState>("balanced");
  const [videoTitle, setVideoTitle] = useState("");
  const [playerState, setPlayerState] = useState<number>(YT_STATE.UNSTARTED);

  const [studyTab, setStudyTab] = useState<"notes" | "transcript">("notes");
  const [tabletPanel, setTabletPanel] = useState<"notes" | "transcript" | null>("notes");
  const [activeComposer, setActiveComposer] = useState<ActiveComposerState | null>(null);

  const videoQuery = useQuery({
    queryKey: ["video", url],
    queryFn: () => upsertVideo({ url }),
    enabled: Boolean(url && videoId),
    staleTime: Infinity,
  });
  const urlHash = videoQuery.data?.urlHash;

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
  usePlayerEvent("onStateChange", (s) => setPlayerState(s));

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

  const captureFrame = useCallback(async (): Promise<CaptureOut | null> => {
    const stage = stageRef.current;
    if (!stage || !url) {
      toast("Frame capture unavailable — open a video first");
      return null;
    }
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
      if (!data) toast("Frame capture failed — DRM or unsupported content");
      return data;
    } catch {
      toast("Frame capture failed — DRM or unsupported content");
      playerBridge.commands.play();
      return null;
    }
  }, [url]);

  const handleAddNote = useCallback(() => {
    setStudyTab("notes");
    if (isTablet) setTabletPanel("notes");

    const snap = getPlayerSnapshot();
    const wasPlaying = snap.playing || playerState === YT_STATE.PLAYING;
    if (wasPlaying) playerBridge.commands.pause();

    setActiveComposer({
      timestamp: snap.time,
      draft: "",
      wasPlaying,
      autoFocus: true,
    });
  }, [isTablet, playerState]);

  const handleCaptureFrameClick = useCallback(async () => {
    const frame = await captureFrame();
    if (frame) {
      setStudyTab("notes");
      if (isTablet) setTabletPanel("notes");
      const snap = getPlayerSnapshot();
      setActiveComposer((prev) =>
        prev
          ? { ...prev, capturedFrame: frame }
          : {
              timestamp: snap.time,
              draft: "",
              wasPlaying: false,
              capturedFrame: frame,
              autoFocus: true,
            },
      );
    }
  }, [captureFrame, isTablet]);

  // Global keyboard shortcuts for desktop & tablet with physical keyboard
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isInput) return;

      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        handleAddNote();
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        const snap = getPlayerSnapshot();
        if (snap.playing || playerState === YT_STATE.PLAYING) {
          playerBridge.commands.pause();
        } else {
          playerBridge.commands.play();
        }
        return;
      }

      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void handleCaptureFrameClick();
        return;
      }

      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        setStudyTab((prev) => (prev === "notes" ? "transcript" : "notes"));
        if (isTablet) {
          setTabletPanel((prev) => (prev === "notes" ? "transcript" : "notes"));
        }
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleAddNote, handleCaptureFrameClick, isTablet, playerState]);

  const handleWorkspaceScroll = useCallback(() => {
    const el = workspaceRef.current;
    if (!el || !isMobile) return;
    const top = el.scrollTop;
    if (top > 140 && sheet !== "focus") {
      setSheet("focus");
    } else if (top < 24 && sheet === "focus") {
      setSheet("balanced");
    }
  }, [isMobile, sheet]);

  const isFocus = sheet === "focus" && isMobile;
  const isShieldVisible = playerState === YT_STATE.PAUSED || playerState === YT_STATE.ENDED;

  const videoStageNode = (
    <div
      ref={stageRef}
      data-testid="player-stage"
      className={`relative h-full w-full overflow-hidden bg-black ${
        isFocus ? "sticky top-0 z-10 border-b border-hairline" : ""
      }`}
    >
      {videoId ? (
        <>
          <PlayerHost videoId={videoId} />
          {/* Pause / Ended recommendation shield: prevents YouTube related tiles from bleeding through */}
          {isShieldVisible && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-[1] bg-black/70 backdrop-blur-[1px] transition-opacity duration-200"
            />
          )}
          {/* Floating Back to Home button */}
          <button
            type="button"
            aria-label="Back to library"
            onClick={() => navigate("/home")}
            className="absolute top-3 left-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white/90 backdrop-blur hover:bg-black/80 hover:text-white transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <ArrowLeft size={18} strokeWidth={2} />
          </button>
          <Chrome
            stageRef={stageRef}
            onCaptureClick={() => void captureFrame()}
            collapsed={isFocus}
            title={videoTitle}
          />
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-text-2 gap-3">
          <p>{url ? "That link isn't a YouTube video URL." : "Open a video from Home to start watching."}</p>
          <button
            type="button"
            onClick={() => navigate("/home")}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-3 py-1.5 text-xs text-text hover:bg-elevated"
          >
            <ArrowLeft size={14} /> Back to Library
          </button>
        </div>
      )}
    </div>
  );

  const studyPanelNode = (
    <aside
      ref={workspaceRef}
      onScroll={handleWorkspaceScroll}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface"
    >
      <PanelTabs
        url={url}
        videoId={videoId}
        onCaptureFrame={captureFrame}
        tab={isTablet ? (tabletPanel ?? "notes") : studyTab}
        onTabChange={(t) => {
          setStudyTab(t);
          if (isTablet) setTabletPanel(t);
        }}
        onAddNote={handleAddNote}
        composer={activeComposer}
        onComposerChange={setActiveComposer}
        isMobile={isMobile}
        isTablet={isTablet}
      />
    </aside>
  );

  return (
    <section
      ref={containerRef}
      className="flex h-full min-h-0 w-full flex-col bg-base"
      style={isMobile ? { paddingTop: "var(--sc-safe-top)" } : undefined}
    >
      {isMobile ? (
        /* Mobile / Narrow Portrait: Stacked Layout (Top 40% Video, Bottom 60% Notes) */
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            className="relative shrink-0 overflow-hidden bg-black"
            style={
              isFocus
                ? { height: 44 }
                : { aspectRatio: "16 / 9", maxHeight: "42vh", width: "100%" }
            }
          >
            {videoStageNode}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden border-t border-hairline">
            {studyPanelNode}
          </div>
        </div>
      ) : isTablet ? (
        /* Tablet: Video Left + Notes Right with Right-Side Edge Dock (~48px) */
        <div className="relative flex h-full min-h-0 w-full overflow-hidden">
          <div
            className={`relative h-full transition-all duration-200 overflow-hidden ${
              tabletPanel !== null ? "w-[60%] mr-12" : "w-[calc(100%-3rem)]"
            }`}
          >
            {videoStageNode}
          </div>
          {tabletPanel !== null && (
            <div className="h-full w-[calc(40%-3rem)] border-l border-hairline overflow-hidden">
              {studyPanelNode}
            </div>
          )}
          <TabletVideoDock
            activePanel={tabletPanel}
            onTogglePanel={(p) => setTabletPanel((prev) => (prev === p ? null : p))}
            onAddNote={handleAddNote}
            onCaptureFrame={() => void handleCaptureFrameClick()}
            urlHash={urlHash}
          />
        </div>
      ) : (
        /* Desktop: Resizable 2-Panel Splitter with full keyboard ergonomics */
        <SplitterPane
          left={videoStageNode}
          right={studyPanelNode}
          storageKey="layout.player_split_ratio"
          defaultRatio={0.6}
          minRatio={0.35}
          maxRatio={0.75}
        />
      )}
    </section>
  );
}
