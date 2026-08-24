import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import type { VideoItem } from "../lib/ipc";
import type { TranscriptData } from "../lib/useTranscript";
import {
  getPlayerSnapshot,
  playerBridge,
} from "./playerBridge";
import TranscriptPanel, {
  anchorFromOffsets,
  offsetsFromAnchor,
  segmentParagraph,
} from "./TranscriptPanel";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const invokeMock = vi.mocked(invoke);

const URL = "https://youtu.be/dQw4w9WgXcQ";

const transcript: TranscriptData = {
  lang: "en",
  cues: [
    { start: 10, end: 12, text: "Alpha beta" },
    { start: 12, end: 14, text: "gamma delta" },
    { start: 40, end: 42, text: "Epsilon zeta." },
  ],
  paragraphs: [
    {
      index: 0,
      text: "Alpha beta gamma delta",
      start: 10,
      end: 14,
      cueRange: [0, 1],
    },
    {
      index: 1,
      text: "Epsilon zeta.",
      start: 40,
      end: 42,
      cueRange: [2, 2],
    },
  ],
};

function makeTranscriptItem(overrides: Partial<VideoItem>): VideoItem {
  return {
    id: "t9",
    kind: "transcript",
    videoTime: 12,
    notes: [],
    color: "red",
    quote: "beta gamma",
    timeEnd: 14,
    anchor: { startCue: 0, startOffset: 6, endCue: 1, endOffset: 6 },
    ...overrides,
  };
}

let scrollToMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  scrollToMock = vi.fn();
  (HTMLElement.prototype as unknown as { scrollTo: unknown }).scrollTo =
    scrollToMock;
  playerBridge.resetForTests();
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "upsert_video")
      return { ok: true, data: { urlHash: "hash-1" } };
    if (command === "fetch_transcript") return { ok: true, data: transcript };
    if (command === "get_video_items") return { ok: true, data: [] };
    throw new Error(`unexpected command ${command}`);
  });
});

afterEach(() => {
  delete (HTMLElement.prototype as unknown as { scrollTo?: unknown }).scrollTo;
});

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TranscriptPanel url={URL} videoId="dQw4w9WgXcQ" />
    </QueryClientProvider>,
  );
}

function para(index: number): HTMLElement | null {
  return document.querySelector(`[data-para-index="${index}"]`);
}

describe("active-cue karaoke + smooth follow", () => {
  test("marks the paragraph containing the active cue and follows it ~30% from top only on change", async () => {
    renderPanel();
    await screen.findByText("Alpha beta gamma delta");

    expect(para(0)).toHaveAttribute("data-active", "false");
    expect(para(1)).toHaveAttribute("data-active", "false");
    expect(scrollToMock).not.toHaveBeenCalled();

    act(() => {
      playerBridge.commands.seekTo(13); // inside cue 1 → paragraph 0
    });
    await waitFor(() => {
      expect(para(0)).toHaveAttribute("data-active", "true");
    });
    expect(para(1)).toHaveAttribute("data-active", "false");

    await waitFor(() => expect(scrollToMock).toHaveBeenCalledTimes(1));
    const top = scrollToMock.mock.calls[0]?.[0]?.top;
    expect(typeof top).toBe("number");

    // Tick within the same cue/paragraph: no additional scroll.
    scrollToMock.mockClear();
    act(() => {
      playerBridge.commands.seekTo(13.5);
    });
    await waitFor(() => {
      expect(getPlayerSnapshot().time).toBeCloseTo(13.5);
    });
    expect(scrollToMock).not.toHaveBeenCalled();

    // Next paragraph → exactly one more scroll.
    act(() => {
      playerBridge.commands.seekTo(41);
    });
    await waitFor(() => {
      expect(para(1)).toHaveAttribute("data-active", "true");
    });
    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledTimes(1);
    });
  });

  test("no captions error renders the typed empty state", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "upsert_video")
        return { ok: true, data: { urlHash: "hash-1" } };
      if (command === "fetch_transcript")
        return {
          ok: false,
          error: { kind: "notFound", message: "no captions" },
        };
      throw new Error(`unexpected command ${command}`);
    });
    renderPanel();
    expect(await screen.findByText("No captions for this video.")).toBeInTheDocument();
  });
});

describe("anchor math", () => {
  test("offsets map to covered cues and round-trip back to text ranges", () => {
    const p = transcript.paragraphs[0]!;
    const anchor = anchorFromOffsets(p, transcript.cues, 6, 17);
    expect(anchor).toEqual({ startCue: 0, startOffset: 6, endCue: 1, endOffset: 6 });
    expect(offsetsFromAnchor(p, transcript.cues, anchor!)).toEqual([6, 17]);
    // The range ends mid-"gamma delta", so the raw slice carries the joining
    // space; the save path trims it into the stored quote.
    expect(p.text.slice(6, 17).trim()).toBe("beta gamma");

    // Whole-cue selection at exact boundaries.
    const whole = anchorFromOffsets(p, transcript.cues, 11, 22);
    expect(whole).toEqual({ startCue: 1, startOffset: 0, endCue: 1, endOffset: 11 });
  });

  test("segmentParagraph repaints saved highlights inline", () => {
    const p = transcript.paragraphs[0]!;
    const segments = segmentParagraph(p, transcript.cues, [
      makeTranscriptItem({}),
    ]);
    expect(segments.map((s) => s.text)).toEqual([
      "Alpha ",
      "beta gamma ",
      "delta",
    ]);
    expect(segments[1]?.item?.id).toBe("t9");
  });
});

describe("selection → swatch → save payload", () => {
  test("mouseup shows swatches; picking red saves the precise cue anchor", async () => {
    const saved: Array<{ command: string; args: unknown }> = [];
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "upsert_video")
        return { ok: true, data: { urlHash: "hash-1" } };
      if (command === "fetch_transcript") return { ok: true, data: transcript };
      if (command === "get_video_items") return { ok: true, data: [] };
      if (command === "save_video_item") {
        saved.push({ command, args });
        return { ok: true, data: null };
      }
      throw new Error(`unexpected command ${command}`);
    });

    const { container } = renderPanel();
    await screen.findByText("Alpha beta gamma delta");

    const range = document.createRange();
    const textNode = container.querySelector(
      '[data-para-index="0"] p span',
    )!.firstChild!;
    range.setStart(textNode, 6);
    range.setEnd(textNode, 17);
    // jsdom's Range has no geometry.
    (range as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
      () =>
        ({
          top: 100,
          left: 50,
          width: 80,
          height: 12,
          bottom: 112,
          right: 130,
          x: 50,
          y: 100,
          toJSON: () => ({}),
        }) as DOMRect;
    vi.spyOn(window, "getSelection").mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      removeAllRanges: () => {},
    } as unknown as Selection);

    fireEvent.mouseUp(screen.getByTestId("transcript-scroll"));
    expect(screen.getByTestId("swatch-popup")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("swatch-red"));

    await waitFor(() => expect(saved).toHaveLength(1));
    const item = (
      saved[0]!.args as { urlHash: string; item: VideoItem }
    ).item;
    expect(item.kind).toBe("transcript");
    expect(item.color).toBe("red");
    expect(item.quote).toBe("beta gamma");
    expect(item.videoTime).toBe(10);
    expect(item.timeEnd).toBe(14);
    expect(item.anchor).toEqual({
      startCue: 0,
      startOffset: 6,
      endCue: 1,
      endOffset: 6,
    });
  });
});

describe("search", () => {
  test("filters paragraphs and Enter jumps+pauses on the first match", async () => {
    const seekTo = vi.spyOn(playerBridge.commands, "seekTo");
    const pause = vi.spyOn(playerBridge.commands, "pause");
    renderPanel();
    await screen.findByText("Alpha beta gamma delta");

    const input = screen.getByTestId("transcript-search");
    fireEvent.change(input, { target: { value: "epsilon" } });
    expect(screen.queryByText("Alpha beta gamma delta")).not.toBeInTheDocument();
    expect(screen.getByText("Epsilon zeta.")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(seekTo).toHaveBeenCalledWith(40);
    expect(pause).toHaveBeenCalled();
    seekTo.mockRestore();
    pause.mockRestore();
  });
});
