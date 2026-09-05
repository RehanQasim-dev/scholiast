import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  commands,
  getPlayerSnapshot,
  usePlayerEvent,
  usePlayerSnapshot,
  YT_STATE,
} from "./playerBridge";
import { useSeekStep } from "./useSeekStep";
import PlaybackSheet from "./PlaybackSheet";

function formatMss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const ERROR_MESSAGES: Record<number, string> = {
  2: "Invalid video ID or parameter",
  5: "HTML5 player error",
  100: "Video not found or removed",
  153: "Video player configuration error — missing referrer",
};

function errorMessage(code: number): string {
  return (
    ERROR_MESSAGES[code] ??
    (code === 101 || code === 150
      ? "This video can't be played here (embedding disabled by the uploader)"
      : `Player error (${code})`)
  );
}

function isEmbeddingDisabled(code: number): boolean {
  return code === 101 || code === 150;
}

function isReferrerError(code: number): boolean {
  return code === 153;
}

interface ChromeProps {
  stageRef: RefObject<HTMLElement | null>;
  slots?: { capture?: ReactNode; addNote?: ReactNode };
  onCaptureClick?: () => void;
  collapsed?: boolean;
  title?: string;
  /** Back navigation (Player home). Renders the top title bar when set. */
  onBack?: () => void;
}

export default function Chrome({ stageRef, slots, onCaptureClick, collapsed = false, title, onBack }: ChromeProps) {
  const snap = usePlayerSnapshot();
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const lastTapRef = useRef<{ t: number; x: number } | null>(null);
  const ytTitleRef = useRef<string>("");
  const seekStep = useSeekStep();

  usePlayerEvent("onPlayerReady", () => setReady(true));
  usePlayerEvent("onError", (code) => setError(code));
  usePlayerEvent("onTitle", (t) => {
    ytTitleRef.current = t;
  });
  usePlayerEvent("onStateChange", (state) => {
    if (state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING) {
      setError(null);
    }
  });
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    const stage = stageRef.current;
    if (!stage) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void stage.requestFullscreen().catch(() => {});
    }
  };

  const seekBy = useCallback((delta: number) => {
    const { time, duration } = getPlayerSnapshot();
    const target =
      delta < 0
        ? Math.max(0, time + delta)
        : duration > 0
          ? Math.min(duration - 0.25, time + delta)
          : time + delta;
    commands.seekTo(target);
  }, []);

  const handleStageTap = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const clientX =
        "touches" in e
          ? (e.touches[0]?.clientX ?? rect.left)
          : (e as React.MouseEvent).clientX;
      const now = Date.now();
      const last = lastTapRef.current;
      if (last && now - last.t < 320) {
        const width = rect.width || 1;
        const relX = clientX - rect.left;
        if (relX < width * 0.35) {
          seekBy(-seekStep);
        } else if (relX > width * 0.65) {
          seekBy(seekStep);
        } else {
          setVisible((v) => !v);
        }
        lastTapRef.current = null;
        return;
      }
      lastTapRef.current = { t: now, x: clientX };
      window.setTimeout(() => {
        if (lastTapRef.current && Date.now() - lastTapRef.current.t >= 320) {
          setVisible((v) => !v);
          lastTapRef.current = null;
        }
      }, 330);
    },
    [seekBy, seekStep],
  );

  const hidden = !visible;

  if (collapsed) {
    return (
      <div
        data-testid="chrome-strip"
        className="sc-strip absolute inset-0 z-10 flex items-center gap-1 bg-surface/95 px-1 text-xs"
        style={{ height: 44 }}
      >
        <button
          type="button"
          aria-label={snap.playing ? "Pause" : "Play"}
          onClick={() => (snap.playing ? commands.pause() : commands.play())}
          className="sc-hit flex items-center justify-center rounded-full text-text hover:bg-elevated"
        >
          {snap.playing ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
              <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" />
            </svg>
          )}
        </button>
        <span className="min-w-[48px] text-center tabular-nums text-text-2">{formatMss(snap.time)}</span>
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-text">{title ?? ytTitleRef.current ?? ""}</span>
        <span className="rounded-md border border-hairline bg-elevated px-2 py-1 tabular-nums text-text-2">{snap.rate}×</span>
        <button
          type="button"
          aria-label="Playback speed"
          onClick={() => setSheetOpen(true)}
          className="sc-hit flex items-center justify-center rounded-full text-text-2 hover:bg-elevated hover:text-text"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6">
            <path d="M3 6h18M3 12h18M3 18h18" />
            <circle cx="9" cy="6" r="2" />
            <circle cx="15" cy="12" r="2" />
            <circle cx="9" cy="18" r="2" />
          </svg>
        </button>
        <PlaybackSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 select-none"
      onClick={handleStageTap}
      data-testid="chrome-root"
    >
      {/* Pause shield: YouTube's native title/channel overlay has no API
          switch (showinfo is deprecated) and appears over the iframe while
          paused. This cover hides it and swallows its links; it lifts the
          moment playback resumes so the picture is never cropped mid-watch. */}
      <div
        data-testid="chrome-pause-shield"
        aria-hidden="true"
        className={`absolute top-0 right-0 left-0 h-16 bg-gradient-to-b from-black/90 via-black/60 to-transparent transition-opacity duration-[var(--sc-dur-fast)] ease-out ${
          snap.playing ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      />
      {/* Watermark shield: YouTube's bottom-right "Watch on YouTube" badge has
          no API switch either. Same pause-only deal as the title shield. */}
      <div
        data-testid="chrome-watermark-shield"
        aria-hidden="true"
        className={`absolute right-0 bottom-0 h-12 w-40 bg-gradient-to-t from-black/90 via-black/60 to-transparent transition-opacity duration-[var(--sc-dur-fast)] ease-out ${
          snap.playing ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      />
      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-sm text-text-2">Loading player…</span>
        </div>
      )}

      {error !== null && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div
            role="alert"
            className="pointer-events-auto max-w-sm rounded-lg border border-hairline bg-surface/95 p-4 text-center"
          >
            <p className="text-sm font-medium">{errorMessage(error)}</p>
            {isEmbeddingDisabled(error) && (
              <p className="mt-1 text-xs text-text-2">Transcript and notes may still be available for this video.</p>
            )}
            {isReferrerError(error) && (
              <p className="mt-1 text-xs text-text-2">
                YouTube now requires a referrer header. Update the app or open the video on YouTube directly.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Top title bar (YouTube-style): back + title, tap stage to show/hide
          together with the rest of the chrome. No safe-area padding — the
          host activity already offsets content below the status bar. */}
      {onBack && (
        <div
          data-testid="chrome-topbar"
          className={`absolute top-0 right-0 left-0 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-2 pt-2 pb-6 transition-opacity duration-[var(--sc-dur-fast)] ease-out ${
            hidden ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <button
            type="button"
            aria-label="Back to library"
            onClick={(e) => {
              e.stopPropagation();
              onBack();
            }}
            className="sc-hit flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/90 hover:bg-white/10"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-white">
            {title || ytTitleRef.current || ""}
          </span>
        </div>
      )}

      <button
        type="button"
        aria-label={snap.playing ? "Pause" : "Play"}
        onClick={(e) => {
          e.stopPropagation();
          if (snap.playing) commands.pause();
          else commands.play();
        }}
        className={`absolute top-1/2 left-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-opacity duration-[var(--sc-dur-fast)] ease-out hover:bg-accent/80 ${
          hidden ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        {snap.playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-7 w-7">
            <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" />
          </svg>
        )}
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute right-0 bottom-0 left-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 to-transparent px-3 pt-6 pb-3 transition-opacity duration-[var(--sc-dur-fast)] ease-out ${
          hidden ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <input
          type="range"
          aria-label="Seek"
          min={0}
          max={Math.max(snap.duration, 0)}
          step={0.25}
          value={Math.min(snap.time, snap.duration || snap.time)}
          disabled={snap.duration <= 0}
          onChange={(e) => commands.seekTo(Number(e.target.value))}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-(--sc-accent)"
          style={{
            backgroundImage: `linear-gradient(var(--sc-accent), var(--sc-accent))`,
            backgroundSize: `${snap.duration > 0 ? (snap.time / snap.duration) * 100 : 0}% 100%`,
            backgroundRepeat: "no-repeat",
          }}
        />
        <div className="flex items-center gap-2 text-xs text-text-2">
          <span aria-label="Current time" className="tabular-nums">{formatMss(snap.time)}</span>
          <span aria-hidden className="opacity-60">·</span>
          <span aria-label="Duration" className="tabular-nums">{formatMss(snap.duration)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-label={snap.playing ? "Pause" : "Play"}
            onClick={() => (snap.playing ? commands.pause() : commands.play())}
            className="sc-hit flex items-center justify-center rounded-md p-1.5 text-white/90 hover:bg-white/10"
          >
            {snap.playing ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" />
              </svg>
            )}
          </button>

          <span className="rounded-md bg-black/40 px-1.5 py-1 text-xs text-white/90 tabular-nums">{snap.rate}×</span>

          <button
            type="button"
            aria-label="Playback speed"
            onClick={() => setSheetOpen(true)}
            className="sc-hit flex items-center justify-center rounded-md text-white/90 hover:bg-white/10"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-6 w-6">
              <path d="M3 6h18M3 12h18M3 18h18" />
              <circle cx="9" cy="6" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="9" cy="18" r="2" />
            </svg>
          </button>

          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={100}
            step={1}
            value={snap.volume}
            onChange={(e) => commands.setVolume(Number(e.target.value))}
            className="ml-1 hidden h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/25 accent-(--sc-accent) sm:block"
          />

          <div className="ml-auto flex items-center gap-1">
            {onCaptureClick && (
              <button
                type="button"
                aria-label="Capture frame"
                onClick={onCaptureClick}
                className="sc-hit flex items-center justify-center rounded-md text-white/90 hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                  <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </button>
            )}
            {slots?.capture ?? null}
            {slots?.addNote ?? null}
            <button
              type="button"
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={toggleFullscreen}
              className="sc-hit flex items-center justify-center rounded-md text-white/90 hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                {fullscreen ? (
                  <>
                    <path d="M8 3v5H3" />
                    <path d="M21 8h-5V3" />
                    <path d="M3 16h5v5" />
                    <path d="M16 21v-5h5" />
                  </>
                ) : (
                  <>
                    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
                    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
                    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
                    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      <PlaybackSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
