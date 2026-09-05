/*
 * Swatch voice-note flow (reader selection menu).
 *
 * Tap mic → the strip morphs into a live wave bar (tap again to stop) →
 * transcribe → review popup → Save. Errors (mic denied, missing engine,
 * empty transcript) render inline with a way back instead of vanishing.
 */

import { useEffect, useRef, useState } from "react";
import {
  formatElapsedMs,
  micErrorMessage,
  useVoiceComment,
  voiceFailureMessage,
} from "../voice/useVoiceComment";

interface SwatchVoiceFlowProps {
  onSave: (text: string) => void;
  onBack: () => void;
}

type FlowPhase = "recording" | "transcribing" | "review" | "error";

export default function SwatchVoiceFlow({ onSave, onBack }: SwatchVoiceFlowProps) {
  const voice = useVoiceComment({ kind: "add", enabled: true });
  const [phase, setPhase] = useState<FlowPhase>("recording");
  const [levels, setLevels] = useState<number[]>([10, 14, 12, 8]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);

  const stopAnalyser = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  const startAnalyser = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const updateLevels = () => {
      analyser.getByteFrequencyData(dataArray);
      setLevels([
        Math.max(6, Math.min(24, Math.round((dataArray[1] / 255) * 24))),
        Math.max(8, Math.min(28, Math.round((dataArray[3] / 255) * 28))),
        Math.max(6, Math.min(24, Math.round((dataArray[6] / 255) * 24))),
        Math.max(4, Math.min(18, Math.round((dataArray[10] / 255) * 18))),
      ]);
      animFrameRef.current = requestAnimationFrame(updateLevels);
    };
    animFrameRef.current = requestAnimationFrame(updateLevels);
  };

  const fail = (err: unknown, fallback: string) => {
    stopAnalyser();
    setError(voiceFailureMessage(err, fallback));
    setPhase("error");
  };

  const failMic = (err: unknown) => {
    stopAnalyser();
    setError(micErrorMessage(err, "Microphone unavailable"));
    setPhase("error");
  };

  // Start recording on mount; a refusal (mic denied, missing engine) lands
  // in the inline error state with its reason intact. Visualizer failure
  // never blocks recording — the bars just stay static.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await voice.start();
        if (cancelled) return;
        await startAnalyser().catch(() => {});
      } catch (err) {
        if (!cancelled) failMic(err);
      }
    })();
    return () => {
      cancelled = true;
      stopAnalyser();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = async () => {
    if (stoppingRef.current || phase !== "recording") return;
    stoppingRef.current = true;
    stopAnalyser();
    setPhase("transcribing");
    try {
      const text = (await voice.stop()).trim();
      if (!text) {
        setError("Nothing heard — try again");
        setPhase("error");
      } else {
        setDraft(text);
        setPhase("review");
      }
    } catch (err) {
      fail(err, "Transcription failed");
    } finally {
      stoppingRef.current = false;
    }
  };

  const restart = async () => {
    setError(null);
    setPhase("recording");
    try {
      await voice.start();
      await startAnalyser().catch(() => {});
    } catch (err) {
      failMic(err);
    }
  };

  const cancelRecording = async () => {
    stopAnalyser();
    try {
      await voice.cancel();
    } catch {
      /* already stopped — just go back */
    }
    onBack();
  };

  if (phase === "review") {
    return (
      <div
        data-testid="swatch-voice-review"
        role="dialog"
        className="w-72 rounded-xl border border-hairline bg-surface p-2.5 shadow-2xl backdrop-blur-md"
      >
        <p className="mb-1.5 text-xs font-medium text-text-2">Review voice note</p>
        <textarea
          autoFocus
          aria-label="Review voice note"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full resize-y rounded-md border border-hairline bg-base px-2 py-1.5 text-sm leading-relaxed text-text outline-none focus:border-accent"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="swatch-voice-retry"
              onClick={() => void restart()}
              className="rounded px-2 py-1 text-xs text-text-2 hover:bg-elevated hover:text-text"
            >
              Re-record
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded px-2 py-1 text-xs text-text-2 hover:bg-elevated hover:text-text"
            >
              Cancel
            </button>
          </div>
          <button
            type="button"
            data-testid="swatch-voice-save"
            disabled={!draft.trim()}
            onClick={() => onSave(draft.trim())}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-[var(--sc-accent-text)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div
        data-testid="swatch-voice-error"
        role="alert"
        className="w-72 rounded-xl border border-hairline bg-surface p-2.5 shadow-2xl backdrop-blur-md"
      >
        <p className="text-xs leading-relaxed text-text-2">{error}</p>
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onBack}
            className="rounded px-2 py-1 text-xs text-text-2 hover:bg-elevated hover:text-text"
          >
            Back
          </button>
          <button
            type="button"
            data-testid="swatch-voice-retry"
            onClick={() => void restart()}
            className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-[var(--sc-accent-text)] hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (phase === "transcribing") {
    return (
      <div
        data-testid="swatch-voice-transcribing"
        className="flex items-center gap-2 rounded-full border border-hairline bg-surface/90 px-4 py-2.5 shadow-2xl backdrop-blur-md"
      >
        <div className="relative h-2 w-28 overflow-hidden rounded-full bg-accent/20">
          <div className="absolute inset-y-0 w-12 animate-[shimmer_1.2s_infinite] bg-gradient-to-r from-transparent via-accent to-transparent" />
        </div>
        <span className="text-[11px] font-medium text-text-3">Transcribing…</span>
      </div>
    );
  }

  return (
    <div
      data-testid="swatch-voice-bar"
      role="region"
      aria-label="Voice recording — tap to stop"
      className="flex items-center gap-3 rounded-full border border-hairline bg-surface/90 py-1.5 pl-4 pr-2 shadow-2xl backdrop-blur-md"
    >
      <button
        type="button"
        onClick={() => void finish()}
        title="Tap to stop and review"
        className="flex cursor-pointer items-center gap-2.5 focus:outline-none"
      >
        <span className="flex h-6 items-center gap-1" aria-hidden="true">
          {levels.map((height, i) => (
            <span
              key={i}
              style={{ height: `${height}px` }}
              className="w-1 rounded-full bg-accent transition-all duration-75 shadow-[0_0_8px_rgba(15,110,86,0.6)]"
            />
          ))}
        </span>
        <span className="text-xs font-medium text-text-2 tabular-nums">
          {formatElapsedMs(voice.elapsedMs)}
          <span className="text-[10px] text-text-3"> · Tap to stop</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => void cancelRecording()}
        aria-label="Cancel recording"
        className="flex h-6 w-6 items-center justify-center rounded-full text-text-3 hover:bg-elevated hover:text-text transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
