import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(screen.getByLabelText("Back 15 seconds")).toBeInTheDocument();
    expect(screen.getByLabelText("Forward 15 seconds")).toBeInTheDocument();
    expect(screen.getByLabelText("Playback speed")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();
    expect(screen.getByLabelText("Fullscreen")).toBeInTheDocument();
  });

  it("dispatches seek commands from the ±15s buttons", () => {
    const { player, calls } = makeFakePlayer();
    playerBridge.attach(player);
    renderChrome();

    fireEvent.click(screen.getByLabelText("Forward 15 seconds"));
    fireEvent.click(screen.getByLabelText("Back 15 seconds"));

    expect(calls).toContain("seekTo:15");
    expect(calls).toContain("seekTo:0");
    expect(getPlayerSnapshot().time).toBe(0);
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
});
