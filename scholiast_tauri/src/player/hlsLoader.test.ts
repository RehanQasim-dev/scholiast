import { beforeEach, describe, expect, test, vi } from "vitest";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { LoaderCallbacks, LoaderContext } from "hls.js";
import {
  resetHlsLoaderForTests,
  setHlsPotToken,
  TauriFetchLoader,
  withPot,
} from "./hlsLoader";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

const tauriFetchMock = vi.mocked(tauriFetch);

function context(overrides: Partial<LoaderContext> = {}): LoaderContext {
  return {
    url: "https://rr1---sn.googlevideo.com/videoplayback?x",
    responseType: "arraybuffer",
    ...overrides,
  } as LoaderContext;
}

function callbacks() {
  return {
    onSuccess: vi.fn(),
    onError: vi.fn(),
    onTimeout: vi.fn(),
    onAbort: vi.fn(),
  } as unknown as LoaderCallbacks<LoaderContext>;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  resetHlsLoaderForTests();
});

describe("withPot", () => {
  test("appends pot to bare googlevideo URLs only", () => {
    expect(withPot("https://rr1---sn.googlevideo.com/v?a=b", "tok")).toContain(
      "pot=tok",
    );
    expect(
      withPot("https://rr1---sn.googlevideo.com/v?pot=old", "tok"),
    ).toContain("pot=old");
    expect(withPot("https://www.youtube.com/api/x", "tok")).not.toContain(
      "pot=",
    );
    expect(withPot("not a url", "tok")).toBe("not a url");
    expect(withPot("https://rr1---sn.googlevideo.com/v", null)).not.toContain(
      "pot=",
    );
  });
});

describe("TauriFetchLoader", () => {
  test("downloads segments through the Rust fetch with Range + pot", async () => {
    setHlsPotToken("po-test");
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    tauriFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => bytes,
    } as Response);

    const loader = new TauriFetchLoader();
    const cb = callbacks();
    loader.load(
      context({ rangeStart: 0, rangeEnd: 99 }),
      {} as never,
      cb,
    );
    await flush();

    expect(tauriFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("pot=po-test"),
      expect.objectContaining({
        headers: expect.objectContaining({ Range: "bytes=0-99" }),
      }),
    );
    expect(cb.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ data: bytes }),
      expect.anything(),
      expect.anything(),
      null,
    );
  });

  test("reads text for playlists and surfaces HTTP failures", async () => {
    tauriFetchMock.mockResolvedValue({
      ok: true,
      text: async () => "#EXTM3U",
    } as Response);
    const loader = new TauriFetchLoader();
    const cb = callbacks();
    loader.load(context({ responseType: "text" }), {} as never, cb);
    await flush();
    expect(cb.onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ data: "#EXTM3U" }),
      expect.anything(),
      expect.anything(),
      null,
    );

    tauriFetchMock.mockResolvedValue({ ok: false, status: 403 } as Response);
    const cb2 = callbacks();
    new TauriFetchLoader().load(context(), {} as never, cb2);
    await flush();
    expect(cb2.onError).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("403") }),
      expect.anything(),
      null,
      expect.anything(),
    );
  });

  test("abort reports onAbort instead of success", async () => {
    let release!: (v: unknown) => void;
    tauriFetchMock.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }) as never,
    );
    const loader = new TauriFetchLoader();
    const cb = callbacks();
    loader.load(context(), {} as never, cb);
    loader.abort();
    release({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
    await flush();
    expect(cb.onAbort).toHaveBeenCalled();
    expect(cb.onSuccess).not.toHaveBeenCalled();
  });
});
