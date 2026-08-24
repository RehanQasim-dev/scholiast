import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VoiceEditSheet from "./VoiceEditSheet";

const h = vi.hoisted(() => {
  const micProps: {
    disabled?: boolean;
    disabledTitle?: string;
    onStopped?: (result: { path: string; reason: string }) => void;
  } = { disabled: undefined, disabledTitle: undefined, onStopped: undefined };
  const invoke = vi.fn();
  return { micProps, invoke };
});

vi.mock("../components/MicButton", () => ({
  default: (props: {
    disabled?: boolean;
    disabledTitle?: string;
    onStopped?: (result: { path: string; reason: string }) => void;
  }) => {
    h.micProps.disabled = props.disabled;
    h.micProps.disabledTitle = props.disabledTitle;
    h.micProps.onStopped = props.onStopped;
    return (
      <button
        type="button"
        aria-label="fake-mic"
        data-disabled={props.disabled ? "true" : "false"}
        onClick={() => props.onStopped?.({ path: "/tmp/fake.wav", reason: "user" })}
      />
    );
  },
}));

vi.mock("../lib/ipc", async () => {
  class FakeIpcError extends Error {
    readonly kind: string;
    constructor(error: { kind: string; message: string }) {
      super(error.message);
      this.name = "IpcCommandError";
      this.kind = error.kind;
    }
  }
  return { IpcCommandError: FakeIpcError, invokeCommand: h.invoke };
});

function stopMic() {
  fireEvent.click(screen.getByRole("button", { name: "fake-mic" }));
}

function renderSheet(overrides?: Partial<Parameters<typeof VoiceEditSheet>[0]>) {
  const props = {
    original: "original note",
    initialPrompt: "tighten this",
    micDisabledReason: null,
    onAccept: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides,
  };
  render(<VoiceEditSheet {...props} />);
  return props;
}

beforeEach(() => {
  h.invoke.mockReset();
  h.micProps.onStopped = undefined;
});

describe("VoiceEditSheet", () => {
  it("accept returns the edited text to the caller", async () => {
    const props = renderSheet();
    h.invoke.mockResolvedValue("revised note");

    stopMic();
    await waitFor(() => expect(screen.getByText("revised note")).toBeInTheDocument());

    const args = h.invoke.mock.calls[0][1] as Record<string, unknown>;
    expect(args.original).toBe("original note");
    expect(args.promptOverride).toBe("tighten this");

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(props.onAccept).toHaveBeenCalledWith("revised note");
    expect(props.onDiscard).not.toHaveBeenCalled();
  });

  it("discard notifies the caller without accepting", async () => {
    const props = renderSheet();
    h.invoke.mockResolvedValue("revised note");

    stopMic();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(props.onDiscard).toHaveBeenCalled();
    expect(props.onAccept).not.toHaveBeenCalled();
  });

  it("retry re-invokes after a failure and reaches preview", async () => {
    const props = renderSheet({ initialPrompt: "" });
    h.invoke
      .mockRejectedValueOnce({
        ok: false,
        error: { kind: "http", message: "Speech failed: HTTP 429" },
      })
      .mockResolvedValueOnce("second try");

    stopMic();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/429/));
    expect(props.onAccept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("second try")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(h.invoke).toHaveBeenCalledTimes(2);
    // Empty prompt is normalized to null so Rust falls back to its pref/default chain.
    expect((h.invoke.mock.calls[0][1] as Record<string, unknown>).promptOverride).toBeNull();
    expect((h.invoke.mock.calls[1][1] as Record<string, unknown>).wavPath).toBe("/tmp/fake.wav");
    expect(props.onAccept).toHaveBeenCalledWith("second try");
  });

  it("passes the disabled reason through to the mic", () => {
    renderSheet({ micDisabledReason: "Set up speech in Settings" });
    expect(h.micProps.disabled).toBe(true);
    expect(h.micProps.disabledTitle).toBe("Set up speech in Settings");
    expect(screen.getByRole("note")).toHaveTextContent("Set up speech in Settings");
  });
});
