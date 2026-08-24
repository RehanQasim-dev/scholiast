import { useEffect, useState, type ReactNode, type RefObject } from "react";
import {
  RATE_STEPS,
  commands,
  getPlayerSnapshot,
  usePlayerEvent,
  usePlayerSnapshot,
  YT_STATE,
} from "./playerBridge";

export function formatMss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

const ERROR_MESSAGES: Record<number, string> = {
  2: "Invalid video ID or parameter",
  5: "HTML5 player error",
  100: "Video not found or removed",
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

interface ChromeProps {
  stageRef: RefObject<HTMLElement | null>;
  slots?: { capture?: ReactNode; addNote?: ReactNode };
  onCaptureClick?: () => void;
}

export default function Chrome({ stageRef, slots, onCaptureClick }: ChromeProps) {
  const snap = usePlayerSnapshot();
  const [visible, setVisible] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<number | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  usePlayerEvent("onPlayerReady", () => setReady(true));
  usePlayerEvent("onError", (code) => setError(code));
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

  const seekBy = (delta: number) => {
    const { time, duration } = getPlayerSnapshot();
    const target =
      delta < 0
        ? Math.max(0, time + delta)
        : duration > 0
          ? Math.min(duration - 0.25, time + delta)
          : time + delta;
    commands.seekTo(target);
  };

  const hidden = !visible;

  return (
    <div
      className="absolute inset-0 cursor-pointer select-none"
      onClick={() => setVisible((v) => !v)}
    >
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
              <p className="mt-1 text-xs text-text-2">
                Transcript and notes may still be available for this video.
              </p>
            )}
          </div>
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
        className={`absolute right-0 bottom-0 left-0 flex flex-col gap-1 bg-gradient-to-t from-black/85 to-transparent px-4 pt-6 pb-3 transition-opacity duration-[var(--sc-dur-fast)] ease-out ${
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
            backgroundSize: `${
              snap.duration > 0 ? (snap.time / snap.duration) * 100 : 0
            }% 100%`,
            backgroundRepeat: "no-repeat",
          }}
        />
        <div className="flex items-center gap-2 text-xs text-text-2 tabular-nums">
          <span aria-label="Current time">{formatMss(snap.time)}</span>
          <span>/</span>
          <span aria-label="Duration">{formatMss(snap.duration)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label={snap.playing ? "Pause" : "Play"}
            onClick={() => (snap.playing ? commands.pause() : commands.play())}
            className="rounded-md p-1.5 text-white/90 hover:bg-white/10"
          >
            {snap.playing ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                <path d="M8 5.5v13a1 1 0 0 0 1.54.84l10-6.5a1 1 0 0 0 0-1.68l-10-6.5A1 1 0 0 0 8 5.5z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            aria-label="Back 15 seconds"
            onClick={() => seekBy(-15)}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-white/90 tabular-nums hover:bg-white/10"
          >
            −15s
          </button>
          <button
            type="button"
            aria-label="Forward 15 seconds"
            onClick={() => seekBy(15)}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-white/90 tabular-nums hover:bg-white/10"
          >
            +15s
          </button>

          <select
            aria-label="Playback speed"
            value={snap.rate}
            onChange={(e) => commands.setRate(Number(e.target.value))}
            className="rounded-md bg-black/40 px-1.5 py-1 text-xs text-white/90 outline-none hover:bg-white/10"
          >
            {RATE_STEPS.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>

          <button
            type="button"
            aria-label="Captions"
            aria-pressed={snap.captionsEnabled}
            onClick={() => commands.setCaptions(!snap.captionsEnabled)}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold hover:bg-white/10 ${
              snap.captionsEnabled
                ? "text-(--sc-accent)"
                : "text-white/50 line-through"
            }`}
          >
            CC
          </button>

          <input
            type="range"
            aria-label="Volume"
            min={0}
            max={100}
            step={1}
            value={snap.volume}
            onChange={(e) => commands.setVolume(Number(e.target.value))}
            className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/25 accent-(--sc-accent)"
          />

          <div className="ml-auto flex items-center gap-1.5">
            {onCaptureClick && (
              <button
                type="button"
                aria-label="Capture frame"
                onClick={onCaptureClick}
                className="rounded-md p-1.5 text-white/90 hover:bg-white/10"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
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
              className="rounded-md p-1.5 text-white/90 hover:bg-white/10"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
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
    </div>
  );
}
