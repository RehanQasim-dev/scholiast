import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import TabletVideoDock from "./TabletVideoDock";
import { playerBridge } from "../../player/playerBridge";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const voiceMock = {
  recording: false,
  state: "idle",
  disabledReason: null,
  start: vi.fn(async () => {
    voiceMock.recording = true;
    voiceMock.state = "recording";
  }),
  stop: vi.fn(async () => {
    voiceMock.recording = false;
    voiceMock.state = "idle";
    return "Transcribed audio snippet";
  }),
  cancel: vi.fn(async () => {
    voiceMock.recording = false;
    voiceMock.state = "idle";
  }),
};

vi.mock("../../voice/useVoiceComment", () => ({
  useVoiceComment: () => voiceMock,
}));

function renderDock(props?: {
  activePanel?: "notes" | "transcript" | null;
  onTogglePanel?: (panel: "notes" | "transcript") => void;
  onAddNote?: () => void;
  onCaptureFrame?: () => void;
  urlHash?: string;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return rtlRender(
    <QueryClientProvider client={client}>
      <TabletVideoDock
        activePanel={props?.activePanel ?? "notes"}
        onTogglePanel={props?.onTogglePanel ?? vi.fn()}
        onAddNote={props?.onAddNote ?? vi.fn()}
        onCaptureFrame={props?.onCaptureFrame ?? vi.fn()}
        urlHash={props?.urlHash ?? "test-hash"}
      />
    </QueryClientProvider>,
  );
}

describe("TabletVideoDock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    voiceMock.recording = false;
    voiceMock.state = "idle";
    playerBridge.resetForTests();
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "save_video_item") return { ok: true, data: true };
      throw new Error(`unexpected command ${cmd}`);
    });
  });

  test("renders all edge dock buttons", () => {
    renderDock();
    expect(screen.getByTitle("Notes")).toBeInTheDocument();
    expect(screen.getByTitle("Transcript")).toBeInTheDocument();
    expect(screen.getByTitle("Add note")).toBeInTheDocument();
    expect(screen.getByTitle("Capture frame")).toBeInTheDocument();
    expect(screen.getByTitle("Record voice note")).toBeInTheDocument();
  });

  test("clicking toggle buttons triggers panel callbacks", () => {
    const onTogglePanel = vi.fn();
    renderDock({ onTogglePanel });

    fireEvent.click(screen.getByTitle("Transcript"));
    expect(onTogglePanel).toHaveBeenCalledWith("transcript");

    fireEvent.click(screen.getByTitle("Notes"));
    expect(onTogglePanel).toHaveBeenCalledWith("notes");
  });

  test("clicking Add note and Capture frame triggers respective callbacks", () => {
    const onAddNote = vi.fn();
    const onCaptureFrame = vi.fn();
    renderDock({ onAddNote, onCaptureFrame });

    fireEvent.click(screen.getByTitle("Add note"));
    expect(onAddNote).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("Capture frame"));
    expect(onCaptureFrame).toHaveBeenCalledTimes(1);
  });

  test("tapping mic starts recording, then stops and opens floating popover with unfocused textarea", async () => {
    const playSpy = vi.spyOn(playerBridge.commands, "play");
    const { rerender } = renderDock();

    const micBtn = screen.getByTitle("Record voice note");
    fireEvent.click(micBtn);

    expect(voiceMock.start).toHaveBeenCalled();

    // Re-render to reflect recording state
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TabletVideoDock
          activePanel="notes"
          onTogglePanel={vi.fn()}
          onAddNote={vi.fn()}
          onCaptureFrame={vi.fn()}
          urlHash="test-hash"
        />
      </QueryClientProvider>,
    );

    // Click again to stop
    const stopBtn = screen.getByTitle("Stop recording");
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(voiceMock.stop).toHaveBeenCalled();
      expect(screen.getByTestId("tablet-voice-popover")).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText("Transcribed voice note…");
    expect(textarea).toHaveValue("Transcribed audio snippet");
    // Textarea is NOT focused automatically
    expect(document.activeElement).not.toBe(textarea);

    // Click Save
    const saveBtn = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("save_video_item", expect.objectContaining({
        urlHash: "test-hash",
        item: expect.objectContaining({
          notes: expect.arrayContaining([expect.stringContaining("Transcribed audio snippet")]),
        }),
      }));
    });

    playSpy.mockRestore();
  });
});
