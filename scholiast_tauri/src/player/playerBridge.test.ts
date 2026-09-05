import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPlayerSnapshot,
  playerBridge,
  YT_STATE,
  type YTPlayerLike,
} from "./playerBridge";

interface FakeData {
  title?: string;
  duration?: number;
  time?: number;
  state?: number;
}

function makeFakePlayer(data: FakeData = {}) {
  const listeners: Record<string, ((e: { data: number }) => void)[]> = {};
  const calls: string[] = [];
  const fire = (event: string, value = 0) =>
    listeners[event]?.forEach((fn) => fn({ data: value }));
  const player: YTPlayerLike = {
    playVideo: () => calls.push("playVideo"),
    pauseVideo: () => calls.push("pauseVideo"),
    seekTo: (seconds) => calls.push(`seekTo:${seconds}`),
    getCurrentTime: () => data.time ?? 0,
    getDuration: () => data.duration ?? 0,
    getVideoData: () => ({ title: data.title }),
    getPlayerState: () => data.state ?? YT_STATE.PLAYING,
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
  vi.useFakeTimers();
  playerBridge.resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("playerBridge", () => {
  it("wires YT events on attach and reports readiness + metadata", () => {
    const { player } = makeFakePlayer({ title: "Lecture 01", duration: 90 });
    const ready = vi.fn();
    const title = vi.fn();
    const duration = vi.fn();
    const captions = vi.fn();
    playerBridge.events.on("onPlayerReady", ready);
    playerBridge.events.on("onTitle", title);
    playerBridge.events.on("onDuration", duration);
    playerBridge.events.on("onCaptionsAvailable", captions);

    playerBridge.attach(player);

    expect(ready).toHaveBeenCalledTimes(1);
    expect(title).toHaveBeenCalledWith("Lecture 01");
    expect(duration).toHaveBeenCalledWith(90);
    expect(captions).toHaveBeenCalledWith(true);
    expect(getPlayerSnapshot().duration).toBe(90);
  });

  it("polls currentTime every 250ms while playing and stops on pause", () => {
    const { player, fire } = makeFakePlayer({ time: 12.5 });
    playerBridge.attach(player);
    const times: number[] = [];
    playerBridge.events.on("onTimeUpdate", (s) => times.push(s));

    fire("onStateChange", YT_STATE.PLAYING);
    vi.advanceTimersByTime(250);
    vi.advanceTimersByTime(250);
    expect(times).toEqual([12.5, 12.5]);

    fire("onStateChange", YT_STATE.PAUSED);
    vi.advanceTimersByTime(1000);
    expect(times).toEqual([12.5, 12.5]);
  });

  it("fans commands out to the player and clamps volume", () => {
    const { player, calls } = makeFakePlayer({ duration: 120 });
    playerBridge.attach(player);

    playerBridge.commands.play();
    playerBridge.commands.pause();
    playerBridge.commands.setRate(1.5);
    playerBridge.commands.setVolume(40);
    playerBridge.commands.setVolume(500);
    playerBridge.commands.seekTo(30);

    expect(calls).toContain("playVideo");
    expect(calls).toContain("pauseVideo");
    expect(calls).toContain("setPlaybackRate:1.5");
    expect(calls).toContain("setVolume:40");
    expect(calls).toContain("setVolume:100");
    expect(calls).toContain("seekTo:30");
    expect(calls).toContain("playVideo"); // seek preserved playing state
    expect(getPlayerSnapshot().rate).toBe(1.5);
    expect(getPlayerSnapshot().volume).toBe(100); // clamped from 500
    expect(getPlayerSnapshot().time).toBe(30);
  });

  it("seekBy moves relative to the snapshot and clamps to [0, duration)", () => {
    const { player, calls } = makeFakePlayer({
      duration: 120,
      state: YT_STATE.PAUSED,
    });
    playerBridge.attach(player);

    playerBridge.commands.seekTo(60);
    calls.length = 0;
    playerBridge.commands.seekBy(10);
    playerBridge.commands.seekBy(-30);
    expect(calls).toEqual(["seekTo:70", "seekTo:40"]);

    calls.length = 0;
    playerBridge.commands.seekTo(115);
    playerBridge.commands.seekBy(10);
    expect(calls).toContain("seekTo:119.75");

    calls.length = 0;
    playerBridge.commands.seekBy(-1000);
    expect(calls).toContain("seekTo:0");
  });

  it("loads a new id via loadVideoById and replays an unchanged id", () => {
    const { player, calls } = makeFakePlayer({});
    playerBridge.attach(player);

    playerBridge.commands.loadVideo("abc12345678");
    expect(calls).toContain("loadVideoById:abc12345678");

    playerBridge.commands.loadVideo("abc12345678");
    expect(calls).toContain("playVideo");

    playerBridge.commands.loadVideo("def98765432");
    expect(calls).toContain("loadVideoById:def98765432");
  });

  it("queues loadVideo before a host attaches and flushes once ready", () => {
    const { player, calls } = makeFakePlayer({});
    playerBridge.commands.loadVideo("xyz78901234");

    playerBridge.attach(player);

    expect(calls).toContain("loadVideoById:xyz78901234");
  });

  it("emits a final onTimeUpdate at ENDED and detaches cleanly", () => {
    const { player, fire } = makeFakePlayer({ duration: 60, time: 59 });
    const ready = vi.fn();
    playerBridge.events.on("onPlayerReady", ready);
    playerBridge.attach(player);
    const endedTimes: number[] = [];
    playerBridge.events.on("onTimeUpdate", (s) => endedTimes.push(s));

    fire("onStateChange", YT_STATE.ENDED);
    expect(endedTimes).toEqual([60]);
    expect(getPlayerSnapshot().playing).toBe(false);

    playerBridge.detach();
    fire("onStateChange", YT_STATE.PLAYING);
    vi.advanceTimersByTime(1000);
    expect(endedTimes).toEqual([60]);

    playerBridge.attach(player);
    expect(ready).toHaveBeenCalledTimes(2);

    fire("onStateChange", YT_STATE.PLAYING);
    vi.advanceTimersByTime(250);
    expect(endedTimes).toEqual([60, 59]);
  });
});
