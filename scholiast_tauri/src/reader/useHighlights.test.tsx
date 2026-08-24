import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { HighlightView } from "../lib/readerIpc";
import { splitRangeByBlocks, useHighlights } from "./useHighlights";

const listHighlights = vi.fn();
const saveHighlight = vi.fn();
const updateHighlightColor = vi.fn();
const deleteHighlight = vi.fn();

vi.mock("../lib/readerIpc", () => ({
  listHighlights: (args: unknown) => listHighlights(args),
  saveHighlight: (args: unknown) => saveHighlight(args),
  updateHighlightColor: (args: unknown) => updateHighlightColor(args),
  deleteHighlight: (args: unknown) => deleteHighlight(args),
}));

function makeWrapper() {
  // staleTime:Infinity keeps seeded cache fresh so background refetches can
  // never clobber an optimistic mid-test patch.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
    seed(rows: HighlightView[]) {
      client.setQueryData(["highlights", "h1"], rows);
    },
  };
}

const ROW_A: HighlightView = {
  type: "text",
  id: "a",
  content: "Alpha beta gamma.",
  notes: [],
  color: "yellow",
};

function mountFixture(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML =
    '<div id="art"><p>Alpha beta gamma.</p><p>Delta epsilon zeta.</p></div>';
  document.body.appendChild(host);
  return host.querySelector("#art")!;
}

function rangeOver(root: HTMLElement, text: string): Range {
  const full = root.textContent ?? "";
  const start = full.indexOf(text);
  if (start === -1) throw new Error(`missing "${text}"`);
  const tn = Array.from(root.querySelectorAll("p")).find((p) =>
    p.textContent?.includes(text),
  )!.firstChild as Text;
  const localStart = tn.data.indexOf(text);
  const r = document.createRange();
  r.setStart(tn, localStart);
  r.setEnd(tn, localStart + text.length);
  void start;
  return r;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("useHighlights", () => {
  test("lists saved highlights through list_highlights", async () => {
    listHighlights.mockResolvedValue([ROW_A]);
    const { result } = renderHook(() => useHighlights("h1"), {
      wrapper: makeWrapper().wrapper,
    });

    await waitFor(() => expect(result.current.highlights).toHaveLength(1));
    expect(listHighlights).toHaveBeenCalledWith({ urlHash: "h1" });
  });

  test("recolor applies optimistically and calls update_highlight_color", async () => {
    // Never settles: no invalidation can land, so the visible state is the
    // optimistic patch alone.
    updateHighlightColor.mockReturnValue(new Promise(() => {}));
    const h = makeWrapper();
    h.seed([{ ...ROW_A }]);
    listHighlights.mockResolvedValue([{ ...ROW_A }]);
    const { result } = renderHook(() => useHighlights("h1"), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.highlights).toHaveLength(1));

    act(() => result.current.recolor("a", "red"));

    // The mutation promise never settles, so no invalidation can follow:
    // what we observe is purely the optimistic patch.
    await waitFor(() => expect(result.current.highlights[0]?.color).toBe("red"));
    expect(updateHighlightColor).toHaveBeenCalledWith({
      highlightId: "a",
      color: "red",
    });
  });

  test("createFromSelection persists a camelCase payload with portable anchor", async () => {
    saveHighlight.mockResolvedValue(undefined);
    listHighlights.mockResolvedValue([]);
    const root = mountFixture();

    const { result } = renderHook(() => useHighlights("h1"), {
      wrapper: makeWrapper().wrapper,
    });
    result.current.paintRootRef.current = root;

    let ok: string | null = null;
    await act(async () => {
      ok = await result.current.createFromSelection(
        rangeOver(root, "beta gamma"),
        "red",
      );
    });

    // Representative id (first payload) — what 💬 hands to ThreadPanel.
    expect(ok).toBeTruthy();
    expect(typeof ok).toBe("string");
    expect(saveHighlight).toHaveBeenCalledTimes(1);
    const args = saveHighlight.mock.calls[0][0] as {
      urlHash: string;
      highlight: Record<string, unknown>;
    };
    expect(args.urlHash).toBe("h1");

    const hl = args.highlight;
    expect(hl.type).toBe("text");
    expect(typeof hl.id).toBe("string");
    expect(hl.content).toBe("beta gamma");
    expect(hl.color).toBe("red");
    expect(Array.isArray(hl.notes)).toBe(true);
    expect(typeof hl.updatedAt).toBe("number");

    // Portable anchor (task-24 shape, serde names per models.rs).
    const anchor = hl.anchor as {
      quote: { quote: string; prefix: string; suffix: string; occurrence: number };
      structural?: { surface: string; xpath: string; startOffset: number; endOffset: number };
    };
    expect(anchor.quote.quote).toBe("beta gamma");
    expect(anchor.quote.occurrence).toBe(0);
    expect(typeof anchor.quote.prefix).toBe("string");
    expect(typeof anchor.quote.suffix).toBe("string");
    expect(anchor.structural?.surface).toBe("web");

    // Top-level legacy fields mirror the structural anchor.
    expect(hl.xpath).toBe("./p[1]");
    expect(hl.startOffset).toBe(anchor.structural!.startOffset);
    expect(hl.endOffset).toBe(anchor.structural!.endOffset);

    // Single-block selection carries no groupId.
    expect(hl.groupId).toBeUndefined();
  });

  test("a selection spanning two blocks stores one highlight per block sharing groupId", async () => {
    saveHighlight.mockResolvedValue(undefined);
    listHighlights.mockResolvedValue([]);
    const root = mountFixture();
    const [p1, p2] = Array.from(root.querySelectorAll("p"));
    const r = document.createRange();
    r.setStart(p1.firstChild as Text, 0);
    r.setEnd(p2.firstChild as Text, (p2.firstChild as Text).data.length);

    const pieces = splitRangeByBlocks(r, root);
    expect(pieces.map((p) => p.toString())).toEqual([
      "Alpha beta gamma.",
      "Delta epsilon zeta.",
    ]);

    const { result } = renderHook(() => useHighlights("h1"), {
      wrapper: makeWrapper().wrapper,
    });
    result.current.paintRootRef.current = root;

    await act(async () => {
      await result.current.createFromSelection(r, "green");
    });

    expect(saveHighlight).toHaveBeenCalledTimes(2);
    const [first, second] = saveHighlight.mock.calls as Array<
      [{ highlight: { groupId?: string; content: string } }]
    >;
    expect(first[0].highlight.content).toBe("Alpha beta gamma.");
    expect(second[0].highlight.content).toBe("Delta epsilon zeta.");
    expect(first[0].highlight.groupId).toBeTruthy();
    expect(second[0].highlight.groupId).toBe(first[0].highlight.groupId);
  });

  test("remove drops the row optimistically and calls delete_highlight", async () => {
    // Never settles: the optimistic filter is the final visible state.
    deleteHighlight.mockReturnValue(new Promise(() => {}));
    const rows = [ROW_A, { ...ROW_A, id: "b", color: "red" }];
    const h = makeWrapper();
    h.seed(rows);
    listHighlights.mockResolvedValue(rows);
    const { result } = renderHook(() => useHighlights("h1"), { wrapper: h.wrapper });
    await waitFor(() => expect(result.current.highlights).toHaveLength(2));

    act(() => result.current.remove("a"));

    // Never-settling mutation ⇒ the optimistic filter is the final state.
    await waitFor(() =>
      expect(result.current.highlights.map((x) => x.id)).toEqual(["b"]),
    );
    expect(deleteHighlight).toHaveBeenCalledWith({ highlightId: "a" });
  });
});
