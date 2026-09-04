import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Chrome from "./Chrome";
import {
  getPlayerSnapshot,
  playerBridge,
  YT_STATE,
  type YTPlayerLike,
} from "./playerBridge";

function makeFakePlayer() {
  const listeners: Record<string, ((e: { data: number }) => void)[]> = {};
  const calls: string[] = [];
  const fire = (event: string, value = 0) =>
    act(() => {
      listeners[event]?.forEach((fn) => fn({ data: value }));
    });
  const player: YTPlayerLike = {
    playVideo: () => calls.push("playVideo"),
    pauseVideo: () => calls.push("pauseVideo"),
    seekTo: (seconds) => calls.push(`seekTo:${seconds}`),
    getCurrentTime: () => getPlayerSnapshot().time,
    getDuration: () => 120,
    getVideoData: () => ({ title: "Lecture" }),
    getPlayerState: () => YT_STATE.PLAYING,
    setPlaybackRate: (rate) => calls.push(`setPlaybackRate:${rate}`),
    setVolume: (volume) => calls.push(`setVolume:${volume}`),
    loadVideoById: (id) => calls.push(`loadVideoById:${id}`),
    loadModule: (m) => calls.push(`loadModule:${m}`),
    unloadModule: (m) => calls.push(`unloadModule:${m}`),
    setOption: (m, option) =>
      calls.push(`setOption:${m}:${JSON.stringify(option)}`),
    getOption: (_m, option) =>
      option === "tracklist" ? [{ languageCode: "en" }] : null,
    addEventListener: (event, fn) => {
      (listeners[event] ??= []).push(fn);
    },
    removeEventListener: (event, fn) => {
      listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
    },
  };
  return { player, fire, calls };
}

beforeEach(() => {
  playerBridge.resetForTests();
});

afterEach(() => {
  cleanup();
});

function renderChrome() {
  const stageRef = createRef<HTMLDivElement>();
  return render(
    <div ref={stageRef}>
      <Chrome stageRef={stageRef} />
    </div>,
  );
}

describe("Chrome", () => {
  it("renders the playback controls", () => {
    renderChrome();

    expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(2);
    expect(screen.getByLabelText("Seek")).toBeInTheDocument();
    expect(screen.getByLabelText("Playback speed")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();
    expect(screen.getByLabelText("Fullscreen")).toBeInTheDocument();
  });

  it("dispatches seek via double-tap on stage (left/right) — 10s step", () => {
    const { player, calls } = makeFakePlayer();
    playerBridge.attach(player);
    renderChrome();
    const root = screen.getByTestId("chrome-root");
    Object.defineProperty(root, "getBoundingClientRect", {
      value: () => ({ left: 0, width: 1000, top: 0, height: 200, right: 1000, bottom: 200 } as DOMRect),
    });
    fireEvent.click(root, { clientX: 100 });
    fireEvent.click(root, { clientX: 100 });
    expect(calls.some((c) => c.startsWith("seekTo:"))).toBe(true);
  });

  it("toggles play/pause from player state and dispatches pause", () => {
    const { player, fire, calls } = makeFakePlayer();
    playerBridge.attach(player);
    renderChrome();
    expect(screen.getAllByRole("button", { name: "Play" })).toHaveLength(2);

    fire("onStateChange", YT_STATE.PLAYING);
    expect(screen.getAllByRole("button", { name: "Pause" })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Pause" })[0]);
    expect(calls).toContain("pauseVideo");
  });

  it("changes playback speed through the menu", () => {
    const { player, calls } = makeFakePlayer();
    playerBridge.attach(player);
    renderChrome();

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Playback speed"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "1.5×" }));

    expect(calls).toContain("setPlaybackRate:1.5");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("surfaces embedding-disabled errors as an overlay message", () => {
    const { player, fire } = makeFakePlayer();
    playerBridge.attach(player);
    renderChrome();

    fire("onError", 150);

    expect(screen.getByRole("alert")).toHaveTextContent(/embedding disabled/i);
  });

  it("surfaces referrer configuration error 153 as an overlay message (Error 153 regression)", () => {
    const { player, fire } = makeFakePlayer();
    playerBridge.attach(player);
    renderChrome();

    fire("onError", 153);

    expect(screen.getByRole("alert")).toHaveTextContent(/configuration error/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/missing referrer/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/YouTube now requires a referrer/i);
  });

  it("clears error 153 when playback resumes (playing/buffering)", () => {
    const { player, fire } = makeFakePlayer();
    playerBridge.attach(player);
    renderChrome();

    fire("onError", 153);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fire("onStateChange", YT_STATE.PLAYING);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fire("onError", 153);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fire("onStateChange", YT_STATE.BUFFERING);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces generic player errors with their code", () => {
    const { player, fire } = makeFakePlayer();
    playerBridge.attach(player);
    renderChrome();

    fire("onError", 2);
    expect(screen.getByRole("alert")).toHaveTextContent(/Invalid video ID/i);

    fire("onStateChange", YT_STATE.PLAYING);
    fire("onError", 999);
    expect(screen.getByRole("alert")).toHaveTextContent(/Player error \(999\)/i);
  });

  it("shows the top title bar with back only when onBack is set", () => {
    const { player } = makeFakePlayer();
    playerBridge.attach(player);
    renderChrome();
    expect(screen.queryByTestId("chrome-topbar")).not.toBeInTheDocument();

    cleanup();
    const stageRef = createRef<HTMLDivElement>();
    let backed = false;
    render(
      <div ref={stageRef}>
        <Chrome stageRef={stageRef} title="Lecture" onBack={() => { backed = true; }} />
      </div>,
    );
    expect(screen.getByTestId("chrome-topbar")).toHaveTextContent("Lecture");
    fireEvent.click(screen.getByRole("button", { name: "Back to library" }));
    expect(backed).toBe(true);
  });

  it("hides the top title bar when the stage is tapped (title gone)", () => {
    vi.useFakeTimers();
    try {
      const { player } = makeFakePlayer();
      playerBridge.attach(player);
      const stageRef = createRef<HTMLDivElement>();
      render(
        <div ref={stageRef}>
          <Chrome stageRef={stageRef} title="Lecture" onBack={() => {}} />
        </div>,
      );
      expect(screen.getByTestId("chrome-topbar").className).toContain("opacity-100");

      fireEvent.click(screen.getByTestId("chrome-root"));
      act(() => {
        vi.advanceTimersByTime(400);
      });

      expect(screen.getByTestId("chrome-topbar").className).toContain("opacity-0");
    } finally {
      vi.useRealTimers();
    }
  });
});
