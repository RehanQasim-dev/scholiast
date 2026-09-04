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
  setPlayerServerUrlForTests,
} from "./PlayerHost";
import PlayerHost from "./PlayerHost";
import { getPlayerSnapshot, playerBridge, type YTPlayerLike } from "./playerBridge";

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
    expect(vars.autoplay).toBe(0);
  });

  it("passes videoId prop directly to server URL on initial mount", async () => {
    setPlayerServerUrlForTests("http://127.0.0.1:4567/player");
    const { container } = render(<PlayerHost videoId="test_vid_abc" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toBe("http://127.0.0.1:4567/player?v=test_vid_abc");
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

describe("Tauri desktop loopback player server mode (Fixes Error 153 on Desktop + across platforms)", () => {
  const TEST_SERVER_URL = "http://127.0.0.1:45678/player";

  it("mounts an iframe pointing to local loopback server with strict-origin-when-cross-origin", async () => {
    setPlayerServerUrlForTests(TEST_SERVER_URL);
    playerBridge.commands.loadVideo("test_vid_123");

    const { container } = render(<PlayerHost />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toContain(TEST_SERVER_URL);
    expect(iframe!.src).toContain("v=test_vid_123");
    expect(iframe!.getAttribute("referrerpolicy")).toBe(STRICT);
    expect(iframe!.getAttribute("allow")).toContain("autoplay");
  });

  it("relays playback commands (play, pause, seekTo, loadVideo, rate, volume) to iframe via postMessage", async () => {
    setPlayerServerUrlForTests(TEST_SERVER_URL);
    const { container } = render(<PlayerHost />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    const iframe = container.querySelector("iframe")!;
    expect(iframe).not.toBeNull();

    const postMessages: unknown[] = [];
    const postMessageSpy = vi.fn((msg: unknown) => {
      postMessages.push(msg);
    });
    Object.defineProperty(iframe, "contentWindow", {
      value: { postMessage: postMessageSpy },
      configurable: true,
    });

    // Test Play
    playerBridge.commands.play();
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: "scholiast-player", command: "play" }),
      "*",
    );

    // Test Pause
    playerBridge.commands.pause();
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: "scholiast-player", command: "pause" }),
      "*",
    );

    // Test Seek
    playerBridge.commands.seekTo(35.5);
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: "scholiast-player", command: "seekTo", seconds: 35.5 }),
      "*",
    );

    // Test Load Video
    playerBridge.commands.loadVideo("new_lecture_456");
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: "scholiast-player", command: "loadVideo", videoId: "new_lecture_456" }),
      "*",
    );

    // Test Playback Rate
    playerBridge.commands.setRate(1.5);
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: "scholiast-player", command: "setRate", rate: 1.5 }),
      "*",
    );

    // Test Volume
    playerBridge.commands.setVolume(85);
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: "scholiast-player", command: "setVolume", volume: 85 }),
      "*",
    );

    // Test Captions
    playerBridge.commands.setCaptions(true);
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: "scholiast-player", command: "setCaptions", enabled: true }),
      "*",
    );
  });

  it("handles inbound events from loopback player iframe (ready, stateChange, time, title, captions, error)", async () => {
    setPlayerServerUrlForTests(TEST_SERVER_URL);

    const readyListener = vi.fn();
    const stateListener = vi.fn();
    const errorListener = vi.fn();
    const titleListener = vi.fn();
    const captionsListener = vi.fn();

    playerBridge.events.on("onPlayerReady", readyListener);
    playerBridge.events.on("onStateChange", stateListener);
    playerBridge.events.on("onError", errorListener);
    playerBridge.events.on("onTitle", titleListener);
    playerBridge.events.on("onCaptionsAvailable", captionsListener);

    render(<PlayerHost />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });

    // Simulate onPlayerReady from iframe
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "scholiast-player", type: "onPlayerReady" },
        }),
      );
    });
    expect(readyListener).toHaveBeenCalled();

    // Simulate onStateChange (PLAYING = 1)
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "scholiast-player", type: "onStateChange", data: 1 },
        }),
      );
    });
    expect(stateListener).toHaveBeenCalledWith(1);
    expect(getPlayerSnapshot().playing).toBe(true);

    // Simulate onTimeUpdate
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "scholiast-player", type: "onTimeUpdate", time: 42.5, duration: 600 },
        }),
      );
    });

    // Simulate onTitle
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "scholiast-player", type: "onTitle", title: "Introduction to Calculus" },
        }),
      );
    });
    expect(titleListener).toHaveBeenCalledWith("Introduction to Calculus");

    // Simulate onCaptionsAvailable
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "scholiast-player", type: "onCaptionsAvailable", available: true },
        }),
      );
    });
    expect(captionsListener).toHaveBeenCalledWith(true);

    // Simulate onError (e.g. 153 or 101)
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "scholiast-player", type: "onError", data: 153 },
        }),
      );
    });
    expect(errorListener).toHaveBeenCalledWith(153);
  });
});
