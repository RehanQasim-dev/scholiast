import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { HighlightPayload } from "../lib/readerIpc";
import ArticleView from "./ArticleView";

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

const BODY =
  '<h2>Deep notes</h2><p>Alpha beta gamma delta.</p><p>Epsilon zeta eta.</p>';

let saved: HighlightPayload[] = [];

function renderReader(
  props: Partial<Parameters<typeof ArticleView>[0]> = {},
): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ArticleView title="Deep Dive" body={BODY} urlHash="h1" {...props} />
    </QueryClientProvider>,
  );
  return client;
}

function fakeSelection(range: Range | null): Selection {
  return {
    rangeCount: range ? 1 : 0,
    isCollapsed: !range,
    getRangeAt: () => range!,
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  } as unknown as Selection;
}

function selectionOver(root: HTMLElement, text: string): Range {
  const p = Array.from(root.querySelectorAll("p")).find((el) =>
    el.textContent?.includes(text),
  )!;
  const tn = p.firstChild as Text;
  const at = tn.data.indexOf(text);
  const range = document.createRange();
  range.setStart(tn, at);
  range.setEnd(tn, at + text.length);
  return range;
}

function articleRoot(): HTMLElement {
  return document.querySelector(".sc-article-body")!;
}

beforeEach(() => {
  document.body.innerHTML = "";
  saved = [];
  saveHighlight.mockImplementation(async (args: { highlight: HighlightPayload }) => {
    saved.push(args.highlight);
  });
  listHighlights.mockImplementation(async () => saved);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ArticleView annotations", () => {
  test("selection → swatch pick persists camelCase payload and repaints", async () => {
    renderReader();

    const range = selectionOver(articleRoot(), "beta gamma");
    (range as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
      () =>
        ({ top: 120, left: 200, right: 280, bottom: 138, width: 80, height: 18 }) as DOMRect;
    const sel = fakeSelection(range);
    vi.spyOn(window, "getSelection").mockReturnValue(sel);

    fireEvent.mouseUp(document.body);
    expect(await screen.findByTestId("swatch-popup")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("swatch-red"));

    await waitFor(() => expect(saveHighlight).toHaveBeenCalledTimes(1));
    const args = saveHighlight.mock.calls[0][0] as {
      urlHash: string;
      highlight: Record<string, unknown>;
    };
    // IPC arg shapes mirror commands/reader.rs + models.rs serde names.
    expect(args.urlHash).toBe("h1");
    expect(args.highlight.type).toBe("text");
    expect(args.highlight.content).toBe("beta gamma");
    expect(args.highlight.color).toBe("red");
    const anchor = args.highlight.anchor as {
      quote: { quote: string };
      structural?: { surface: string };
    };
    expect(anchor.quote.quote).toBe("beta gamma");
    expect(anchor.structural?.surface).toBe("web");

    // Popup dismissed and selection cleared after the pick.
    await waitFor(() =>
      expect(screen.queryByTestId("swatch-popup")).not.toBeInTheDocument(),
    );
    expect(
      (sel as unknown as { removeAllRanges: ReturnType<typeof vi.fn> })
        .removeAllRanges,
    ).toHaveBeenCalledTimes(1);

    // Repaint happens immediately (jsdom exercises the <mark> fallback).
    const mark = await waitFor(() => {
      const m = document.querySelector<HTMLDivElement>("mark[data-sc-hl]");
      if (!m) throw new Error("no mark yet");
      return m;
    });
    expect(mark.classList.contains("sc-hl-red")).toBe(true);
    expect(mark.textContent).toBe("beta gamma");
  });

  test("💬 creates a yellow highlight and reports it through onHighlightCreated", async () => {
    const onHighlightCreated = vi.fn();
    renderReader({ onHighlightCreated });

    const range = selectionOver(articleRoot(), "beta gamma");
    (range as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
      () =>
        ({ top: 120, left: 200, right: 280, bottom: 138, width: 80, height: 18 }) as DOMRect;
    const sel = fakeSelection(range);
    vi.spyOn(window, "getSelection").mockReturnValue(sel);

    fireEvent.mouseUp(document.body);
    fireEvent.click(await screen.findByTestId("swatch-comment"));

    await waitFor(() => expect(saveHighlight).toHaveBeenCalledTimes(1));
    const args = saveHighlight.mock.calls[0][0] as {
      highlight: { color?: string; id?: string };
    };
    // Yellow default per task-29 behavior; the created thread is handed up
    // so Reader can open it in ThreadPanel with the reply focused.
    expect(args.highlight.color).toBe("yellow");
    await waitFor(() =>
      expect(onHighlightCreated).toHaveBeenCalledWith(args.highlight.id),
    );
    const mark = await waitFor(() => {
      const m = document.querySelector<HTMLDivElement>("mark[data-sc-hl]");
      if (!m) throw new Error("no mark yet");
      return m;
    });
    expect(mark.classList.contains("sc-hl-yellow")).toBe(true);
    expect(
      (sel as unknown as { removeAllRanges: ReturnType<typeof vi.fn> })
        .removeAllRanges,
    ).toHaveBeenCalledTimes(1);
  });

  test("clicking a painted highlight reports its id through onHighlightClick", async () => {
    const onHighlightClick = vi.fn();
    saved.push({
      type: "text",
      id: "n1",
      content: "Epsilon zeta eta.",
      notes: [],
      color: "green",
    });
    renderReader({ onHighlightClick });

    const mark = await waitFor(() => {
      const m = document.querySelector<HTMLDivElement>('mark[data-sc-hl="n1"]');
      if (!m) throw new Error("no mark yet");
      return m;
    });
    fireEvent.click(mark);
    expect(onHighlightClick).toHaveBeenCalledWith("n1");
  });

  test("unplaced highlights surface a dismissible count chip", async () => {
    saved.push({
      type: "text",
      id: "ghost",
      content: "sentence that exists nowhere in this article body",
      notes: [],
      color: "yellow",
    });
    renderReader();

    const chip = await screen.findByTestId("unplaced-chip");
    expect(chip.getAttribute("aria-label")).toMatch(/could not be placed/);
    expect(chip.textContent).toContain("1 unplaced");

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss unplaced-highlights notice" }),
    );
    expect(screen.queryByTestId("unplaced-chip")).not.toBeInTheDocument();
  });

  test("without urlHash there is no annotation layer at all", () => {
    const sel = fakeSelection(null);
    vi.spyOn(window, "getSelection").mockReturnValue(sel);
    render(
      <ArticleView title="T" body="<p>Alpha beta.</p>" />,
    );

    fireEvent.mouseUp(document.body);
    expect(screen.queryByTestId("swatch-popup")).not.toBeInTheDocument();
    expect(listHighlights).not.toHaveBeenCalled();
    expect(document.querySelector("mark[data-sc-hl]")).toBeNull();
  });
});
