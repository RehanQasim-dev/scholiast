import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, vi } from "vitest";
import Home from "./Home";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

const invokeMock = vi.mocked(invoke);

const recentVideos = [
  {
    urlHash: "hash-a",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    videoId: "dQw4w9WgXcQ",
    title: "Lecture one",
    resumeAt: 125,
    updatedAt: Date.now() - 3_600_000,
  },
  {
    urlHash: "hash-b",
    url: "https://youtu.be/jNQXAC9IVRw",
    videoId: "jNQXAC9IVRw",
    title: null,
    resumeAt: 0,
    updatedAt: Date.now(),
  },
];

function LocationProbe() {
  const [params] = useSearchParams();
  return <div data-testid="probe">{params.toString()}</div>;
}

function renderHome() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route path="/home" element={<Home />} />
          <Route path="/player" element={<LocationProbe />} />
          <Route path="/reader" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_recent_videos") return { ok: true, data: recentVideos };
      if (command === "upsert_video") return { ok: true, data: recentVideos[0] };
      if (command === "get_video_items") return { ok: true, data: [] };
      if (command === "add_article") return { ok: true, data: { urlHash: "hash-article", title: "Example" } };
      return { ok: true, data: null };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("renders the recent grid from the mocked query", async () => {
    renderHome();

    expect(await screen.findByText("Lecture one")).toBeInTheDocument();
    expect(
      document.querySelector(
        'img[src="https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg"]',
      ),
    ).not.toBeNull();
    expect(screen.getByText(/1h ago/)).toBeInTheDocument();
    expect(screen.getByText(/2:05/)).toBeInTheDocument();
  });

  test("card click navigates with a resume param only when resume data exists", async () => {
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: /Lecture one/ }));
    expect(screen.getByTestId("probe").textContent).toBe(
      "url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&resume=125",
    );
  });

  test("card without resume data navigates without the param", async () => {
    renderHome();
    fireEvent.click(await screen.findByRole("button", { name: /Me at the zoo|jNQXAC9IVRw/ }));
    expect(screen.getByTestId("probe").textContent).toBe(
      "url=https%3A%2F%2Fyoutu.be%2FjNQXAC9IVRw",
    );
  });

  test("thumbnail load failure falls back to a placeholder block", async () => {
    renderHome();
    await screen.findByText("Lecture one");
    const image = document.querySelector('img[src*="dQw4w9WgXcQ"]');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(screen.getAllByTestId("thumb-fallback")).toHaveLength(1);
    expect(
      document.querySelector('img[src*="dQw4w9WgXcQ"]'),
    ).toBeNull();
  });

  test("invalid link toasts and stays on home", async () => {
    renderHome();
    const input = await screen.findByLabelText("Paste YouTube or URL...");
    fireEvent.change(input, { target: { value: "https://www.youtube.com/watch?v=bad" } });
    fireEvent.submit(input.closest("form")!);
    expect(
      await screen.findByText("That link isn't a YouTube video URL"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("valid link upserts the normalized watch url and navigates", async () => {
    renderHome();
    const input = await screen.findByLabelText("Paste YouTube or URL...");
    fireEvent.change(input, { target: { value: "https://youtu.be/dQw4w9WgXcQ" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("upsert_video", {
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        videoId: "dQw4w9WgXcQ",
      });
    });
    expect(screen.getByTestId("probe").textContent).toBe(
      "url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
    );
  });

  test("single field has clipboard affordance and no mode toggle", async () => {
    renderHome();
    expect(await screen.findByLabelText("Paste YouTube or URL...")).toBeInTheDocument();
    expect(screen.getByLabelText("Paste from clipboard")).toBeInTheDocument();
    expect(screen.queryByTestId("mode-video")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mode-article")).not.toBeInTheDocument();
  });

  test("article url navigates to reader", async () => {
    renderHome();
    const input = await screen.findByLabelText("Paste YouTube or URL...");
    fireEvent.change(input, { target: { value: "https://example.com/article" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("add_article", { url: "https://example.com/article" });
    });
    expect(screen.getByTestId("probe").textContent).toContain("url=https%3A%2F%2Fexample.com%2Farticle");
  });

  test("paste button reads from AndroidBridge when available", async () => {
    (window as unknown as { AndroidBridge?: { getClipboardText: () => string } }).AndroidBridge = {
      getClipboardText: () => "https://example.com/pasted-via-bridge",
    };
    renderHome();
    const pasteBtn = screen.getByLabelText("Paste from clipboard");
    fireEvent.click(pasteBtn);
    await waitFor(() => {
      const input = screen.getByLabelText("Paste YouTube or URL...") as HTMLInputElement;
      expect(input.value).toBe("https://example.com/pasted-via-bridge");
    });
    delete (window as unknown as { AndroidBridge?: unknown }).AndroidBridge;
  });
});
