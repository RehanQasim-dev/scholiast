import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import Reader from "./Reader";
import { setPrefsStoreForTests } from "../lib/store";
import type { ArticleSummary } from "../lib/readerIpc";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const invokeMock = vi.mocked(invoke);

const articles: ArticleSummary[] = [
  {
    urlHash: "hash-test",
    url: "https://example.com/mobile-article",
    title: "Mobile Gestures in Reader",
    domain: "example.com",
    updatedAt: Date.now(),
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

function renderReaderMobile(initialUrl = "/reader?url=https%3A%2F%2Fexample.com%2Fmobile-article&h=hash-test") {
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

describe("Mobile Reader Gesture Comments Sheet", () => {
  const store = fakePrefsStore();

  beforeAll(() => {
    Object.defineProperty(Element.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      writable: true,
      value: 800,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    store.data.clear();
    setPrefsStoreForTests(store);

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_articles") return { ok: true, data: articles };
      if (command === "get_page") {
        return {
          ok: true,
          data: {
            urlHash: "hash-test",
            url: "https://example.com/mobile-article",
            title: "Mobile Gestures in Reader",
            body: "<p>Mobile reading requires zero bottom obstruction.</p>",
            capturedAt: Date.now(),
            updatedAt: Date.now(),
          },
        };
      }
      if (command === "list_highlights") {
        return {
          ok: true,
          data: [
            {
              type: "text",
              id: "hl-mobile-1",
              content: "Mobile reading requires zero bottom obstruction.",
              notes: ["Great point!<!--timestamp:123456-->"],
              color: "yellow",
              updatedAt: Date.now(),
            },
          ],
        };
      }
      return { ok: true, data: null };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("invariant 11: default state is closed with 0 height and no scrim", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");
    expect(slot).toHaveAttribute("data-state", "closed");
    expect(slot).toHaveClass("translate-y-full", "h-0", "opacity-0");
    expect(screen.queryByTestId("thread-sheet-scrim")).not.toBeInTheDocument();
  });

  test("invariant 12: swipe up from bottom edge opens at half height", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");
    expect(slot).toHaveAttribute("data-state", "closed");

    // Touch at bottom edge (clientY = 775 >= 800 - 45 = 755)
    fireEvent.touchStart(window, {
      touches: [{ clientY: 775 }],
    });
    // Move upward (deltaY = 650 - 750 = -100 < -30)
    fireEvent.touchEnd(window, {
      changedTouches: [{ clientY: 650 }],
    });

    expect(slot).toHaveAttribute("data-state", "half");
    expect(slot).toHaveClass("translate-y-0", "opacity-100");
  });

  test("invariant 12b: edge drag follows the thumb live, snaps on release", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");

    fireEvent.touchStart(window, { touches: [{ clientY: 770 }] });
    fireEvent.touchMove(window, { touches: [{ clientY: 600 }] });
    // Live height tracks the thumb before release (800 - 600).
    expect(slot.style.height).toBe("200px");
    fireEvent.touchEnd(window, { changedTouches: [{ clientY: 600 }] });

    expect(slot).toHaveAttribute("data-state", "half");
    expect(slot.style.height).toBe("");
  });

  test("invariant 13: drag handle up from half expands to expanded (70%)", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");

    // Open to half via bottom swipe
    fireEvent.touchStart(window, { touches: [{ clientY: 775 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientY: 650 }] });
    expect(slot).toHaveAttribute("data-state", "half");

    // Drag up on handle: sheet follows live, settles expanded
    const handle = screen.getByTestId("thread-sheet-handle");
    fireEvent.touchStart(handle, { touches: [{ clientY: 600 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 300 }] });
    expect(slot.style.height).toBe("500px");
    fireEvent.touchEnd(handle, { changedTouches: [{ clientY: 300 }] });

    expect(slot).toHaveAttribute("data-state", "expanded");
    expect(await screen.findByTestId("thread-sheet-scrim")).toBeInTheDocument();
  });

  test("invariant 14: drag handle down far closes sheet completely", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");

    // Open to half
    fireEvent.touchStart(window, { touches: [{ clientY: 775 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientY: 650 }] });
    expect(slot).toHaveAttribute("data-state", "half");

    // Drag down on handle past the close threshold
    const handle = screen.getByTestId("thread-sheet-handle");
    fireEvent.touchStart(handle, { touches: [{ clientY: 400 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 700 }] });
    expect(slot.style.height).toBe("100px");
    fireEvent.touchEnd(handle, { changedTouches: [{ clientY: 740 }] });

    expect(slot).toHaveAttribute("data-state", "closed");
  });

  test("invariant 15: double clicking or double tapping article area dismisses the sheet", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");

    // Open to half
    fireEvent.touchStart(window, { touches: [{ clientY: 775 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientY: 650 }] });
    expect(slot).toHaveAttribute("data-state", "half");

    // Double click on article scroller
    const scroller = screen.getByTestId("article-scroller");
    fireEvent.doubleClick(scroller);

    expect(slot).toHaveAttribute("data-state", "closed");
  });

  test("close button and backdrop click dismiss the sheet", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");

    // Open to half
    fireEvent.touchStart(window, { touches: [{ clientY: 775 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientY: 650 }] });
    expect(slot).toHaveAttribute("data-state", "half");

    // Click close button
    fireEvent.click(screen.getByTestId("close-thread-sheet"));
    expect(slot).toHaveAttribute("data-state", "closed");

    // Open and expand
    fireEvent.touchStart(window, { touches: [{ clientY: 775 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientY: 650 }] });
    const handle = screen.getByTestId("thread-sheet-handle");
    fireEvent.click(handle); // clicking handle expands half to expanded
    expect(slot).toHaveAttribute("data-state", "expanded");

    // Click scrim
    const scrim = screen.getByTestId("thread-sheet-scrim");
    fireEvent.click(scrim);
    expect(slot).toHaveAttribute("data-state", "closed");
  });

  test("invariant 16: mobile topbar offers Swipe toggle instead of notes (sheet opens via pill)", async () => {
    renderReaderMobile();
    // Notes toggle is replaced by the Swipe toggle on narrow screens
    expect(screen.queryByLabelText("Toggle annotations panel")).not.toBeInTheDocument();
    const swipeToggle = await screen.findByTestId("reader-swipe-toggle");
    expect(swipeToggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(swipeToggle);
    expect(swipeToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(swipeToggle);
    expect(swipeToggle).toHaveAttribute("aria-pressed", "false");

    // Notes sheet still opens via the floating pill
    const slot = screen.getByTestId("thread-panel-slot");
    expect(slot).toHaveAttribute("data-state", "closed");
    fireEvent.click(await screen.findByTestId("reader-comments-pill"));
    expect(slot).toHaveAttribute("data-state", "half");
  });

  test("invariant 17: floating comments pill opens sheet on tap without gesture conflict", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");
    expect(slot).toHaveAttribute("data-state", "closed");

    const pill = await screen.findByTestId("reader-comments-pill");
    expect(pill).toBeInTheDocument();

    fireEvent.click(pill);
    expect(slot).toHaveAttribute("data-state", "half");
  });

  test("invariant 18: bottom-edge strip opens the sheet; touches above it are article scrolls", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");
    expect(slot).toHaveAttribute("data-state", "closed");

    // Touch flush with the bottom edge (clientY = 780 >= 800 - 45 = 755)
    fireEvent.touchStart(window, { touches: [{ clientY: 780 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientY: 650 }] });

    // Sheet opens from the edge strip
    expect(slot).toHaveAttribute("data-state", "half");
  });

  test("invariant 18b: swipe starting above the edge strip never opens the sheet", async () => {
    renderReaderMobile();
    const slot = await screen.findByTestId("thread-panel-slot");
    expect(slot).toHaveAttribute("data-state", "closed");

    // Mid-article swipe (clientY = 700 < 800 - 45 = 755) is a scroll, not a sheet drag
    fireEvent.touchStart(window, { touches: [{ clientY: 700 }] });
    fireEvent.touchEnd(window, { changedTouches: [{ clientY: 600 }] });

    expect(slot).toHaveAttribute("data-state", "closed");
  });
});
