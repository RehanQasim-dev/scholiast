import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invokeCommand } from "../lib/ipc";
import { PREF_KEYS, getPref } from "../lib/store";
import { useVoiceRecorder } from "./useVoiceRecorder";

export type VoiceState = "idle" | "recording" | "transcribing" | "error";

export interface VoiceCommentOptions {
  /** 'add' inserts a fresh draft; 'edit' revises `original` via Gemini (§6.5.3). */
  kind?: "add" | "edit";
  /** Required for kind:'edit' — the note text being revised. */
  original?: string;
  /** Probe gates only when the mic will actually render. */
  enabled?: boolean;
  /**
   * Reserved for video-context callers (auto-pause on record). No-op here:
   * useVoiceRecorder (task-09) has no player coupling and the reader has no video.
   */
  pausePlayer?: boolean;
  onError?: (error: unknown) => void;
}

export interface VoiceComment {
  state: VoiceState;
  recording: boolean;
  elapsedMs: number;
  offline: boolean;
  /** Set when the mic must render disabled; also its tooltip/hint text. */
  disabledReason: string | null;
  start(): Promise<void>;
  /** Finishes the WAV and returns the transcribed/edited text. */
  stop(): Promise<string>;
  cancel(): Promise<void>;
}

interface CatalogEntry {
  id: string;
  installed: boolean;
}

interface Probe {
  localReady: boolean;
  activeLocalModel: string;
  groqConfigured: boolean;
  geminiConfigured: boolean;
}

let probePromise: Promise<Probe> | null = null;

/** Test seam: drop the session-cached capability probe (mirrors store.ts). */
export function resetVoiceAvailabilityForTests(): void {
  probePromise = null;
}

/**
 * Session-cached capability probe (task-30: cache result). list_stt_models is a
 * plain Result (raw rejection when whisper-rs isn't built in); secrets commands
 * return the standard envelope via invokeCommand.
 */
function probeAvailability(): Promise<Probe> {
  if (!probePromise) {
    probePromise = (async () => {
      const [models, groq, gemini] = await Promise.all([
        invokeCommand<{ models: CatalogEntry[] }>("list_stt_models").catch(
          () => null,
        ),
        invokeCommand<{ configured: boolean }>("get_secret_status", {
          name: "groq",
        }).catch(() => null),
        invokeCommand<{ configured: boolean }>("get_secret_status", {
          name: "gemini",
        }).catch(() => null),
      ]);
      const activeLocalModel = await getPref(PREF_KEYS.localModel, "");
      const installed = models?.models.filter((m) => m.installed) ?? [];
      const localReady =
        installed.length > 0 &&
        (activeLocalModel === "" ||
          installed.some((m) => m.id === activeLocalModel));
      return {
        localReady,
        activeLocalModel: installed.some((m) => m.id === activeLocalModel)
          ? activeLocalModel
          : "",
        groqConfigured: groq?.configured ?? false,
        geminiConfigured: gemini?.configured ?? false,
      };
    })();
    probePromise.catch(() => {
      probePromise = null;
    });
  }
  return probePromise;
}

/** Mirrors VoiceEditSheet's dual error shape (enveloped IpcCommandError vs raw SttError). */
function errorMessage(err: unknown): string {
  const raw = err as { error?: { message?: string }; kind?: string } | null;
  if (raw && typeof raw === "object") {
    if (raw.error?.message) return raw.error.message;
    if (typeof raw.kind === "string" && raw.kind) return raw.kind;
  }
  return err instanceof Error ? err.message : String(err);
}

export function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

const NEEDS_INTERNET = "Needs internet";
const SETUP_SPEECH = "Set up speech in Settings";
const SETUP_GEMINI = "Set up Gemini in Settings";

export function useVoiceComment(options: VoiceCommentOptions = {}): VoiceComment {
  const { kind = "add", original = "", enabled = true } = options;

  const [state, setState] = useState<VoiceState>("idle");
  const [offline, setOffline] = useState(
    typeof navigator === "undefined" ? false : !navigator.onLine,
  );
  const [probe, setProbe] = useState<Probe | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    probeAvailability().then(
      (result) => {
        if (!cancelled) setProbe(result);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const recorder = useVoiceRecorder({
    onError: (error) => optionsRef.current.onError?.(error),
  });

  const disabledReason = useMemo<string | null>(() => {
    if (!enabled || probe === null) return null;
    if (kind === "edit") {
      if (offline) return NEEDS_INTERNET;
      if (!probe.geminiConfigured) return SETUP_GEMINI;
      return null;
    }
    if (offline && !probe.localReady) return NEEDS_INTERNET;
    if (!probe.groqConfigured && !probe.geminiConfigured && !(offline && probe.localReady)) {
      return SETUP_SPEECH;
    }
    return null;
  }, [enabled, kind, offline, probe]);

  const transcribeWav = useCallback(
    async (path: string): Promise<string> => {
      const language = await getPref(PREF_KEYS.speechLanguage, "en");
      if (kind === "edit") {
        const edited = await invokeCommand<string>("stt_edit_text", {
          wavPath: path,
          original,
          promptOverride: null,
        });
        return edited.trim();
      }
      const liveOffline = typeof navigator !== "undefined" && !navigator.onLine;
      if (liveOffline && probe?.localReady) {
        return invokeCommand<string>("stt_local_transcribe", {
          wavPath: path,
          language,
          modelPath: probe.activeLocalModel || null,
        }).then((text) => text.trim());
      }
      const text = await invokeCommand<string>("stt_transcribe", {
        wavPath: path,
        language,
      });
      return text.trim();
    },
    [kind, original, probe],
  );

  const start = useCallback(async () => {
    if (disabledReason) throw new Error(disabledReason);
    setState("recording");
    try {
      await recorder.start();
    } catch (error) {
      setState("idle");
      throw error;
    }
  }, [disabledReason, recorder]);

  const stop = useCallback(async (): Promise<string> => {
    setState("transcribing");
    try {
      const { path } = await recorder.stop();
      const text = await transcribeWav(path);
      setState("idle");
      return text;
    } catch (error) {
      optionsRef.current.onError?.(error);
      setState("error");
      throw new Error(errorMessage(error));
    }
  }, [recorder, transcribeWav]);

  const cancel = useCallback(async () => {
    await recorder.cancel();
    setState("idle");
  }, [recorder]);

  return {
    state,
    recording: state === "recording",
    elapsedMs: recorder.elapsedMs,
    offline,
    disabledReason,
    start,
    stop,
    cancel,
  };
}

export interface VoiceEditController {
  /** Edit-comment prompt pref value; empty means Rust applies pref/default. */
  initialPrompt: string;
  micDisabledReason: string | null;
  /** Wrap VoiceEditSheet's onAccept through this to stamp <!--edited:N-->. */
  stampEdited(text: string): string;
}

/**
 * Integration helper for reader comment editing (task-31): renders
 * `<VoiceEditSheet initialPrompt={c.initialPrompt}
 * micDisabledReason={c.micDisabledReason} onAccept={(t)=>save(c.stampEdited(t))}
 * …/>`. Gemini-only per §6.5.3 — offline or without a Gemini key the sheet mic
 * is dimmed with the reason string.
 */
export function useVoiceEdit(): VoiceEditController {
  const [initialPrompt, setInitialPrompt] = useState("");
  const [probe, setProbe] = useState<Probe | null>(null);
  const [offline, setOffline] = useState(
    typeof navigator === "undefined" ? false : !navigator.onLine,
  );

  useEffect(() => {
    let cancelled = false;
    getPref(PREF_KEYS.editCommentPrompt, "").then((value) => {
      if (!cancelled) setInitialPrompt(value);
    });
    probeAvailability().then((result) => {
      if (!cancelled) setProbe(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const micDisabledReason = useMemo<string | null>(() => {
    if (!offline && probe === null) return null;
    if (offline) return NEEDS_INTERNET;
    if (!probe?.geminiConfigured) return SETUP_GEMINI;
    return null;
  }, [offline, probe]);

  const stampEdited = useCallback(
    (text: string) => `${text.trim()}<!--edited:${Date.now()}-->`,
    [],
  );

  return { initialPrompt, micDisabledReason, stampEdited };
}
