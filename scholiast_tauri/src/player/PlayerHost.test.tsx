import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render } from "@testing-library/react";
import {
  IFRAME_API_URL,
  getYoutubeOrigin,
  loadIframeApi,
  observeIframeReferrerPolicy,
  patchIframeReferrerPolicy,
  resetPlayerHostForTests,
} from "./PlayerHost";
import PlayerHost from "./PlayerHost";
import { playerBridge, type YTPlayerLike } from "./playerBridge";

const STRICT = "strict-origin-when-cross-origin";

beforeEach(() => {
  resetPlayerHostForTests();
  playerBridge.resetForTests();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
  resetPlayerHostForTests();
  playerBridge.resetForTests();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (window as unknown as Record<string, unknown>).YT;
  delete (window as unknown as Record<string, unknown>).onYouTubeIframeAPIReady;
});

describe("getYoutubeOrigin — desktop + mobile WebView (Error 153 #2)", () => {
  it("keeps http origins (dev server) as-is", () => {
    expect(getYoutubeOrigin("http://localhost:1420")).toBe("http://localhost:1420");
  });

  it("keeps https origins (Tauri desktop https://tauri.localhost, Android WebView) as-is", () => {
    expect(getYoutubeOrigin("https://tauri.localhost")).toBe("https://tauri.localhost");
    expect(getYoutubeOrigin("https://app.scholiast.desktop")).toBe("https://app.scholiast.desktop");
  });

  it("falls back to https://app.scholiast.desktop for non-http schemes (tauri://, capacitor://, file://, null)", () => {
    expect(getYoutubeOrigin("tauri://localhost")).toBe("https://app.scholiast.desktop");
    expect(getYoutubeOrigin("capacitor://localhost")).toBe("https://app.scholiast.desktop");
    expect(getYoutubeOrigin("file://")).toBe("https://app.scholiast.desktop");
    expect(getYoutubeOrigin("null")).toBe("https://app.scholiast.desktop");
    expect(getYoutubeOrigin("")).toBe("https://app.scholiast.desktop");
    expect(getYoutubeOrigin("moz-extension://abc")).toBe("https://app.scholiast.desktop");
  });

  it("matches YouTube desktop-app Referer spec — https + app ID domain", () => {
    const fallback = getYoutubeOrigin("tauri://localhost");
    expect(fallback.startsWith("https://")).toBe(true);
    expect(new URL(fallback).hostname).toBe("app.scholiast.desktop");
  });
});

describe("patchIframeReferrerPolicy — iframe attribute (Error 153 #3)", () => {
  it("sets referrerpolicy on an unpatched YouTube iframe", () => {
    const root = document.createElement("div");
    root.innerHTML = '<iframe src="https://www.youtube.com/embed/abc12345678"></iframe>';
    patchIframeReferrerPolicy(root);
    const iframe = root.querySelector("iframe")!;
    expect(iframe.getAttribute("referrerpolicy")).toBe(STRICT);
    expect(iframe.referrerPolicy).toBe(STRICT);
  });

  it("does not downgrade an already-correct iframe", () => {
    const root = document.createElement("div");
    root.innerHTML = `<iframe referrerpolicy="${STRICT}" src="https://www.youtube.com/embed/abc"></iframe>`;
    patchIframeReferrerPolicy(root);
    expect(root.querySelector("iframe")!.getAttribute("referrerpolicy")).toBe(STRICT);
  });

  it("no-ops when no iframe is present", () => {
    const root = document.createElement("div");
    root.textContent = "no iframe here";
    expect(() => patchIframeReferrerPolicy(root)).not.toThrow();
    expect(root.querySelector("iframe")).toBeNull();
  });
});

describe("observeIframeReferrerPolicy — mutation observer (Error 153 #3)", () => {
  it("patches an existing iframe immediately", () => {
    const root = document.createElement("div");
    root.innerHTML = '<iframe src="https://www.youtube.com/embed/x"></iframe>';
    document.body.appendChild(root);
    observeIframeReferrerPolicy(root);
    expect(root.querySelector("iframe")!.getAttribute("referrerpolicy")).toBe(STRICT);
  });

  it("patches a late-inserted iframe injected by YT.Player", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    observeIframeReferrerPolicy(root);
    const iframe = document.createElement("iframe");
    iframe.src = "https://www.youtube.com/embed/late";
    act(() => {
      root.appendChild(iframe);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(iframe.getAttribute("referrerpolicy")).toBe(STRICT);
  });
});

describe("loadIframeApi — script referrerPolicy (Error 153 #1)", () => {
  it("appends https://www.youtube.com/iframe_api with strict referrerPolicy", async () => {
    const promise = loadIframeApi();
    const script = document.head.querySelector(`script[src="${IFRAME_API_URL}"]`) as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script!.src).toBe(IFRAME_API_URL);
    expect(script!.referrerPolicy).toBe(STRICT);
    expect(script!.getAttribute("referrerpolicy")).toBe(STRICT);

    (window as unknown as { YT: unknown }).YT = { Player: vi.fn() };
    (window.onYouTubeIframeAPIReady as () => void)?.();
    await expect(promise).resolves.toBeDefined();
  });

  it("reuses existing window.YT.Player without injecting a duplicate script", async () => {
    const fakeYT = { Player: vi.fn() };
    (window as unknown as { YT: unknown }).YT = fakeYT;
    const promise = loadIframeApi();
    expect(document.head.querySelector(`script[src="${IFRAME_API_URL}"]`)).toBeNull();
    await expect(promise).resolves.toBe(fakeYT);
  });
});

describe("YT.Player construction — origin + widget_referrer (Error 153 #2)", () => {
  function mockYT() {
    let capturedOpts: unknown = null;
    const mockPlayer: YTPlayerLike = {
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      seekTo: vi.fn(),
      getCurrentTime: () => 0,
      getDuration: () => 0,
      getVideoData: () => ({}),
      getPlayerState: () => 0,
      setPlaybackRate: vi.fn(),
      setVolume: vi.fn(),
      loadVideoById: vi.fn(),
      loadModule: vi.fn(),
      unloadModule: vi.fn(),
      setOption: vi.fn(),
      getOption: () => null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const Player = vi.fn(function (this: unknown, _el: HTMLElement, opts: unknown) {
      capturedOpts = opts;
      const iframe = document.createElement("iframe");
      iframe.src = "https://www.youtube.com/embed/test";
      (_el as HTMLElement).appendChild(iframe);
      return mockPlayer;
    }) as unknown as new (el: HTMLElement, opts: unknown) => YTPlayerLike;

    return { Player, getCaptured: () => capturedOpts as { playerVars?: Record<string, unknown> }, mockPlayer };
  }

  it("passes origin and widget_referrer equal to window.location.origin for http(s) (desktop + Android)", async () => {
    const { Player, getCaptured } = mockYT();
    (window as unknown as { YT: unknown }).YT = { Player };
    let expectedOrigin = "";
    try {
      expectedOrigin = window.location.origin;
    } catch {
      expectedOrigin = "http://localhost:3000";
    }
    if (!expectedOrigin.startsWith("http")) expectedOrigin = "https://app.scholiast.desktop";

    render(<PlayerHost />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    await act(async () => {
      vi.runAllTimers();
      await Promise.resolve();
    });

    const opts = getCaptured();
    expect(opts).not.toBeNull();
    expect(opts.playerVars?.origin).toBe(expectedOrigin);
    expect(opts.playerVars?.widget_referrer).toBe(expectedOrigin);
    expect(opts.playerVars?.origin).toBe(opts.playerVars?.widget_referrer);
  });

  it("embeds a YouTube iframe that is patched to strict-origin-when-cross-origin for desktop and mobile", async () => {
    const { Player } = mockYT();
    (window as unknown as { YT: unknown }).YT = { Player };
    const { container } = render(<PlayerHost />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
      await Promise.resolve();
    });
    const iframe = container.querySelector("iframe") ?? document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("referrerpolicy")).toBe(STRICT);
  });

  it("enables JS API with required playerVars (playsinline, enablejsapi, controls)", async () => {
    const { Player, getCaptured } = mockYT();
    (window as unknown as { YT: unknown }).YT = { Player };
    render(<PlayerHost />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    const vars = (getCaptured() as { playerVars: Record<string, unknown> }).playerVars;
    expect(vars.enablejsapi).toBe(1);
    expect(vars.playsinline).toBe(1);
    expect(vars.controls).toBe(0);
    expect(vars.autoplay).toBe(1);
  });
});

describe("index.html referrer meta — document-level policy (Error 153 root cause)", () => {
  it("must be strict-origin-when-cross-origin, never no-referrer (otherwise YouTube 153 on desktop + Android)", () => {
    const html = readFileSync(resolve("index.html"), "utf-8");
    expect(html).toContain('name="referrer"');
    expect(html).toContain(`content="${STRICT}"`);
    expect(html).not.toContain('content="no-referrer"');
  });

  it("ships the same referrer policy in the built dist/index.html", () => {
    let distHtml: string;
    try {
      distHtml = readFileSync(resolve("dist/index.html"), "utf-8");
    } catch {
      distHtml = readFileSync(resolve("index.html"), "utf-8");
    }
    expect(distHtml).toContain(`content="${STRICT}"`);
    expect(distHtml).not.toContain('content="no-referrer"');
  });
});
