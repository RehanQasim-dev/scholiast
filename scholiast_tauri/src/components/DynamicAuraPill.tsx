import { useEffect, useRef, useState } from "react";
import { toast } from "./Toast";
import { useVoiceComment } from "../voice/useVoiceComment";

export interface DynamicAuraPillProps {
  onSave: (text: string) => void;
  onCancel: () => void;
}

const SILENCE_THRESHOLD_RMS = 0.015;
const SILENCE_DURATION_MS = 2000; // 2 seconds VAD

export default function DynamicAuraPill({ onSave, onCancel }: DynamicAuraPillProps) {
  const voice = useVoiceComment({ kind: "add", enabled: true });
  const [levels, setLevels] = useState<number[]>([12, 18, 14, 8]);
  const [isProcessing, setIsProcessing] = useState(false);
  const silenceTimerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start voice recording and audio analyser on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await voice.start();
        if (cancelled) return;

        // Setup live Web Audio Analyser for the 4-bar frequency visualizer
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        let silenceStart: number | null = null;

        const updateLevels = () => {
          if (cancelled || isProcessing) return;

          analyser.getByteFrequencyData(dataArray);

          // Calculate average energy / RMS
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const normalized = avg / 255;

          // 4 distinct frequency bar bands
          const b1 = Math.max(6, Math.min(24, Math.round((dataArray[1] / 255) * 24)));
          const b2 = Math.max(8, Math.min(28, Math.round((dataArray[3] / 255) * 28)));
          const b3 = Math.max(6, Math.min(24, Math.round((dataArray[6] / 255) * 24)));
          const b4 = Math.max(4, Math.min(18, Math.round((dataArray[10] / 255) * 18)));
          setLevels([b1, b2, b3, b4]);

          // 2-second VAD silence detection
          if (normalized < SILENCE_THRESHOLD_RMS) {
            if (silenceStart === null) {
              silenceStart = Date.now();
            } else if (Date.now() - silenceStart > SILENCE_DURATION_MS) {
              // 2.0 seconds of silence sustained -> Auto-commit!
              void commitRecording();
              return;
            }
          } else {
            silenceStart = null;
          }

          animFrameRef.current = requestAnimationFrame(updateLevels);
        };

        animFrameRef.current = requestAnimationFrame(updateLevels);
      } catch {
        toast("Microphone unavailable");
        onCancel();
      }
    }

    void init();

    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  async function commitRecording() {
    if (isProcessing) return;
    setIsProcessing(true);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    try {
      const transcript = await voice.stop();
      if (transcript && transcript.trim()) {
        const text = transcript.trim();
        onSave(text);
        toast(`Saved: "${text.length > 25 ? text.slice(0, 25) + '…' : text}"`);
      } else {
        onCancel();
      }
    } catch {
      toast("Transcription failed");
      onCancel();
    }
  }

  return (
    <div
      role="region"
      aria-label="Voice recording"
      className="flex items-center gap-3 rounded-full border border-hairline bg-surface/90 px-4 py-2 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
    >
      {isProcessing ? (
        /* Morph to fluid shimmering gradient pulse line while Whisper transcribes at -O3 */
        <div className="flex items-center gap-2 px-2 py-1">
          <div className="relative h-2 w-28 overflow-hidden rounded-full bg-accent/20">
            <div className="absolute inset-y-0 w-12 animate-[shimmer_1.2s_infinite] bg-gradient-to-r from-transparent via-accent to-transparent" />
          </div>
          <span className="text-[11px] font-medium text-text-3">Transcribing…</span>
        </div>
      ) : (
        /* 4 vertical glowing terminal green frequency bars bouncing with voice decibels */
        <button
          type="button"
          onClick={() => void commitRecording()}
          title="Tap to finish voice note"
          className="flex items-center gap-2.5 focus:outline-none cursor-pointer"
        >
          <div className="flex h-6 items-center gap-1">
            {levels.map((height, i) => (
              <span
                key={i}
                style={{ height: `${height}px` }}
                className="w-1 rounded-full bg-accent transition-all duration-75 shadow-[0_0_8px_rgba(15,110,86,0.6)]"
              />
            ))}
          </div>
          <span className="text-xs font-medium text-text-2">
            Listening… <span className="text-[10px] text-text-3">(Tap or pause to save)</span>
          </span>
        </button>
      )}

      {/* Cancel button */}
      <button
        type="button"
        onClick={async () => {
          await voice.cancel();
          onCancel();
        }}
        aria-label="Cancel recording"
        className="flex h-5 w-5 items-center justify-center rounded-full text-text-3 hover:bg-elevated hover:text-text transition-colors"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
