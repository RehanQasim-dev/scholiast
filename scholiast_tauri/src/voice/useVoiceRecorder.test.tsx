import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import { useVoiceRecorder } from "./useVoiceRecorder";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage = vi.fn();
}

class FakeWorkletNode {
  static instances: FakeWorkletNode[] = [];
  port = new FakePort();

  constructor() {
    FakeWorkletNode.instances.push(this);
  }

  disconnect() {}
}

class FakeAudioContext {
  sampleRate = 48000;
  audioWorklet = { addModule: vi.fn(async () => {}) };
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  close = vi.fn(async () => {});
}

const getUserMedia = vi.fn();
const trackStop = vi.fn();

function lastNode(): FakeWorkletNode {
  const node = FakeWorkletNode.instances.at(-1);
  if (!node) throw new Error("no worklet node created");
  return node;
}

function base64Of(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("useVoiceRecorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWorkletNode.instances = [];
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "voice_begin") return "session-1";
      if (command === "voice_finish") return "/data/voice/session-1.wav";
      return undefined;
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("start requests the mic and opens a backend session", async () => {
    const onStateChange = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onStateChange }));

    await act(async () => {
      await result.current.start();
    });

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true },
    });
    expect(invokeMock).toHaveBeenCalledWith("voice_begin");
    expect(result.current.recording).toBe(true);
    expect(result.current.phase).toBe("recording");
    expect(onStateChange).toHaveBeenCalledWith("recording", {});
  });

  test("worklet chunks ship as base64 append invokes", async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    const payload = new Int16Array([256, -256, 12345]);
    await act(async () => {
      lastNode().port.onmessage?.({ data: payload.buffer });
    });

    expect(invokeMock).toHaveBeenCalledWith("voice_append_chunk", {
      sessionId: "session-1",
      pcmBase64: base64Of(new Uint8Array(payload.buffer)),
    });
  });

  test("stop tears down, finalizes the session, and returns the wav path", async () => {
    const onStateChange = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onStateChange }));
    await act(async () => {
      await result.current.start();
    });

    let stopped: { path: string; reason: string } | undefined;
    await act(async () => {
      stopped = await result.current.stop();
    });

    expect(lastNode().port.postMessage).toHaveBeenCalledWith("flush");
    expect(invokeMock).toHaveBeenCalledWith("voice_finish", { sessionId: "session-1" });
    expect(stopped).toEqual({ path: "/data/voice/session-1.wav", reason: "user" });
    expect(result.current.recording).toBe(false);
    expect(result.current.phase).toBe("idle");
    expect(trackStop).toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalledWith("idle", { reason: "user" });
  });

  test("cancel drops the session without producing a file", async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.cancel();
    });

    expect(invokeMock).toHaveBeenCalledWith("voice_cancel", { sessionId: "session-1" });
    expect(invokeMock).not.toHaveBeenCalledWith("voice_finish", expect.anything());
    expect(result.current.recording).toBe(false);
    expect(trackStop).toHaveBeenCalled();
  });

  test("hard-caps recording at 120 seconds with reason 'cap'", async () => {
    vi.useFakeTimers();
    const onStateChange = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onStateChange }));

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_500);
    });

    expect(invokeMock).toHaveBeenCalledWith("voice_finish", { sessionId: "session-1" });
    expect(result.current.phase).toBe("idle");
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(119_500);
    expect(onStateChange).toHaveBeenCalledWith("idle", { reason: "cap" });
  });
});
