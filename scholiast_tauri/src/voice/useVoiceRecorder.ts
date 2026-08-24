import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import workletUrl from "./resample-worklet.js?url";

export type RecorderPhase = "idle" | "recording" | "processing";
export type StopReason = "user" | "cap";

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
        if (session.sessionId) sendChunk(event.data, session.sessionId);
      };
      source.connect(node);
      session.sessionId = await invoke<string>("voice_begin");
      activeRef.current = session;
      cancelledRef.current = false;

      startedAtRef.current = Date.now();
      setElapsedMs(0);
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, CHUNK_MS);
      const maxDurationMs = optionsRef.current.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
      capTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current === "recording") {
          void finish("cap").catch(() => {});
        }
      }, maxDurationMs);

      enterPhase("recording");
    } catch (error) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (context) void context.close().catch(() => {});
      optionsRef.current.onError?.(error);
      throw error;
    }
  }, [enterPhase, finish, sendChunk]);

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
