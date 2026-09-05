import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import SpeechSection from "./SpeechSection";
import { PREF_KEYS, setPrefsStoreForTests } from "../../lib/store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function backend() {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key: string) => data.get(key),
    set: async (key: string, value: unknown) => {
      data.set(key, String(value));
    },
  };
}

function renderSpeechSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SpeechSection />
    </QueryClientProvider>,
  );
}

describe("SpeechSection", () => {
  let store: ReturnType<typeof backend>;
  let groqConfigured = true;
  let geminiConfigured = true;
  let engineAvailable = true;

  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockReset();
    store = backend();
    setPrefsStoreForTests(store);
    groqConfigured = true;
    geminiConfigured = true;
    engineAvailable = true;
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "get_secret_status") {
        const name = (args as { name: string } | undefined)?.name;
        return {
          ok: true,
          data: {
            configured: name === "gemini" ? geminiConfigured : groqConfigured,
          },
        };
      }
      if (command === "stt_local_engine_available") {
        return engineAvailable;
      }
      if (command === "list_stt_models") {
        return {
          ok: true,
          data: {
            models: [
              {
                id: "ggml-tiny.bin",
                label: "Whisper Tiny (Local)",
                fileName: "ggml-tiny.bin",
                sizeBytes: 75000000,
                isDefault: false,
                installed: true,
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  test("renders unified model selector and provider rows", async () => {
    renderSpeechSection();
    expect(await screen.findByText(/Groq API key/i)).toBeInTheDocument();
    expect(await screen.findByText(/Gemini API key/i)).toBeInTheDocument();
    expect(screen.getByText("Speech-to-Text Model")).toBeInTheDocument();
    expect(screen.getByTestId("pref-stt.active_model")).toBeInTheDocument();
  });

  test("opens dropdown showing local on top, groq, and gemini models", async () => {
    renderSpeechSection();
    const trigger = await screen.findByTestId("pref-stt.active_model");
    fireEvent.click(trigger);

    expect(await screen.findByTestId("stt-model-dropdown")).toBeInTheDocument();
    expect(screen.getByText("Local Models (On-Device)")).toBeInTheDocument();
    expect(screen.getByText("Groq (Cloud Whisper)")).toBeInTheDocument();
    expect(screen.getByText("Gemini (Cloud Multimodal)")).toBeInTheDocument();
  });

  test("filters models via search box", async () => {
    renderSpeechSection();
    const trigger = await screen.findByTestId("pref-stt.active_model");
    fireEvent.click(trigger);

    const searchInput = await screen.findByTestId("stt-model-search");
    fireEvent.change(searchInput, { target: { value: "turbo" } });

    expect(screen.getByText("Whisper Turbo (Fast)")).toBeInTheDocument();
    expect(screen.queryByTestId("stt-model-option-local:ggml-tiny.bin")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stt-model-option-gemini:gemini-2.0-flash")).not.toBeInTheDocument();
  });

  test("selecting a model updates selection and triggers preference write", async () => {
    renderSpeechSection();
    const trigger = await screen.findByTestId("pref-stt.active_model");
    
    // Wait for initial load
    await screen.findByText("Whisper Tiny (Local)");

    fireEvent.click(trigger);
    const groqOption = await screen.findByTestId("stt-model-option-groq:whisper-large-v3");
    fireEvent.click(groqOption);

    await waitFor(() => {
      expect(store.data.get(PREF_KEYS.activeModel)).toBe("groq:whisper-large-v3");
    });
  });

  test("hides cloud models without keys (only usable models listed)", async () => {
    groqConfigured = false;
    geminiConfigured = false;
    renderSpeechSection();
    const trigger = await screen.findByTestId("pref-stt.active_model");
    fireEvent.click(trigger);

    await screen.findByTestId("stt-model-dropdown");
    expect(
      screen.getByTestId("stt-model-option-local:ggml-tiny.bin"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("stt-model-option-groq:whisper-large-v3-turbo"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("stt-model-option-gemini:gemini-2.0-flash"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Connect a Groq key above/i)).toBeInTheDocument();
    expect(screen.getByText(/Connect a Gemini key above/i)).toBeInTheDocument();
  });

  test("hides local models when the engine is missing", async () => {
    engineAvailable = false;
    renderSpeechSection();
    const trigger = await screen.findByTestId("pref-stt.active_model");
    fireEvent.click(trigger);

    await screen.findByTestId("stt-model-dropdown");
    expect(
      screen.queryByTestId("stt-model-option-local:ggml-tiny.bin"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/On-device engine not in this build/i)).toBeInTheDocument();
  });
});
