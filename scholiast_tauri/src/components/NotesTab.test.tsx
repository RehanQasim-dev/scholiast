import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { VideoItem } from "../lib/ipc";
import { playerBridge } from "../player/playerBridge";
import NoteCard from "./NoteCard";
import NotesTab, { orderItems, type ActiveComposerState } from "./NotesTab";
import TimestampChip from "./TimestampChip";

function render(ui: React.ReactElement) {
  return rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (p: string) => `asset://${p}`,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const invokeMock = vi.mocked(invoke);

const URL = "https://youtu.be/dQw4w9WgXcQ";

function makeItem(overrides: Partial<VideoItem> & { id: string }): VideoItem {
  return {
    kind: "note",
    videoTime: 0,
    notes: [],
    ...overrides,
  };
}

const items: VideoItem[] = [
  makeItem({
    id: "n1",
    videoTime: 91.5,
    notes: ["voiced note<!--timestamp:1724000000000-->"],
    updatedAt: 1724000001000,
  }),
  makeItem({
    id: "t1",
    kind: "transcript",
    videoTime: 10,
    timeEnd: 14.2,
    quote: "quoted caption line",
    color: "yellow",
    updatedAt: 1724000002000,
  }),
  makeItem({
    id: "f1",
    kind: "frame",
    videoTime: 30,
    frame: { w: 1280, h: 720 },
    updatedAt: 1724000003000,
  }),
];

function renderNotesTab(props?: {
  deleteGraceMs?: number;
  composer?: ActiveComposerState | null;
  onComposerChange?: (c: ActiveComposerState | null) => void;
  isMobile?: boolean;
  isTablet?: boolean;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotesTab url={URL} {...props} />
    </QueryClientProvider>,
  );
}

describe("orderItems", () => {
  test("sorts by videoTime asc, breaking ties by updatedAt asc", () => {
    const a = makeItem({ id: "a", videoTime: 20, updatedAt: 2 });
    const b = makeItem({ id: "b", videoTime: 10, updatedAt: 9 });
    const c = makeItem({ id: "c", videoTime: 20, updatedAt: 1 });
    const d = makeItem({ id: "d", videoTime: 20 });
    expect(orderItems([a, b, c, d]).map((i) => i.id)).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
  });

  test("does not mutate the input array", () => {
    const input = [
      makeItem({ id: "x", videoTime: 5 }),
      makeItem({ id: "y", videoTime: 1 }),
    ];
    orderItems(input);
    expect(input.map((i) => i.id)).toEqual(["x", "y"]);
  });
});

describe("TimestampChip", () => {
  test("click seeks the player to the chip's seconds", () => {
    const seekTo = vi.spyOn(playerBridge.commands, "seekTo");
    render(<TimestampChip seconds={125} />);
    fireEvent.click(screen.getByRole("button"));
    expect(seekTo).toHaveBeenCalledWith(125);
    seekTo.mockRestore();
  });

  test("renders M:SS and the M:SS–M:SS range variant", () => {
    render(
      <>
        <TimestampChip seconds={754} />
        <TimestampChip seconds={10} secondsEnd={74.6} />
      </>,
    );
    expect(screen.getByText("12:34")).toBeInTheDocument();
    expect(screen.getByText("0:10–1:14")).toBeInTheDocument();
  });
});

describe("NoteCard", () => {
  test("maps transcript color to the token rail var and shows the frame stub size", () => {
    const { container } = render(
      <>
        <NoteCard item={items[1]!} />
        <NoteCard item={items[2]!} />
        <NoteCard item={makeItem({ id: "p1", color: "black" })} />
      </>,
    );
    const rails = container.querySelectorAll('[data-testid="color-rail"]');
    expect(rails).toHaveLength(3);
    expect(rails[0]?.getAttribute("style")).toContain("var(--sc-hl-yellow)");
    expect(rails[2]?.getAttribute("style")).toContain("rgba(255, 255, 255");
    expect(screen.getByTestId("frame-thumb")).toHaveTextContent("1280×720");
  });

  test("thread preview hides timestamp ids while keeping the body", () => {
    render(<NoteCard item={items[0]!} />);
    expect(screen.getByText(/voiced note/)).toBeInTheDocument();
    expect(screen.queryByText(/timestamp/)).not.toBeInTheDocument();
  });
});

describe("NotesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playerBridge.resetForTests();
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "upsert_video") return { ok: true, data: { urlHash: "hash-1" } };
      if (command === "get_video_items") return { ok: true, data: items };
      if (command === "delete_video_item") return { ok: true, data: true };
      if (command === "save_video_item") return { ok: true, data: true };
      throw new Error(`unexpected command ${command} ${JSON.stringify(args)}`);
    });
  });

  test("renders items ordered by video time with an empty state when none", async () => {
    renderNotesTab();
    const chips = await screen.findAllByTitle(/Jump to this moment/);
    expect(chips.map((c) => c.textContent)).toEqual([
      "0:10–0:14",
      "0:30",
      "1:31",
    ]);
  });

  test("shows the empty state copy when the video has no items", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "upsert_video")
        return { ok: true, data: { urlHash: "hash-1" } };
      if (command === "get_video_items") return { ok: true, data: [] };
      throw new Error(`unexpected command ${command}`);
    });
    renderNotesTab();
    expect(await screen.findByText("No notes yet.")).toBeInTheDocument();
    expect(
      screen.getByText(/Capture a frame or add a note/),
    ).toBeInTheDocument();
  });

  test("delete removes optimistically, undo restores, and no command fires", async () => {
    renderNotesTab();
    await screen.findByText("quoted caption line");
    const card = screen.getByText("voiced note").closest("article")!;
    fireEvent.click(card.querySelector('button[aria-label="Delete note"]')!);

    await waitFor(() => {
      expect(screen.queryByText("voiced note")).not.toBeInTheDocument();
    });
    expect(invokeMock).not.toHaveBeenCalledWith("delete_video_item", {
      urlHash: "hash-1",
      itemId: "n1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("voiced note")).toBeInTheDocument();
    expect(screen.queryByText("Note deleted.")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("delete_video_item", {
      urlHash: "hash-1",
      itemId: "n1",
    });
  });

  test("delete commits to the backend once the undo window passes", async () => {
    renderNotesTab({ deleteGraceMs: 40 });
    await screen.findByText("voiced note");
    const card = screen.getByText("voiced note").closest("article")!;
    fireEvent.click(card.querySelector('button[aria-label="Delete note"]')!);

    await waitFor(
      () => {
        expect(invokeMock).toHaveBeenCalledWith("delete_video_item", {
          urlHash: "hash-1",
          itemId: "n1",
        });
      },
      { timeout: 500 },
    );
  });

  describe("In-Situ Note Composer (Desktop / Keyboard)", () => {
    test("renders in-situ card chronologically with dynamic inline save button for short notes", async () => {
      renderNotesTab({
        composer: {
          timestamp: 25,
          draft: "Short note",
          wasPlaying: true,
        },
      });

      const composer = await screen.findByTestId("in-situ-composer");
      expect(composer).toBeInTheDocument();
      expect(screen.getByText("0:25")).toBeInTheDocument();
      // Single line short note has inline save button
      expect(screen.getByTestId("save-note-btn-inline")).toBeInTheDocument();
      expect(screen.queryByTestId("save-note-btn-bottom")).not.toBeInTheDocument();
    });

    test("shifts save button below text when multi-line", async () => {
      renderNotesTab({
        composer: {
          timestamp: 25,
          draft: "Line 1\nLine 2",
          wasPlaying: true,
        },
      });

      await screen.findByTestId("in-situ-composer");
      expect(screen.getByTestId("save-note-btn-bottom")).toBeInTheDocument();
      expect(screen.queryByTestId("save-note-btn-inline")).not.toBeInTheDocument();
      // Desktop keyboard hint stays out of the mobile composer footer.
      expect(screen.queryByText(/Shift\+Enter to save/)).not.toBeInTheDocument();
    });

    test("Shift+Enter commits note and resumes playback if wasPlaying", async () => {
      const playSpy = vi.spyOn(playerBridge.commands, "play");
      const onComposerChange = vi.fn();

      renderNotesTab({
        composer: {
          timestamp: 45,
          draft: "Keyboard saved note",
          wasPlaying: true,
        },
        onComposerChange,
      });

      const textarea = await screen.findByPlaceholderText("Write a note…");
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

      await waitFor(() => {
        expect(invokeMock).toHaveBeenCalledWith("save_video_item", expect.objectContaining({
          urlHash: "hash-1",
          item: expect.objectContaining({
            videoTime: 45,
            notes: expect.arrayContaining([expect.stringContaining("Keyboard saved note")]),
          }),
        }));
      });

      expect(onComposerChange).toHaveBeenCalledWith(null);
      expect(playSpy).toHaveBeenCalled();
      playSpy.mockRestore();
    });

    test("Enter key without modifiers does NOT commit note", async () => {
      renderNotesTab({
        composer: {
          timestamp: 45,
          draft: "Drafting",
          wasPlaying: false,
        },
      });

      const textarea = await screen.findByPlaceholderText("Write a note…");
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false, ctrlKey: false });

      expect(invokeMock).not.toHaveBeenCalledWith("save_video_item", expect.anything());
    });

    test("Esc key cancels note and resumes playback if wasPlaying", async () => {
      const playSpy = vi.spyOn(playerBridge.commands, "play");
      const onComposerChange = vi.fn();

      renderNotesTab({
        composer: {
          timestamp: 45,
          draft: "Discard me",
          wasPlaying: true,
        },
        onComposerChange,
      });

      const textarea = await screen.findByPlaceholderText("Write a note…");
      fireEvent.keyDown(textarea, { key: "Escape" });

      expect(onComposerChange).toHaveBeenCalledWith(null);
      expect(playSpy).toHaveBeenCalled();
      playSpy.mockRestore();
    });
  });

  describe("Surface Ergonomics (Mobile vs Desktop)", () => {
    test("does not render mobile action bar on desktop (!isMobile)", async () => {
      renderNotesTab({ isMobile: false });
      await screen.findByText("voiced note");
      expect(screen.queryByTestId("mobile-action-bar")).not.toBeInTheDocument();
    });

    test("renders 3-action bottom bar on mobile (isMobile: true)", async () => {
      renderNotesTab({ isMobile: true });
      await screen.findByText("voiced note");
      expect(screen.getByTestId("mobile-action-bar")).toBeInTheDocument();
      expect(screen.getByTestId("mobile-voice-btn")).toBeInTheDocument();
      expect(screen.getByTestId("mobile-type-btn")).toBeInTheDocument();
    });
  });
});
