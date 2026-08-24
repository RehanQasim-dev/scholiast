import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, test, vi } from "vitest";
import LibraryRail from "./LibraryRail";
import type { ArticleSummary } from "../../lib/readerIpc";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const invokeMock = vi.mocked(invoke);
const openUrlMock = vi.mocked(openUrl);

const articles: ArticleSummary[] = [
  {
    urlHash: "hash-a",
    url: "https://example.com/essay",
    title: "The Craft of Reading",
    domain: "example.com",
    updatedAt: Date.now() - 3_600_000,
  },
  {
    urlHash: "hash-b",
    url: "https://news.ycombinator.com/item?id=1",
    title: null,
    domain: "news.ycombinator.com",
    updatedAt: Date.now(),
  },
];

function LocationProbe() {
  const [params] = useSearchParams();
  return <div data-testid="probe">{params.toString()}</div>;
}

function renderRail(props: Partial<Parameters<typeof LibraryRail>[0]> = {}) {
  const onSelect = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/reader"]}>
        <Routes>
          <Route
            path="/reader"
            element={
              <>
                <LibraryRail
                  activeUrlHash={props.activeUrlHash ?? null}
                  onSelect={onSelect}
                  onAddError={props.onAddError}
                />
                <LocationProbe />
              </>
            }
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onSelect, ...view };
}

describe("LibraryRail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_articles") return { ok: true, data: articles };
      return { ok: true, data: null };
    });
  });

  test("renders saved articles with title, domain and relative date", async () => {
    renderRail({ activeUrlHash: "hash-a" });
    expect(await screen.findByText("The Craft of Reading")).toBeInTheDocument();
    expect(screen.getByText(/example\.com · 1h ago/)).toBeInTheDocument();
    expect(screen.getByText(/news\.ycombinator\.com · just now/)).toBeInTheDocument();
    expect(
      screen.getByTestId("article-item-hash-a"),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getByTestId("article-item-hash-b")).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("search filter narrows by title or domain", async () => {
    renderRail();
    await screen.findByText("The Craft of Reading");
    fireEvent.change(screen.getByLabelText("Filter articles"), {
      target: { value: "craft" },
    });
    expect(screen.getByTestId("article-item-hash-a")).toBeInTheDocument();
    expect(screen.queryByTestId("article-item-hash-b")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filter articles"), {
      target: { value: "ycombinator" },
    });
    expect(screen.getByTestId("article-item-hash-b")).toBeInTheDocument();
    expect(screen.queryByTestId("article-item-hash-a")).not.toBeInTheDocument();
  });

  test("click selects the article; ctrl+click opens the source instead", async () => {
    const { onSelect } = renderRail();
    const item = await screen.findByTestId("article-item-hash-a");
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith(articles[0]);

    fireEvent.click(item, { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith("https://example.com/essay");
    });
  });

  test("add article navigates to the new page params", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_articles") return { ok: true, data: articles };
      if (command === "add_article") {
        return { ok: true, data: { urlHash: "hash-new", title: "Fresh" } };
      }
      return { ok: true, data: null };
    });
    renderRail();
    const input = await screen.findByLabelText("Add article URL");
    fireEvent.change(input, { target: { value: "https://example.com/new" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).toBe(
        "url=https%3A%2F%2Fexample.com%2Fnew&h=hash-new",
      );
    });
  });

  test("typed add errors surface mapped copy", async () => {
    const cases: Array<[string, string]> = [
      ["fetchBlocked", "Site blocked extraction"],
      ["notReadable", "Not an article"],
      ["network", "Offline?"],
    ];
    for (const [kind, copy] of cases) {
      invokeMock.mockImplementation(async (command: string) => {
        if (command === "list_articles") return { ok: true, data: articles };
        return {
          ok: false,
          error: { kind, message: `kind ${kind}` },
        };
      });
      const { unmount } = renderRail();
      const input = await screen.findByLabelText("Add article URL");
      fireEvent.change(input, { target: { value: "https://example.com/x" } });
      fireEvent.submit(input.closest("form")!);
      expect(await screen.findByRole("alert")).toHaveTextContent(copy);
      unmount();
    }
  });
});
