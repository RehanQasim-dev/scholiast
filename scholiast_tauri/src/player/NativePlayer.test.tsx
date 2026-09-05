import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import NativePlayer from "./NativePlayer";
import { getNativeElement, playerBridge } from "./playerBridge";
import type { StreamManifestView } from "../lib/readerIpc";
import { TauriFetchLoader } from "./hlsLoader";

const resolveManifest = vi.fn();
const fetchCaptionVtt = vi.fn();

vi.mock("./youtubeEngine", () => ({
  resolveManifest: (args: unknown) => resolveManifest(args),
  fetchCaptionVtt: (args: unknown) => fetchCaptionVtt(args),
}));

const hlsMocks = vi.hoisted(() => ({
  ctor: vi.fn(),
  isSupported: vi.fn(() => false),
  instances: [] as Array<{
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("hls.js", () => ({
  default:   class MockHls {
    static isSupported = () => hlsMocks.isSupported();
    static Events = { ERROR: "hlsError" };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    on = vi.fn();
    constructor(config: unknown) {
      hlsMocks.ctor(config);
      hlsMocks.instances.push(this);
    }
  },
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
    hlsMocks.instances.length = 0;
    hlsMocks.isSupported.mockReturnValue(false);
    playerBridge.resetForTests();
    resolveManifest.mockResolvedValue(manifest());
    fetchCaptionVtt.mockRejectedValue(new Error("no captions"));
  });

  test("feeds the video element and registers the bridge backend", async () => {
    renderPlayer();
    const video = (await screen.findByTestId("native-video")) as HTMLVideoElement;
    await waitFor(() => expect(video.getAttribute("src")).toBe("https://example.com/v18"));
    expect(getNativeElement()).toBe(video);
  });

  test("resolve failure reports through onFallback", async () => {
    resolveManifest.mockRejectedValue(new Error("private video"));
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

  test("plays iOS HLS through the Tauri loader when supported", async () => {
    hlsMocks.isSupported.mockReturnValue(true);
    resolveManifest.mockResolvedValue(
      manifest({ iosHlsUrl: "https://hls/x.m3u8" }),
    );
    renderPlayer();

    const video = (await screen.findByTestId("native-video")) as HTMLVideoElement;
    await waitFor(() => expect(hlsMocks.instances).toHaveLength(1));
    const hls = hlsMocks.instances[0]!;
    expect(hlsMocks.ctor).toHaveBeenCalledWith(
      expect.objectContaining({ loader: TauriFetchLoader }),
    );
    expect(hls.loadSource).toHaveBeenCalledWith("https://hls/x.m3u8");
    expect(hls.attachMedia).toHaveBeenCalledWith(video);
    // Classic path stays parked: no direct src set.
    expect(video.getAttribute("src")).toBeNull();
  });

  test("fatal hls error reports through onFallback", async () => {
    hlsMocks.isSupported.mockReturnValue(true);
    resolveManifest.mockResolvedValue(
      manifest({ iosHlsUrl: "https://hls/x.m3u8" }),
    );
    const onFallback = vi.fn();
    renderPlayer(onFallback);

    await waitFor(() => expect(hlsMocks.instances).toHaveLength(1));
    const onError = hlsMocks.instances[0]!.on.mock.calls.find(
      (call) => call[0] === "hlsError",
    )?.[1] as ((event: unknown, data: { fatal: boolean; details?: string }) => void) | undefined;
    expect(onError).toBeDefined();
    onError!({}, { fatal: false, details: "fragLoadError" });
    expect(onFallback).not.toHaveBeenCalled();
    onError!({}, { fatal: true, details: "bufferStalledError" });
    await waitFor(() =>
      expect(onFallback).toHaveBeenCalledWith(
        expect.stringContaining("bufferStalledError"),
      ),
    );
  });

  test("falls back to classic when HLS is unsupported", async () => {
    hlsMocks.isSupported.mockReturnValue(false);
    resolveManifest.mockResolvedValue(
      manifest({ iosHlsUrl: "https://hls/x.m3u8" }),
    );
    renderPlayer();
    const video = (await screen.findByTestId("native-video")) as HTMLVideoElement;
    await waitFor(() => expect(video.getAttribute("src")).toBe("https://example.com/v18"));
    expect(hlsMocks.instances).toHaveLength(0);
  });
});
