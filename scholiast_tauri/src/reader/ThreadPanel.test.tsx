import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HighlightPayload } from "../lib/readerIpc";
import ThreadPanel from "./ThreadPanel";

const listHighlights = vi.fn();
const saveHighlight = vi.fn();
const updateHighlightColor = vi.fn();
const deleteHighlight = vi.fn();
const saveComment = vi.fn();
const deleteComment = vi.fn();

vi.mock("../lib/readerIpc", () => ({
  listHighlights: (args: unknown) => listHighlights(args),
  saveHighlight: (args: unknown) => saveHighlight(args),
  updateHighlightColor: (args: unknown) => updateHighlightColor(args),
  deleteHighlight: (args: unknown) => deleteHighlight(args),
  saveComment: (args: unknown) => saveComment(args),
  deleteComment: (args: unknown) => deleteComment(args),
}));

vi.mock("../lib/ipc", () => ({
  invokeCommand: vi.fn(async (command: string) =>
    command === "list_tags" ? [] : null,
  ),
}));

// In-memory stand-in for the Rust store so invalidation refetches observe
// the same truth the mocks persisted.
let rows: HighlightPayload[];

const row = (over: Partial<HighlightPayload> & { id: string }): HighlightPayload => ({
  type: "text",
  content: `Quote ${over.id}`,
  notes: [],
  color: "yellow",
  ...over,
});

function renderPanel(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ThreadPanel urlHash="h1" />
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  rows = [
    row({
      id: "m1",
      content: "First quoted sentence.",
      notes: ["First note<!--timestamp:1000-->"],
    }),
    row({ id: "m2", content: "Second quoted sentence.", color: "red" }),
  ];
  listHighlights.mockImplementation(async () => rows);
  saveHighlight.mockImplementation(
    async (args: { highlight: HighlightPayload }) => {
      const i = rows.findIndex((r) => r.id === args.highlight.id);
      if (i >= 0) rows[i] = args.highlight;
      else rows.push(args.highlight);
    },
  );
  updateHighlightColor.mockResolvedValue(true);
  deleteHighlight.mockImplementation(async (args: { highlightId: string }) => {
    rows = rows.filter((r) => r.id !== args.highlightId);
    return true;
  });
  saveComment.mockImplementation(
    async (args: { highlightId: string; note: string }) => {
      const target = rows.find((r) => r.id === args.highlightId)!;
      target.notes ??= [];
      const cid = /timestamp:(\d+)/.exec(args.note)![1];
      const at = target.notes.findIndex((n) => n.includes(`timestamp:${cid}`));
      if (at >= 0) target.notes[at] = args.note;
      else target.notes.push(args.note);
      return {
        id: cid,
        body: args.note.replace(/<!--.*?-->/g, ""),
        createdAt: Number(cid),
        editedAt: /edited:\d+/.test(args.note) ? Number(cid) : null,
      };
    },
  );
  deleteComment.mockImplementation(async (args: { commentId: string }) => {
    for (const r of rows) {
      r.notes = (r.notes ?? []).filter(
        (n) => !n.includes(`timestamp:${args.commentId}`),
      );
    }
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ThreadPanel", () => {
  test("renders cards newest-first; clicking expands thread and focuses reply", async () => {
    renderPanel();

    expect(await screen.findByText("Second quoted sentence.")).toBeInTheDocument();
    const quotes = screen.getAllByTestId("thread-quote");
    expect(quotes[0]).toHaveTextContent("Second quoted sentence.");
    expect(screen.queryByTestId("reply-composer")).not.toBeInTheDocument();

    fireEvent.click(quotes[0]);
    const composer = await screen.findByTestId("reply-composer");
    expect(composer).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Reply")),
    );
  });

  test("empty page shows the annotate hint", async () => {
    rows = [];
    renderPanel();
    expect(await screen.findByTestId("threads-empty")).toHaveTextContent(
      "Select text in the article to annotate",
    );
  });

  test("recolor calls update_highlight_color and refetches", async () => {
    renderPanel();
    const card = await screen.findByTestId("thread-card-m1");
    fireEvent.click(within(card).getByRole("button", { name: "Recolor red" }));
    await waitFor(() =>
      expect(updateHighlightColor).toHaveBeenCalledWith({
        highlightId: "m1",
        color: "red",
      }),
    );
    await waitFor(() => expect(listHighlights).toHaveBeenCalledTimes(2));
  });

  test("delete annotation is undoable; undo re-saves the same payload", async () => {
    renderPanel();
    const cards = await screen.findAllByTestId(/^thread-card-/);
    fireEvent.click(within(cards[0]).getByTestId("delete-thread"));
    await waitFor(() =>
      expect(deleteHighlight).toHaveBeenCalledWith({ highlightId: "m2" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("thread-card-m2")).not.toBeInTheDocument(),
    );

    expect(screen.getByTestId("undo-bar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("undo-button"));
    await waitFor(() => expect(saveHighlight).toHaveBeenCalledTimes(1));
    const restored = saveHighlight.mock.calls[0][0] as {
      urlHash: string;
      highlight: HighlightPayload;
    };
    expect(restored.urlHash).toBe("h1");
    expect(restored.highlight.id).toBe("m2");
    expect(restored.highlight.content).toBe("Second quoted sentence.");
    await waitFor(() =>
      expect(screen.getByTestId("thread-card-m2")).toBeInTheDocument(),
    );
  });

  test("j/k cycles the active thread through the list", async () => {
    renderPanel();
    await screen.findByTestId("thread-card-m2");

    window.dispatchEvent(
      new CustomEvent("reader:next-annotation", { detail: { direction: 1 } }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("thread-card-m2")).toHaveAttribute(
        "data-active",
        "true",
      ),
    );

    window.dispatchEvent(
      new CustomEvent("reader:next-annotation", { detail: { direction: -1 } }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("thread-card-m1")).toHaveAttribute(
        "data-active",
        "true",
      ),
    );
    expect(screen.getByTestId("thread-card-m2")).not.toHaveAttribute(
      "data-active",
    );
  });

  test("reply saves a fresh timestamp id and refetches", async () => {
    renderPanel();
    const card = await screen.findByTestId("thread-card-m2");
    fireEvent.click(within(card).getByTestId("thread-quote"));
    fireEvent.change(await screen.findByLabelText("Reply"), {
      target: { value: "My reply" },
    });
    fireEvent.click(screen.getByTestId("reply-send"));
    await waitFor(() => expect(saveComment).toHaveBeenCalledTimes(1));
    const args = saveComment.mock.calls[0][0] as {
      highlightId: string;
      note: string;
    };
    expect(args.highlightId).toBe("m2");
    expect(args.note).toMatch(/^My reply<!--timestamp:\d+-->$/);
    await waitFor(() =>
      expect(screen.getByText("My reply")).toBeInTheDocument(),
    );
  });

  test("edit keeps the timestamp id exactly and stamps edited", async () => {
    renderPanel();
    const card = await screen.findByTestId("thread-card-m1");
    fireEvent.click(within(card).getByTestId("thread-quote"));
    fireEvent.click(await screen.findByTestId("edit-comment-1000"));
    const box = screen.getByLabelText("Edit comment") as HTMLTextAreaElement;
    expect(box.value).toBe("First note");
    fireEvent.change(box, { target: { value: "Edited body" } });
    fireEvent.click(screen.getByTestId("save-comment-edit"));
    await waitFor(() => expect(saveComment).toHaveBeenCalledTimes(1));
    const args = saveComment.mock.calls[0][0] as { note: string };
    expect(args.note).toMatch(/^Edited body<!--timestamp:1000--><!--edited:\d+-->$/);
  });

  test("delete comment is undoable; undo restores the original marker string", async () => {
    renderPanel();
    const card = await screen.findByTestId("thread-card-m1");
    fireEvent.click(within(card).getByTestId("thread-quote"));
    fireEvent.click(await screen.findByTestId("delete-comment-1000"));
    await waitFor(() =>
      expect(deleteComment).toHaveBeenCalledWith({ commentId: "1000" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("First note")).not.toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("undo-button"));
    await waitFor(() => expect(saveComment).toHaveBeenCalledTimes(1));
    expect(saveComment.mock.calls[0][0]).toEqual({
      highlightId: "m1",
      note: "First note<!--timestamp:1000-->",
    });
    await waitFor(() =>
      expect(screen.getByText("First note")).toBeInTheDocument(),
    );
  });
});
