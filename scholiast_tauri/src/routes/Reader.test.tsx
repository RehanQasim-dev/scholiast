import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import Reader from "./Reader";
import {
  PREF_KEYS,
  setPrefsStoreForTests,
} from "../lib/store";
import type { ArticleSummary } from "../lib/readerIpc";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const invokeMock = vi.mocked(invoke);

const articles: ArticleSummary[] = [
  {
    urlHash: "hash-a",
    url: "https://example.com/essay",
    title: "The Craft of Reading",
    domain: "example.com",
    updatedAt: Date.now(),
  },
  {
    urlHash: "hash-b",
    url: "https://example.com/second",
    title: "Second Piece",
    domain: "example.com",
    updatedAt: Date.now() - 1000,
  },
];

function fakePrefsStore() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(key: string) => (data.has(key) ? (data.get(key) as T) : undefined),
    set: async (key: string, value: unknown) => {
      data.set(key, value);
    },
  };
}

function renderReader(initialUrl = "/reader") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Reader />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ESSAY_URL = `/reader?url=${encodeURIComponent("https://example.com/essay")}&h=hash-a`;

/** The article body's h1 (the topbar renders the same title as its own h1). */
function findArticleHeading(name: string) {
  return screen.findByText(name, { selector: ".sc-article-title" });
}

function queryArticleHeading(name: string) {
  return screen.queryByText(name, { selector: ".sc-article-title" });
}

describe("Reader shell", () => {
  const store = fakePrefsStore();

  beforeAll(() => {
    Object.defineProperty(Element.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    store.data.clear();
    // Extracted (clean reader) mode: the margin column, not the webview.
    store.data.set(PREF_KEYS.readerMode, "reader");
    setPrefsStoreForTests(store);
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === "list_articles") return { ok: true, data: articles };
      if (command === "get_page") {
        const { urlHash } = args as { urlHash: string };
        if (urlHash === "hash-a") {
          return {
            ok: true,
            data: {
              urlHash,
              url: "https://example.com/essay",
              title: "The Craft of Reading",
              body: "<p>Deep reading takes practice.</p>",
              capturedAt: Date.now(),
              updatedAt: Date.now(),
            },
          };
        }
        if (urlHash === "hash-b") {
          return {
            ok: true,
            data: {
              urlHash,
              url: "https://example.com/second",
              title: "Second Piece",
              body: "<p>Second body.</p>",
              capturedAt: Date.now(),
              updatedAt: Date.now(),
            },
          };
        }
        return { ok: true, data: null };
      }
      if (command === "delete_article") return { ok: true, data: true };
      if (command === "list_highlights") {
        const { urlHash } = args as { urlHash: string };
        return {
          ok: true,
          data:
            urlHash === "hash-a"
              ? [
                  {
                    type: "text",
                    id: "hl-1",
                    content: "Deep reading takes practice.",
                    notes: [],
                    color: "yellow",
                    updatedAt: Date.now(),
                  },
                ]
              : [],
        };
      }
      return { ok: true, data: null };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("deep link ?url&h opens that article and marks it active in the drawer rail", async () => {
    renderReader(ESSAY_URL);
    expect(await findArticleHeading("The Craft of Reading")).toBeInTheDocument();
    // The rail lives in the slide-out drawer on desktop.
    fireEvent.click(screen.getByTestId("tablet-dock-library"));
    expect(screen.getByTestId("article-item-hash-a")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("clicking a rail item switches articles via search params", async () => {
    renderReader(ESSAY_URL);
    await findArticleHeading("The Craft of Reading");
    fireEvent.click(screen.getByTestId("tablet-dock-library"));
    fireEvent.click(screen.getByTestId("article-item-hash-b"));
    expect(await findArticleHeading("Second Piece")).toBeInTheDocument();
    // Selecting closes the drawer; reopen to check the active marking.
    fireEvent.click(screen.getByTestId("tablet-dock-library"));
    expect(screen.getByTestId("article-item-hash-b")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("empty library shows copy plus an Add CTA that focuses the rail input", async () => {
    invokeMock.mockImplementation(async (command: string) =>
      command === "list_articles"
        ? { ok: true, data: [] }
        : { ok: true, data: null },
    );
    renderReader("/reader");
    expect(await screen.findByTestId("empty-library-state")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("empty-library-add"));
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("reader-add-article-input");
    });
  });

  test("failed add surfaces the extraction-failed variant with mapped copy", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_articles") return { ok: true, data: [] };
      return { ok: false, error: { kind: "fetchBlocked", message: "HTTP 403" } };
    });
    renderReader("/reader");
    await screen.findByTestId("empty-library-state");
    // The add form lives in the drawer rail; the empty-state CTA opens it.
    fireEvent.click(screen.getByTestId("empty-library-add"));
    const input = await screen.findByLabelText("Add article URL");
    fireEvent.change(input, { target: { value: "https://paywalled.example" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByTestId("extraction-failed-state")).toHaveTextContent(
      "Site blocked extraction",
    );
  });

  test("appearance popover toggles persist to the prefs store", async () => {
    renderReader(ESSAY_URL);
    await findArticleHeading("The Craft of Reading");

    fireEvent.click(
      screen.getByRole("button", { name: "Reading appearance settings" }),
    );
    fireEvent.click(screen.getByTestId("serif-toggle"));
    fireEvent.click(screen.getByText("Wide"));
    fireEvent.click(screen.getByTestId("font-step-up"));

    await waitFor(() => {
      expect(store.data.get(PREF_KEYS.readerSerif)).toBe(true);
    });
    expect(store.data.get(PREF_KEYS.readerColumnWidth)).toBe(800);
    expect(store.data.get(PREF_KEYS.readerFontStep)).toBe(1);

    expect(screen.getByTestId("serif-toggle")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("f toggles focus mode collapsing the topbar via CSS", async () => {
    renderReader(ESSAY_URL);
    await findArticleHeading("The Craft of Reading");
    expect(screen.getByTestId("topbar-wrap")).not.toHaveClass("-mt-[50px]");

    fireEvent.keyDown(window, { key: "f" });
    expect(screen.getByTestId("topbar-wrap")).toHaveClass("-mt-[50px]");

    fireEvent.keyDown(window, { key: "f" });
    expect(screen.getByTestId("topbar-wrap")).not.toHaveClass("-mt-[50px]");
  });

  test("typed-confirm delete removes the article and lands on the library", async () => {
    renderReader(ESSAY_URL);
    await findArticleHeading("The Craft of Reading");

    fireEvent.click(
      screen.getByRole("button", { name: "Reading appearance settings" }),
    );
    fireEvent.click(screen.getByTestId("delete-article-button"));
    fireEvent.change(screen.getByTestId("delete-confirm-input"), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByTestId("delete-confirm-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("delete_article", {
        urlHash: "hash-a",
      });
    });
    // Deleting the open article drops its hash: the inline library takes over.
    expect(
      await screen.findByTestId("library-rail"),
    ).toBeInTheDocument();
    expect(queryArticleHeading("The Craft of Reading")).not.toBeInTheDocument();
  });

  test("j/k dispatch the annotation contract events from within the shell", async () => {
    renderReader("/reader");
    await screen.findByTestId("library-rail");
    const seen: number[] = [];
    window.addEventListener("reader:next-annotation", (event) => {
      seen.push((event as CustomEvent<{ direction: number }>).detail.direction);
    });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "k" });
    expect(seen).toEqual([1, -1]);
  });

  test("j end-to-end activates the margin thread and focuses the reply; g g scrolls the column", async () => {
    renderReader(ESSAY_URL);
    await findArticleHeading("The Craft of Reading");

    const scrollSpy = vi.fn();
    const scroller = screen.getByTestId("article-scroller");
    vi.spyOn(scroller, "scrollTo").mockImplementation(scrollSpy);

    // The margin column mounts once annotations open.
    expect(screen.queryByTestId("margin-thread-card-hl-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("annotations-toggle"));

    fireEvent.keyDown(window, { key: "j" });
    expect(await screen.findByTestId("margin-thread-card-hl-1")).toHaveAttribute(
      "data-active",
      "true",
    );
    await waitFor(() => {
      expect(screen.getByLabelText("Reply")).toHaveFocus();
    });

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "g" });
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });
});
