import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import CommentEditorSheet, {
  type CommentDraftMeta,
  type CommentTarget,
} from "./CommentEditorSheet";
import { ToastHost } from "./Toast";
import { resetVoiceAvailabilityForTests } from "../voice/useVoiceComment";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

interface FakeStopResult {
  path: string;
  reason: string;
}

let voiceStopQueue: FakeStopResult[] = [];

let activeSheetRecorder: { cancel: ReturnType<typeof vi.fn> } | null = null;

vi.mock("../voice/useVoiceRecorder", () => ({
  useVoiceRecorder: () => {
    if (activeSheetRecorder) return activeSheetRecorder;
    const recorder = {
      phase: "idle",
      recording: false,
      elapsedMs: 0,
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {
        const result = voiceStopQueue.shift();
        if (!result) throw new Error("no queued stop result");
        return result;
      }),
      cancel: vi.fn(async () => {}),
    };
    activeSheetRecorder = recorder;
    return recorder;
  },
}));

vi.mock("../lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/store")>();
  return { ...actual, getPref: vi.fn(async (_key: string, fallback: unknown) => fallback) };
});

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, value });
}

const TARGET: CommentTarget = { urlHash: "hash-1", currentTime: 95 };

function makeClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(client, "invalidateQueries");
  return { client, invalidateSpy };
}

/** Keeps the sheet mounted across open toggles so kept-draft state survives. */
function Harness(props: {
  client: QueryClient;
  onSave?: (target: CommentTarget, meta: CommentDraftMeta) => void;
  onVoiceDraft?: (text: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={props.client}>
      <ToastHost />
      <CommentEditorSheet
        open={open}
        target={TARGET}
        onClose={() => setOpen(false)}
        onSave={props.onSave}
        onVoiceDraft={props.onVoiceDraft}
      />
      <button type="button" onClick={() => setOpen(true)}>
        Reopen
      </button>
    </QueryClientProvider>
  );
}

function typeNote(text: string) {
  const textarea = screen.getByLabelText("Comment");
  fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

beforeEach(() => {
  vi.clearAllMocks();
  voiceStopQueue = [];
  activeSheetRecorder = null;
  setOnline(true);
  resetVoiceAvailabilityForTests();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "list_tags")
      return { ok: true, data: ["lecture", "linear-algebra", "exam"] };
    if (command === "save_video_item") return { ok: true, data: null };
    if (command === "list_stt_models")
      return { models: [{ id: "tiny_en", installed: false }] };
    if (command === "get_secret_status") return { ok: true, data: { configured: true } };
    if (command === "stt_transcribe") return { ok: true, data: "spoken draft" };
    return { ok: true, data: null };
  });
});

describe("CommentEditorSheet", () => {
  test("tag autocomplete inserts the picked tag with a trailing space", async () => {
    const { client } = makeClient();
    render(<Harness client={client} />);
    const textarea = typeNote("see #lin");

    const option = await screen.findByRole("option", {
      name: "#linear-algebra",
    });
    fireEvent.mouseDown(option);

    expect(textarea).toHaveValue("see #linear-algebra ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  test("Ctrl+Enter saves a note item and invalidates the queries", async () => {
    const { client, invalidateSpy } = makeClient();
    const onSave = vi.fn();
    render(<Harness client={client} onSave={onSave} />);
    typeNote("key idea");

    fireEvent.keyDown(screen.getByLabelText("Comment"), {
      key: "Enter",
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("save_video_item", {
        urlHash: "hash-1",
        item: expect.objectContaining({
          kind: "note",
          videoTime: 95,
          notes: [expect.stringMatching(/^key idea<!--timestamp:\d+-->$/)],
          id: expect.stringMatching(/^[0-9a-z]+$/),
        }),
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["videoItems", "hash-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["videos", "recent"] });
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        TARGET,
        expect.objectContaining({ text: "key idea", videoTime: 95 }),
      );
    });
  });

  test("Esc keeps a non-empty draft once, then discards on the second cancel", async () => {
    const { client } = makeClient();
    render(<Harness client={client} />);
    const textarea = typeNote("remember this");
    fireEvent.keyDown(textarea, { key: "Escape" });

    expect(await screen.findByText(/Draft kept/)).toBeInTheDocument();
    expect(screen.queryByTestId("comment-editor-sheet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    const reopened = screen.getByLabelText("Comment");
    expect(reopened).toHaveValue("remember this");

    fireEvent.keyDown(reopened, { key: "Escape" });
    expect(screen.queryByTestId("comment-editor-sheet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(screen.getByLabelText("Comment")).toHaveValue("");
  });

  test("keyboard button refocuses the textarea", () => {
    const { client } = makeClient();
    render(<Harness client={client} />);
    const textarea = screen.getByLabelText("Comment");
    textarea.blur();
    fireEvent.click(screen.getByRole("button", { name: "Focus comment field" }));
    expect(document.activeElement).toBe(textarea);
  });

  test("mic is hidden without onVoiceDraft and shown once provided", async () => {
    const { client } = makeClient();
    render(<Harness client={client} />);
    expect(screen.queryByTestId("voice-mic")).not.toBeInTheDocument();

    const { unmount } = render(
      <QueryClientProvider client={makeClient().client}>
        <CommentEditorSheet
          open
          target={TARGET}
          onClose={() => {}}
          onVoiceDraft={() => {}}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("voice-mic")).toBeInTheDocument();
    });
    unmount();
  });

  test("mic records, transcribes and inserts the draft at the caret", async () => {
    voiceStopQueue.push({ path: "/voice/x.wav", reason: "user" });
    const onVoiceDraft = vi.fn();
    const { client } = makeClient();
    render(<Harness client={client} onVoiceDraft={onVoiceDraft} />);

    const mic = screen.getByTestId("voice-mic");
    await waitFor(() => expect(mic).not.toBeDisabled());

    typeNote("prior ");
    fireEvent.click(mic);
    expect(await screen.findByTestId("voice-elapsed")).toBeInTheDocument();

    fireEvent.click(mic);
    const textarea = screen.getByLabelText("Comment");
    await waitFor(() => expect(textarea).toHaveValue("prior spoken draft"));
    expect(onVoiceDraft).toHaveBeenCalledWith("spoken draft");
    expect(screen.getByTestId("voice-mic").getAttribute("aria-pressed")).toBe("false");
  });

  test("Esc while recording cancels the recording and keeps the draft", async () => {
    const { client } = makeClient();
    render(<Harness client={client} onVoiceDraft={() => {}} />);
    const mic = screen.getByTestId("voice-mic");
    await waitFor(() => expect(mic).not.toBeDisabled());

    typeNote("kept text");
    fireEvent.click(mic);
    expect(await screen.findByTestId("voice-elapsed")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Comment"), { key: "Escape" });
    await waitFor(() => expect(activeSheetRecorder?.cancel).toHaveBeenCalled());
    expect(screen.getByTestId("comment-editor-sheet")).toBeInTheDocument();
    expect(screen.getByLabelText("Comment")).toHaveValue("kept text");
    expect(screen.queryByTestId("voice-elapsed")).not.toBeInTheDocument();
  });

  test("offline without a local model dims the mic with a 'Needs internet' hint", async () => {
    setOnline(false);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_tags") return { ok: true, data: [] };
      if (command === "list_stt_models") throw "local stt missing";
      if (command === "get_secret_status") return { ok: true, data: { configured: false } };
      return { ok: true, data: null };
    });
    const { client } = makeClient();
    render(<Harness client={client} onVoiceDraft={() => {}} />);

    const hint = await screen.findByTestId("voice-hint");
    expect(hint).toHaveTextContent("Needs internet");
    expect(screen.getByTestId("voice-mic")).toBeDisabled();
  });
});
