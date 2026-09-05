import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import NativePlayer from "./NativePlayer";
import { getNativeElement, playerBridge } from "./playerBridge";
import type { StreamManifestView } from "../lib/readerIpc";

const resolveStream = vi.fn();
const fetchVideoCaptions = vi.fn();

vi.mock("../lib/readerIpc", () => ({
  resolveStream: (args: unknown) => resolveStream(args),
  fetchVideoCaptions: (args: unknown) => fetchVideoCaptions(args),
}));

vi.mock("../lib/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/store")>();
  return { ...actual, getPref: vi.fn(async () => "en") };
});

const manifest = (overrides: Partial<StreamManifestView> = {}): StreamManifestView => ({
  videoId: "vid1",
  title: "Lecture",
  lengthSeconds: 60,
  streams: [
    {
      itag: 18,
      kind: "progressive",
      mime: "video/mp4",
      codecs: 'codecs="avc1"',
      url: "https://example.com/v18",
    },
  ],
  captions: [],
  ...overrides,
});

function renderPlayer(onFallback: (reason: string) => void = () => {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NativePlayer videoId="vid1" onFallback={onFallback} />
    </QueryClientProvider>,
  );
}

describe("NativePlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playerBridge.resetForTests();
    resolveStream.mockResolvedValue(manifest());
    fetchVideoCaptions.mockRejectedValue(new Error("no captions"));
  });

  test("feeds the video element and registers the bridge backend", async () => {
    renderPlayer();
    const video = (await screen.findByTestId("native-video")) as HTMLVideoElement;
    await waitFor(() => expect(video.getAttribute("src")).toBe("https://example.com/v18"));
    expect(getNativeElement()).toBe(video);
  });

  test("resolve failure reports through onFallback", async () => {
    resolveStream.mockRejectedValue(new Error("private video"));
    const onFallback = vi.fn();
    renderPlayer(onFallback);
    await waitFor(() => expect(onFallback).toHaveBeenCalledWith("private video"));
  });

  test("unmount detaches the bridge backend", async () => {
    const view = renderPlayer();
    await screen.findByTestId("native-video");
    expect(getNativeElement()).not.toBeNull();
    view.unmount();
    expect(getNativeElement()).toBeNull();
  });
});
