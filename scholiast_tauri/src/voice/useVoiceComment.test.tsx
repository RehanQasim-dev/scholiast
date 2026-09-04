import { act, renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  resetVoiceAvailabilityForTests,
  useVoiceComment,
} from "./useVoiceComment";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

interface FakeStopResult {
  path: string;
  reason: string;
}

let stopQueue: FakeStopResult[] = [];

interface RecorderLike {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

let activeRecorder: RecorderLike | null = null;

vi.mock("./useVoiceRecorder", () => ({
  useVoiceRecorder: () => makeFakeRecorder(),
}));

function makeFakeRecorder(): RecorderLike {
  if (activeRecorder) return activeRecorder;
  const recorder: RecorderLike = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {
      const result = stopQueue.shift();
      if (!result) throw new Error("no queued stop result");
      return result;
    }),
    cancel: vi.fn(async () => {}),
  };
  activeRecorder = recorder;
  return recorder;
}

vi.mock("../lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/store")>();
  return { ...actual, getPref: vi.fn() };
});

import { PREF_KEYS, getPref } from "../lib/store";

const getPrefMock = vi.mocked(getPref);

let groqConfigured = false;
let geminiConfigured = false;
let localModels: Array<{ id: string; installed: boolean }> = [];
let localEngineBuiltIn = true;
let activeModelPref = "auto";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

beforeEach(() => {
  vi.clearAllMocks();
  stopQueue = [];
  activeRecorder = null;
  groqConfigured = true;
  geminiConfigured = false;
  localModels = [];
  localEngineBuiltIn = true;
  activeModelPref = "auto";
  setOnline(true);
  resetVoiceAvailabilityForTests();

  getPrefMock.mockImplementation(async (key, fallback) => {
    if (key === PREF_KEYS.speechLanguage) return "en";
    if (key === PREF_KEYS.localModel) return "";
    if (key === PREF_KEYS.activeModel) return activeModelPref;
    return fallback;
  });

  invokeMock.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "stt_local_engine_available") return localEngineBuiltIn;
    if (command === "list_stt_models")
      return { models: localModels.map((id) => ({ ...id })) };
    if (command === "get_secret_status") {
      const name = (args as { name: string }).name;
      return {
        ok: true,
        data: { configured: name === "groq" ? groqConfigured : geminiConfigured },
      };
    }
    if (command === "stt_transcribe") return { ok: true, data: "spoken draft" };
    if (command === "stt_local_transcribe")
      return { ok: true, data: "local draft" };
    if (command === "stt_edit_text") return { ok: true, data: "edited text" };
    return { ok: true, data: null };
  });
});

describe("useVoiceComment", () => {
  test("add flow online: start records, stop transcribes verbatim via stt_transcribe", async () => {
    const { result } = renderHook(() =>
      useVoiceComment({ kind: "add" }),
    );

    await waitFor(() => expect(result.current.disabledReason).toBeNull());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.state).toBe("recording");
    expect(activeRecorder?.start).toHaveBeenCalledTimes(1);

    stopQueue.push({ path: "/voice/s1.wav", reason: "user" });
    let text = "";
    await act(async () => {
      text = await result.current.stop();
    });

    expect(text).toBe("spoken draft");
    expect(invokeMock).toHaveBeenCalledWith("stt_transcribe", {
      wavPath: "/voice/s1.wav",
      language: "en",
    });
    expect(result.current.state).toBe("idle");
  });

  test("cancel drops the session without transcribing", async () => {
    const { result } = renderHook(() => useVoiceComment({ kind: "add" }));
    await waitFor(() => expect(result.current.disabledReason).toBeNull());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.cancel();
    });

    expect(activeRecorder?.cancel).toHaveBeenCalled();
    expect(activeRecorder?.stop).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  test("offline with an installed local model routes stt_local_transcribe and stays enabled", async () => {
    setOnline(false);
    localModels = [{ id: "tiny_en", installed: true }];
    const { result } = renderHook(() => useVoiceComment({ kind: "add" }));

    await waitFor(() => expect(result.current.offline).toBe(true));
    await waitFor(() => expect(result.current.disabledReason).toBeNull());

    stopQueue.push({ path: "/voice/s2.wav", reason: "user" });
    let text = "";
    await act(async () => {
      text = await result.current.stop();
    });

    expect(text).toBe("local draft");
    expect(invokeMock).toHaveBeenCalledWith("stt_local_transcribe", {
      wavPath: "/voice/s2.wav",
      language: "en",
      modelPath: null,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("stt_transcribe", expect.anything());
  });

  test("online with an installed local model and no cloud keys stays enabled and routes stt_local_transcribe", async () => {
    setOnline(true);
    groqConfigured = false;
    geminiConfigured = false;
    localModels = [{ id: "tiny_en", installed: true }];
    const { result } = renderHook(() => useVoiceComment({ kind: "add" }));

    await waitFor(() => expect(result.current.disabledReason).toBeNull());

    stopQueue.push({ path: "/voice/s_local_online.wav", reason: "user" });
    let text = "";
    await act(async () => {
      text = await result.current.stop();
    });

    expect(text).toBe("local draft");
    expect(invokeMock).toHaveBeenCalledWith("stt_local_transcribe", {
      wavPath: "/voice/s_local_online.wav",
      language: "en",
      modelPath: null,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("stt_transcribe", expect.anything());
  });

  test("offline without a local model dims the mic with 'Needs internet'", async () => {
    setOnline(false);
    const { result } = renderHook(() => useVoiceComment({ kind: "add" }));

    await waitFor(() => expect(result.current.disabledReason).toBe("Needs internet"));

    await act(async () => {
      await expect(result.current.start()).rejects.toThrow("Needs internet");
    });
    expect(activeRecorder?.start).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });

  test("transcription failure surfaces state 'error' and rethrows the message", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_stt_models") return { models: [] };
      if (command === "get_secret_status") return { ok: true, data: { configured: true } };
      if (command === "stt_transcribe")
        throw { error: { kind: "network", message: "boom" } };
      return { ok: true, data: null };
    });
    const { result } = renderHook(() => useVoiceComment({ kind: "add" }));
    await waitFor(() => expect(result.current.disabledReason).toBeNull());

    stopQueue.push({ path: "/voice/s3.wav", reason: "user" });
    await act(async () => {
      await expect(result.current.stop()).rejects.toThrow("boom");
    });

    expect(result.current.state).toBe("error");
  });

  test("edit kind revises the original via Gemini's stt_edit_text", async () => {
    geminiConfigured = true;
    groqConfigured = false;
    const { result } = renderHook(() =>
      useVoiceComment({ kind: "edit", original: "orig note" }),
    );

    stopQueue.push({ path: "/voice/s4.wav", reason: "user" });
    let text = "";
    await act(async () => {
      text = await result.current.stop();
    });

    expect(text).toBe("edited text");
    expect(invokeMock).toHaveBeenCalledWith("stt_edit_text", {
      wavPath: "/voice/s4.wav",
      original: "orig note",
      promptOverride: null,
    });
  });

  test("disabled hook skips capability probes entirely", async () => {
    renderHook(() => useVoiceComment({ kind: "add", enabled: false }));
    await act(async () => {});
    expect(invokeMock).not.toHaveBeenCalledWith("list_stt_models");
    expect(invokeMock).not.toHaveBeenCalledWith("get_secret_status", expect.anything());
  });

  test("model files without the engine disable the mic with a rebuild reason (no silent record-to-failure)", async () => {
    setOnline(true);
    groqConfigured = false;
    geminiConfigured = false;
    localModels = [{ id: "tiny_en", installed: true }];
    localEngineBuiltIn = false;
    const { result } = renderHook(() => useVoiceComment({ kind: "add" }));

    await waitFor(() =>
      expect(result.current.disabledReason).toBe(
        "Local engine missing — rebuild app with local-stt",
      ),
    );
    await act(async () => {
      await expect(result.current.start()).rejects.toThrow("Local engine missing");
    });
    expect(activeRecorder?.start).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith("stt_local_transcribe", expect.anything());
  });

  test("explicit local selection without the engine stays disabled even with cloud keys (no silent cloud fallback)", async () => {
    setOnline(true);
    groqConfigured = true;
    localModels = [{ id: "tiny_en", installed: true }];
    localEngineBuiltIn = false;
    activeModelPref = "local:tiny_en";
    const { result } = renderHook(() => useVoiceComment({ kind: "add" }));

    await waitFor(() =>
      expect(result.current.disabledReason).toBe(
        "Local engine missing — rebuild app with local-stt",
      ),
    );
  });

  test("model files with the engine still route local (regression)", async () => {
    setOnline(true);
    groqConfigured = false;
    geminiConfigured = false;
    localModels = [{ id: "tiny_en", installed: true }];
    localEngineBuiltIn = true;
    const { result } = renderHook(() => useVoiceComment({ kind: "add" }));

    await waitFor(() => expect(result.current.disabledReason).toBeNull());
    stopQueue.push({ path: "/voice/s5.wav", reason: "user" });
    let text = "";
    await act(async () => {
      text = await result.current.stop();
    });
    expect(text).toBe("local draft");
  });
});
