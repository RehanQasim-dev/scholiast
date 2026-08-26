import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import useIsNarrow, { NARROW_QUERY } from "./useIsNarrow";

type ChangeListener = (event: { matches: boolean }) => void;

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<ChangeListener>();
  const mql = {
    matches: initialMatches,
    media: NARROW_QUERY,
    addEventListener: (_type: string, cb: ChangeListener) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: ChangeListener) => {
      listeners.delete(cb);
    },
    addListener: (cb: ChangeListener) => {
      listeners.add(cb);
    },
    removeListener: (cb: ChangeListener) => {
      listeners.delete(cb);
    },
    emit(matches: boolean) {
      mql.matches = matches;
      for (const cb of [...listeners]) cb({ matches });
    },
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return mql;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useIsNarrow", () => {
  test("reports false when matchMedia is unavailable", () => {
    const { result } = renderHook(() => useIsNarrow());
    expect(result.current).toBe(false);
  });

  test("mirrors matchMedia.matches", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsNarrow());
    expect(result.current).toBe(true);
  });

  test("follows viewport changes via the change event", () => {
    const mql = stubMatchMedia(false);
    const { result } = renderHook(() => useIsNarrow());
    expect(result.current).toBe(false);
    act(() => mql.emit(true));
    expect(result.current).toBe(true);
    act(() => mql.emit(false));
    expect(result.current).toBe(false);
  });

  test("stops listening after unmount", () => {
    const mql = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useIsNarrow());
    unmount();
    act(() => mql.emit(true));
    expect(result.current).toBe(false);
  });
});
