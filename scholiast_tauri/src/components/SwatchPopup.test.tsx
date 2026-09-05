import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import SwatchPopup from "./SwatchPopup";

const voiceMocks = vi.hoisted(() => ({
  startImpl: async () => {},
  stopImpl: async () => "spoken draft",
  startCalls: 0,
}));

vi.mock("../voice/useVoiceComment", () => ({
  formatElapsedMs: () => "0:00",
  voiceFailureMessage: (_err: unknown, fallback: string) => `${fallback}: boom`,
  micErrorMessage: (_err: unknown, fallback: string) => `${fallback}: boom`,
  useVoiceComment: () => ({
    state: "idle",
    recording: false,
    elapsedMs: 0,
    offline: false,
    disabledReason: null,
    start: async () => {
      voiceMocks.startCalls += 1;
      await voiceMocks.startImpl();
    },
    stop: () => voiceMocks.stopImpl(),
    cancel: async () => {},
  }),
}));

function renderSwatch(handlers: {
  onSaveComment?: ReturnType<typeof vi.fn>;
  onClose?: ReturnType<typeof vi.fn>;
} = {}) {
  const onSaveComment = handlers.onSaveComment ?? vi.fn();
  const onClose = handlers.onClose ?? vi.fn();
  render(
    <SwatchPopup
      anchor={{ top: 100, left: 200 }}
      onPickColor={vi.fn()}
      onSaveComment={onSaveComment}
      onComment={vi.fn()}
      onClose={onClose}
    />,
  );
  return { onSaveComment, onClose };
}

function openVoiceBar() {
  fireEvent.click(screen.getByTestId("swatch-voice"));
  return screen.getByTestId("swatch-voice-bar");
}

describe("SwatchPopup", () => {
  test("renders three color circles and a comment button", () => {
    render(
      <SwatchPopup
        anchor={{ top: 100, left: 200 }}
        onPickColor={vi.fn()}
        onComment={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("swatch-yellow")).toBeInTheDocument();
    expect(screen.getByTestId("swatch-red")).toBeInTheDocument();
    expect(screen.getByTestId("swatch-green")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /comment/i })).toBeInTheDocument();
  });

  test("color clicks report the picked color; 💬 reports a comment", () => {
    const onPickColor = vi.fn();
    const onComment = vi.fn();
    render(
      <SwatchPopup
        anchor={{ top: 0, left: 0 }}
        onPickColor={onPickColor}
        onComment={onComment}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("swatch-green"));
    expect(onPickColor).toHaveBeenCalledWith("green");
    fireEvent.click(screen.getByTestId("swatch-comment"));
    expect(onComment).toHaveBeenCalledTimes(1);
  });

  test("Escape and outside mousedown dismiss it; inside mousedown does not", () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside" />
        <SwatchPopup
          anchor={{ top: 0, left: 0 }}
          onPickColor={vi.fn()}
          onComment={vi.fn()}
          onClose={onClose}
        />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    fireEvent.mouseDown(screen.getByTestId("swatch-popup"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("highlights use the shared highlight token vars", () => {
    render(
      <SwatchPopup
        anchor={{ top: 0, left: 0 }}
        onPickColor={vi.fn()}
        onComment={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("swatch-yellow")).toHaveStyle({
      backgroundColor: "var(--sc-hl-yellow)",
    });
    expect(screen.getByTestId("swatch-red")).toHaveStyle({
      backgroundColor: "var(--sc-hl-red)",
    });
    expect(screen.getByTestId("swatch-green")).toHaveStyle({
      backgroundColor: "var(--sc-hl-green)",
    });
  });

  test("mic morphs the strip into a live wave bar", async () => {
    voiceMocks.startImpl = async () => {};
    renderSwatch();
    const bar = openVoiceBar();
    expect(bar).toHaveTextContent(/tap to stop/i);
    expect(screen.queryByTestId("swatch-green")).not.toBeInTheDocument();
  });

  test("tapping the wave stops, reviews, and saves the transcript", async () => {
    voiceMocks.startImpl = async () => {};
    voiceMocks.stopImpl = async () => "spoken draft";
    const { onSaveComment, onClose } = renderSwatch();
    openVoiceBar();

    fireEvent.click(screen.getByTitle("Tap to stop and review"));
    const review = await screen.findByTestId("swatch-voice-review");
    expect(review).toHaveTextContent("spoken draft");

    fireEvent.change(screen.getByLabelText("Review voice note"), {
      target: { value: "edited draft" },
    });
    fireEvent.click(screen.getByTestId("swatch-voice-save"));
    expect(onSaveComment).toHaveBeenCalledWith("yellow", "edited draft");
    expect(onClose).toHaveBeenCalled();
  });

  test("transcribe failure shows the reason inline with a retry", async () => {
    voiceMocks.startImpl = async () => {};
    voiceMocks.stopImpl = async () => {
      throw new Error("engine gone");
    };
    renderSwatch();
    openVoiceBar();

    fireEvent.click(screen.getByTitle("Tap to stop and review"));
    const error = await screen.findByTestId("swatch-voice-error");
    expect(error).toHaveTextContent(/transcription failed: boom/i);

    voiceMocks.stopImpl = async () => "second try";
    fireEvent.click(screen.getByTestId("swatch-voice-retry"));
    await screen.findByTestId("swatch-voice-bar");
    fireEvent.click(screen.getByTitle("Tap to stop and review"));
    const review = await screen.findByTestId("swatch-voice-review");
    expect(review).toHaveTextContent("second try");
  });

  test("mic refusal (e.g. missing engine) surfaces its reason with a back way out", async () => {
    voiceMocks.startImpl = async () => {
      throw new Error("Local engine missing — rebuild app with local-stt");
    };
    const onClose = vi.fn();
    renderSwatch({ onClose });
    fireEvent.click(screen.getByTestId("swatch-voice"));

    const error = await screen.findByTestId("swatch-voice-error");
    expect(error).toHaveTextContent(/microphone unavailable: boom/i);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByTestId("swatch-green")).toBeInTheDocument();
  });
});
