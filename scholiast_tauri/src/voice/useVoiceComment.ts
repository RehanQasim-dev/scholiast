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
  /** Model files present even when the engine isn't compiled in. */
  localModelsInstalled: boolean;
  /** Active local model id ("" when none matches installed). */
  activeLocalModel: string;
  /** Explicit `local:<id>` selection in stt.active_model, if any. */
  explicitLocalModel: string | null;
  /** Whisper engine compiled into this build. */
  localEngine: boolean;
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
      const [models, groq, gemini, engine] = await Promise.all([
        invokeCommand<{ models: CatalogEntry[] }>("list_stt_models").catch(
          () => null,
        ),
        invokeCommand<{ configured: boolean }>("get_secret_status", {
          name: "groq",
        }).catch(() => null),
        invokeCommand<{ configured: boolean }>("get_secret_status", {
          name: "gemini",
        }).catch(() => null),
        // Ungated command: false on builds without the whisper engine, so a
        // merely-installed model file can never report "ready" there.
        invokeCommand<boolean>("stt_local_engine_available").catch(() => false),
      ]);
      const activeLocalModel = await getPref(PREF_KEYS.localModel, "");
      const explicitLocalRaw = await getPref<string>(PREF_KEYS.activeModel, "auto");
      const explicitLocalModel =
        typeof explicitLocalRaw === "string" && explicitLocalRaw.startsWith("local:")
          ? explicitLocalRaw.slice("local:".length)
          : null;
      const installed = models?.models.filter((m) => m.installed) ?? [];
      const localEngine = engine === true;
      const localReady =
        localEngine &&
        installed.length > 0 &&
        (activeLocalModel === "" ||
          installed.some((m) => m.id === activeLocalModel));
      return {
        localReady,
        localModelsInstalled: installed.length > 0,
        activeLocalModel: installed.some((m) => m.id === activeLocalModel)
          ? activeLocalModel
          : "",
        explicitLocalModel,
        localEngine,
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
function errorMessage(err: unknown): string {  const raw = err as { error?: { message?: string }; kind?: string } | null;
  if (raw && typeof raw === "object") {
    if (raw.error?.message) return raw.error.message;
    if (typeof raw.kind === "string" && raw.kind) return raw.kind;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Toast text for a voice-stop failure that keeps the backend reason instead
 * of swallowing it (an opaque "failed" toast cost a full debug cycle: model
 * installed but engine missing looks identical to a network error).
 */
export function voiceFailureMessage(err: unknown, fallback: string): string {
  const detail = (err instanceof Error ? err.message : String(err ?? "")).trim();
  if (!detail) return fallback;
  const short = detail.length > 90 ? `${detail.slice(0, 90)}…` : detail;
  return `${fallback}: ${short}`;
}

export function formatElapsedMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/** Split a personal-dictionary pref value (one entry per line) into words. */
export function parseGlossary(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.trim().replace(/\0/g, ""))
    .filter((line) => line.length > 0);
}

/**
 * FUTO glossary prompt (`MultiModelRunner`: `"(Glossary: a, b)"`, "" when
 * empty) fed to whisper as `initial_prompt` to bias decoding toward the
 * user's words. Null when empty so the Rust side keeps whisper's default.
 */
export function formatGlossaryPrompt(words: string[]): string | null {
  const clean = words
    .map((word) => word.trim().replace(/\0/g, ""))
    .filter((word) => word.length > 0);
  if (clean.length === 0) return null;
  return `(Glossary: ${clean.join(", ")})`;
}

const NEEDS_INTERNET = "Needs internet";
const SETUP_SPEECH = "Set up speech in Settings";
const SETUP_GEMINI = "Set up Gemini in Settings";
/** Engine missing but the user explicitly chose local: never silently fall
 * back to cloud (privacy) — tell them to rebuild instead. */
const NEEDS_LOCAL_BUILD = "Local engine missing — rebuild app with local-stt";

export function useVoiceComment(options: VoiceCommentOptions = {}): VoiceComment {
  const { kind = "add", original = "", enabled = true } = options;

  const [state, setState] = useState<VoiceState>("idle");
  const [offline, setOffline] = useState(
    typeof navigator === "undefined" ? false : !navigator.onLine,
  );
  const [probe, setProbe] = useState<Probe | null>(null);

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Transcription of an automatically stopped recording (cap/silence): the
  // recorder finalizes internally, so there is no awaiting stop() — the text
  // is produced in onAutoStop below and a late stop() picks it up instead of
  // failing.
  const autoTranscribeRef = useRef<Promise<string> | null>(null);

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
    // Auto-stop delivery is wired after transcribeWav below (it must exist first).
    onAutoStop: (result) => void handleAutoStop(result),
  });

  const disabledReason = useMemo<string | null>(() => {
    if (!enabled || probe === null) return null;
    if (kind === "edit") {
      if (offline) return NEEDS_INTERNET;
      if (!probe.geminiConfigured) return SETUP_GEMINI;
      return null;
    }
    // If a local model is installed & ready, local STT is always available (online or offline)!
    if (probe.localReady) return null;

    // Explicit local choice without the compiled engine: never silently fall
    // back to cloud (privacy) — recording would only fail at transcribe time.
    if (!probe.localEngine && probe.explicitLocalModel !== null) {
      return NEEDS_LOCAL_BUILD;
    }

    // Model files present but no engine and no usable cloud path: the missing
    // engine (not the network) is the actionable blocker.
    if (
      !probe.localEngine &&
      probe.localModelsInstalled &&
      (offline || (!probe.groqConfigured && !probe.geminiConfigured))
    ) {
      return NEEDS_LOCAL_BUILD;
    }

    // Otherwise, cloud STT is required:
    if (offline) return NEEDS_INTERNET;
    if (!probe.groqConfigured && !probe.geminiConfigured) {
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

      const activeModel = await getPref<string>(PREF_KEYS.activeModel, "auto");
      const liveOffline = typeof navigator !== "undefined" && !navigator.onLine;

      // Mid-session switch to an explicit local model on an engine-less
      // build: the cached probe can't see it coming, so refuse loudly here
      // instead of failing inside the missing command.
      if (activeModel.startsWith("local:") && probe && !probe.localEngine) {
        throw new Error(NEEDS_LOCAL_BUILD);
      }

      // Use local STT if explicitly selected OR if offline OR if cloud keys are not configured
      const useLocal =
        activeModel.startsWith("local:") ||
        (probe?.localReady && (liveOffline || (!probe.groqConfigured && !probe.geminiConfigured)));

      if (useLocal && probe?.localReady) {
        const customModel = activeModel.startsWith("local:")
          ? activeModel.slice("local:".length)
          : probe.activeLocalModel || null;
        const glossaryRaw = await getPref(PREF_KEYS.sttGlossary, "");
        return invokeCommand<string>("stt_local_transcribe", {
          wavPath: path,
          language,
          modelPath: customModel,
          initialPrompt: formatGlossaryPrompt(parseGlossary(glossaryRaw)),
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

  const handleAutoStop = useCallback(
    (result: { path: string }) => {
      autoTranscribeRef.current = (async () => {
        setState("transcribing");
        try {
          const text = await transcribeWav(result.path);
          setState("idle");
          return text;
        } catch (error) {
          optionsRef.current.onError?.(error);
          setState("error");
          throw error;
        }
      })();
      // A UI that never calls stop() must not cause an unhandled rejection.
      autoTranscribeRef.current.catch(() => {});
    },
    [transcribeWav],
  );

  const start = useCallback(async () => {
    if (disabledReason) throw new Error(disabledReason);
    autoTranscribeRef.current = null;
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
      let path: string;
      try {
        ({ path } = await recorder.stop());
        autoTranscribeRef.current = null;
      } catch {
        // The recorder already finalized itself (silence/cap auto-stop), so
        // there is nothing left to stop — pick up that transcription. A
        // transcription failure below must surface verbatim, never as this.
        const pending = autoTranscribeRef.current;
        if (!pending) throw new Error("not recording");
        return pending.then(
          (text) => {
            setState("idle");
            return text;
          },
          (error) => {
            setState("error");
            throw new Error(errorMessage(error));
          },
        );
      }
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
    autoTranscribeRef.current = null;
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
