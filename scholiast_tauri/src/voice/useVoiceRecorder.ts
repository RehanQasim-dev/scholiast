import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import workletUrl from "./resample-worklet.js?url";

export type RecorderPhase = "idle" | "recording" | "processing";
export type StopReason = "user" | "cap" | "silence";

export interface StopResult {
  path: string;
  reason: StopReason;
}

export interface VoiceRecorder {
  phase: RecorderPhase;
  recording: boolean;
  elapsedMs: number;
  start(): Promise<void>;
  stop(): Promise<StopResult>;
  cancel(): Promise<void>;
}

export interface VoiceRecorderOptions {
  onStateChange?: (phase: RecorderPhase, meta: { reason?: StopReason }) => void;
  onError?: (error: unknown) => void;
  maxDurationMs?: number;
  /** Fires with the finalized WAV after an automatic stop (cap/silence). */
  onAutoStop?: (result: StopResult) => void;
}

const CHUNK_MS = 100;
const DEFAULT_MAX_DURATION_MS = 120_000;

interface ActiveRecording {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
  sessionId: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const BLOCK = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BLOCK));
  }
  return btoa(binary);
}

function teardown(recording: ActiveRecording) {
  recording.node.port.onmessage = null;
  recording.source.disconnect();
  recording.node.disconnect();
  for (const track of recording.stream.getTracks()) track.stop();
  void recording.context.close().catch(() => {});
}

// ---------------------------------------------------------------------------
// Silence detector — energy-based port of FUTO keyboard's `recordingJob` VAD
// state machine (`AudioRecognizer.kt`). FUTO drives its counters with a WebRTC
// GMM VAD on 480-sample (30 ms) frames plus an RMS gate; browsers have no GMM
// VAD without a wasm module, so each 30 ms frame is classified by RMS here.
// Time constants are FUTO's verbatim: 0.6 s startup blanking (mic-open thump),
// 0.01 RMS speech gate, 8 speech frames (~240 ms) to latch talking, 66 silent
// frames (~2 s) of hangover to auto-stop.
// ---------------------------------------------------------------------------

export const VAD_FRAME_SAMPLES = 480;
const VAD_ONSET_RMS = 0.01;
const VAD_STARTUP_BLANK_SAMPLES = 9600;
const VAD_ONSET_SPEECH_FRAMES = 8;
const VAD_HANGOVER_SILENCE_FRAMES = 66;

export interface SilenceDetector {
  feed(chunk: Int16Array): void;
  reset(): void;
}

function frameRms(frame: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i] / 32768;
    sum += s * s;
  }
  return frame.length > 0 ? Math.sqrt(sum / frame.length) : 0;
}

export function createSilenceDetector(onSilence: () => void): SilenceDetector {
  let carry: number[] = [];
  let totalSamples = 0;
  let consecSpeech = 0;
  let consecNonSpeech = 0;
  let hasTalked = false;
  let fired = false;

  return {
    feed(chunk: Int16Array) {
      if (fired) return;
      let chunkSum = 0;
      for (let i = 0; i < chunk.length; i++) {
        const s = chunk[i] / 32768;
        chunkSum += s * s;
        carry.push(chunk[i]);
      }
      const chunkRms = chunk.length > 0 ? Math.sqrt(chunkSum / chunk.length) : 0;
      totalSamples += chunk.length;
      while (carry.length >= VAD_FRAME_SAMPLES) {
        const frame = carry.slice(0, VAD_FRAME_SAMPLES);
        carry = carry.slice(VAD_FRAME_SAMPLES);
        if (frameRms(frame) > VAD_ONSET_RMS) {
          consecSpeech += 1;
          consecNonSpeech = 0;
        } else {
          consecNonSpeech += 1;
          consecSpeech = 0;
        }
      }
      const startPassed = totalSamples > VAD_STARTUP_BLANK_SAMPLES;
      if (!startPassed) {
        consecSpeech = 0;
        consecNonSpeech = 0;
      }
      if (
        startPassed &&
        !hasTalked &&
        (chunkRms > VAD_ONSET_RMS || consecSpeech > VAD_ONSET_SPEECH_FRAMES)
      ) {
        hasTalked = true;
      }
      if (hasTalked && consecNonSpeech > VAD_HANGOVER_SILENCE_FRAMES) {
        fired = true;
        onSilence();
      }
    },
    reset() {
      carry = [];
      totalSamples = 0;
      consecSpeech = 0;
      consecNonSpeech = 0;
      hasTalked = false;
      fired = false;
    },
  };
}

export function useVoiceRecorder(options: VoiceRecorderOptions = {}): VoiceRecorder {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const phaseRef = useRef<RecorderPhase>("idle");
  const activeRef = useRef<ActiveRecording | null>(null);
  const startedAtRef = useRef(0);
  const elapsedTimerRef = useRef<number | undefined>(undefined);
  const capTimerRef = useRef<number | undefined>(undefined);
  const cancelledRef = useRef(false);
  const vadRef = useRef<SilenceDetector | null>(null);

  const enterPhase = useCallback((next: RecorderPhase, meta: { reason?: StopReason } = {}) => {
    phaseRef.current = next;
    setPhase(next);
    optionsRef.current.onStateChange?.(next, meta);
  }, []);

  const clearTimers = useCallback(() => {
    window.clearInterval(elapsedTimerRef.current);
    window.clearTimeout(capTimerRef.current);
    elapsedTimerRef.current = undefined;
    capTimerRef.current = undefined;
  }, []);

  const sendChunk = useCallback((buffer: ArrayBuffer, sessionId: string) => {
    const pcmBase64 = bytesToBase64(new Uint8Array(buffer));
    void invoke("voice_append_chunk", { sessionId, pcmBase64 }).catch((error) => {
      optionsRef.current.onError?.(error);
    });
  }, []);

  const finish = useCallback(
    async (reason: StopReason): Promise<StopResult> => {
      const recording = activeRef.current;
      if (!recording) throw new Error("not recording");

      clearTimers();
      window.clearInterval(elapsedTimerRef.current);
      setElapsedMs(Date.now() - startedAtRef.current);
      recording.node.port.postMessage("flush");
      activeRef.current = null;
      teardown(recording);

      enterPhase("processing");
      const { sessionId } = recording;
      try {
        const path = await invoke<string>("voice_finish", { sessionId });
        if (cancelledRef.current) throw new Error("recording cancelled");
        enterPhase("idle", { reason });
        return { path, reason };
      } catch (error) {
        if (!cancelledRef.current) {
          optionsRef.current.onError?.(error);
          enterPhase("idle");
        }
        throw error;
      }
    },
    [clearTimers, enterPhase],
  );

  // Automatic stops (duration cap, silence VAD) finalize inside the recorder,
  // so the result is pushed out instead of returned to an awaiting stop().
  const finishAndReport = useCallback(
    (reason: StopReason) => {
      if (phaseRef.current !== "recording") return;
      void finish(reason).then(
        (result) => {
          try {
            optionsRef.current.onAutoStop?.(result);
          } catch (error) {
            optionsRef.current.onError?.(error);
          }
        },
        () => {},
      );
    },
    [finish],
  );

  const handleSilence = useCallback(() => {
    finishAndReport("silence");
  }, [finishAndReport]);

  const start = useCallback(async () => {
    if (phaseRef.current !== "idle") throw new Error("already recording or processing");
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
      });
      context = new AudioContext();
      await context.audioWorklet.addModule(workletUrl);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "resample-worklet", {
        numberOfOutputs: 0,
      });

      const session: ActiveRecording = {
        stream,
        context,
        source,
        node,
        sessionId: "",
      };
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (session.sessionId) {
          sendChunk(event.data, session.sessionId);
          vadRef.current?.feed(new Int16Array(event.data));
        }
      };
      source.connect(node);
      session.sessionId = await invoke<string>("voice_begin");
      activeRef.current = session;
      cancelledRef.current = false;
      vadRef.current = createSilenceDetector(handleSilence);

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, CHUNK_MS);
      const maxDurationMs = optionsRef.current.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      capTimerRef.current = window.setTimeout(() => {
        finishAndReport("cap");
      }, maxDurationMs);

      enterPhase("recording");
    } catch (error) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (context) void context.close().catch(() => {});
      optionsRef.current.onError?.(error);
      throw error;
    }
  }, [enterPhase, finishAndReport, handleSilence, sendChunk]);

  const stop = useCallback((): Promise<StopResult> => {
    if (phaseRef.current !== "recording") return Promise.reject(new Error("not recording"));
    return finish("user");
  }, [finish]);

  const cancel = useCallback(async () => {
    if (phaseRef.current === "idle") return;
    cancelledRef.current = true;
    clearTimers();
    const recording = activeRef.current;
    activeRef.current = null;
    if (recording) teardown(recording);
    setElapsedMs(0);
    enterPhase("idle");
    if (recording) {
      await invoke("voice_cancel", { sessionId: recording.sessionId }).catch(() => {});
    }
  }, [clearTimers, enterPhase]);

  useEffect(
    () => () => {
      const recording = activeRef.current;
      activeRef.current = null;
      if (!recording) return;
      window.clearInterval(elapsedTimerRef.current);
      window.clearTimeout(capTimerRef.current);
      teardown(recording);
      void invoke("voice_cancel", { sessionId: recording.sessionId }).catch(() => {});
    },
    [],
  );

  return {
    phase,
    recording: phase === "recording",
    elapsedMs,
    start,
    stop,
    cancel,
  };
}
