import { useCallback, useEffect, useRef, useState } from "react";
import {
  useVoiceRecorder,
  type RecorderPhase,
  type StopReason,
  type StopResult,
} from "../voice/useVoiceRecorder";

interface MicButtonProps {
  disabled?: boolean;
  disabledTitle?: string;
  /** Overrides the hook-driven phase when provided (e.g. externally driven spinner). */
  phase?: RecorderPhase;
  onStateChange?: (phase: RecorderPhase, meta: { reason?: StopReason }) => void;
  onError?: (error: unknown) => void;
  /** Receives the finalized WAV path whenever a recording stops successfully. */
  onStopped?: (result: StopResult) => void;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function MicButton({
  disabled = false,
  disabledTitle,
  phase: phaseOverride,
  onStateChange,
  onError,
  onStopped,
}: MicButtonProps) {
  const [capped, setCapped] = useState(false);
  const capNoticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(capNoticeTimer.current), []);

  const handleStateChange = useCallback(
    (phase: RecorderPhase, meta: { reason?: StopReason }) => {
      if (meta.reason === "cap") {
        setCapped(true);
        window.clearTimeout(capNoticeTimer.current);
        capNoticeTimer.current = window.setTimeout(() => setCapped(false), 5000);
      }
      onStateChange?.(phase, meta);
    },
    [onStateChange],
  );

  const recorder = useVoiceRecorder({
    onStateChange: handleStateChange,
    onError,
  });
  const phase = phaseOverride ?? recorder.phase;

  const stopAndReport = useCallback(async () => {
    const result = await recorder.stop();
    onStopped?.(result);
  }, [onStopped, recorder]);

  const toggle = useCallback(() => {
    if (recorder.phase === "recording") {
      void stopAndReport().catch(() => {});
    } else if (recorder.phase === "idle") {
      void recorder.start().catch(() => {});
    }
  }, [recorder, stopAndReport]);

  const label =
    phase === "recording"
      ? `Stop recording (${formatElapsed(recorder.elapsedMs)})`
      : phase === "processing"
        ? "Saving recording"
        : "Start recording";

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || phase === "processing"}
        title={disabled ? disabledTitle : label}
        aria-label={label}
        aria-pressed={phase === "recording"}
        className="relative flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        {phase === "processing" ? (
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"
          />
        ) : (
          <>
            {phase === "recording" && (
              <span
                aria-hidden="true"
                className="absolute inset-0 animate-ping rounded-full border-2 border-[var(--sc-danger)]"
              />
            )}
            {phase === "recording" ? (
              <span aria-hidden="true" className="h-4 w-4 rounded-sm bg-[var(--sc-danger)]" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="h-[20px] w-[20px]"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <path d="M12 19v3" />
              </svg>
            )}
          </>
        )}
      </button>
      {phase === "recording" && (
        <span className="text-xs tabular-nums text-[var(--sc-danger)]">
          {formatElapsed(recorder.elapsedMs)}
        </span>
      )}
      {capped && (
        <span role="status" className="text-xs text-text-2">
          Stopped at the 2-minute limit.
        </span>
      )}
    </div>
  );
}
