import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, test, vi } from "vitest";
import ModelManagerSection from "./ModelManagerSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));
vi.mock("../../lib/store", () => ({
  PREF_KEYS: { localModel: "stt.local_model" },
  getPref: vi.fn(async (_key: string, fallback: unknown) => fallback),
  setPref: vi.fn(async () => {}),
}));

import { getPref, setPref } from "../../lib/store";

const invokeMock = vi.mocked(invoke);
const openUrlMock = vi.mocked(openUrl);
const getPrefMock = vi.mocked(getPref);
const setPrefMock = vi.mocked(setPref);

function renderModelManagerSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ModelManagerSection />
    </QueryClientProvider>,
  );
}

describe("ModelManagerSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrefMock.mockResolvedValue("");
    setPrefMock.mockResolvedValue();
  });

  test("renders Explore Models and Import Model buttons, and clicking Explore opens the website", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_stt_models") {
        return {
          models: [
            { id: "tiny_en", label: "Tiny (English) ~44 MB", sizeBytes: 43550795, isDefault: true, installed: false },
            { id: "base_en", label: "Base (English) ~82 MB", sizeBytes: 81781811, isDefault: false, installed: false },
            { id: "small_en", label: "Small (English) ~264 MB", sizeBytes: 264477561, isDefault: false, installed: false },
          ],
        };
      }
      throw new Error(`unexpected command ${command}`);
    });

    renderModelManagerSection();

    const exploreBtn = await screen.findByTestId("explore-models-btn");
    expect(exploreBtn).toBeInTheDocument();
    expect(screen.getByTestId("import-model-btn")).toBeInTheDocument();

    // The 3 download buttons should NOT be present
    expect(screen.queryByRole("button", { name: /^download/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Available to download/i)).not.toBeInTheDocument();

    // Empty state should be visible since no models are installed
    expect(screen.getByText(/No models imported yet/i)).toBeInTheDocument();

    // Clicking Explore Models should open the FUTO voice models website
    fireEvent.click(exploreBtn);
    expect(openUrlMock).toHaveBeenCalledWith("https://keyboard.futo.org/voice-input-models");
  });

  test("displays installed models with active badge, activate button, and delete button", async () => {
    getPrefMock.mockResolvedValue("custom-tiny.bin");
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_stt_models") {
        return {
          models: [
            { id: "tiny_en", label: "Tiny (English) ~44 MB", sizeBytes: 43550795, isDefault: true, installed: false },
            { id: "custom-tiny.bin", label: "custom-tiny.bin (~75 MB)", sizeBytes: 78000000, isDefault: false, installed: true },
            { id: "custom-base.bin", label: "custom-base.bin (~142 MB)", sizeBytes: 148000000, isDefault: false, installed: true },
          ],
        };
      }
      if (command === "delete_stt_model") {
        return true;
      }
      throw new Error(`unexpected command ${command}`);
    });

    renderModelManagerSection();

    // Only installed models are rendered
    expect(await screen.findByText("custom-tiny.bin (~75 MB)")).toBeInTheDocument();
    expect(screen.getByText("custom-base.bin (~142 MB)")).toBeInTheDocument();
    expect(screen.queryByText("Tiny (English) ~44 MB")).not.toBeInTheDocument();

    // custom-tiny.bin is active
    expect(screen.getByTestId("active-custom-tiny.bin")).toBeInTheDocument();

    // custom-base.bin has Activate button
    const activateBtn = screen.getByRole("button", { name: "Activate" });
    expect(activateBtn).toBeInTheDocument();

    fireEvent.click(activateBtn);
    await waitFor(() => {
      expect(setPrefMock).toHaveBeenCalledWith("stt.local_model", "custom-base.bin");
    });

    // Delete custom-base.bin
    const deleteBtn = screen.getByRole("button", { name: "Delete custom-base.bin (~142 MB)" });
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_stt_model", { id: "custom-base.bin" });
    });
  });

  test("rejects non-.bin file on import with an error message", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_stt_models") return { models: [] };
      throw new Error(`unexpected command ${command}`);
    });

    renderModelManagerSection();

    const fileInput = await screen.findByTestId("model-file-input");
    const fakeFile = new File(["test"], "whisper.txt", { type: "text/plain" });

    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please select a valid Whisper .bin model file.",
    );
  });

  test("imports a .bin model file and activates it", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_stt_models") {
        return {
          models: [
            { id: "my-model.bin", label: "my-model.bin (~50 MB)", sizeBytes: 52428800, isDefault: false, installed: true },
          ],
        };
      }
      if (command === "import_stt_model_chunk") {
        return true;
      }
      throw new Error(`unexpected command ${command}`);
    });

    renderModelManagerSection();

    const fileInput = await screen.findByTestId("model-file-input");
    const fakeFile = new File([new Uint8Array(100)], "my-model.bin", {
      type: "application/octet-stream",
    });
    fakeFile.slice = (_start?: number, _end?: number) => {
      const blob = new Blob([new Uint8Array(100)]);
      blob.arrayBuffer = async () => new ArrayBuffer(100);
      return blob;
    };

    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("import_stt_model_chunk", expect.objectContaining({
        fileName: "my-model.bin",
      }));
    });

    await waitFor(() => {
      expect(setPrefMock).toHaveBeenCalledWith("stt.local_model", "my-model.bin");
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      'Successfully imported and activated "my-model.bin"',
    );
  });
});
