import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi, afterEach } from "vitest";
import useIsTablet, { TABLET_QUERY } from "./useIsTablet";

describe("useIsTablet", () => {
  const originalMatchMedia = window.matchMedia;
  const originalNavigator = window.navigator;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    Object.defineProperty(window, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
  });

  test("returns false when touch capability is absent", () => {
    Object.defineProperty(window, "navigator", {
      value: { maxTouchPoints: 0 },
      configurable: true,
    });
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useIsTablet());
    expect(result.current).toBe(false);
  });

  test("returns true when touch capability is present and viewport is tablet size", () => {
    Object.defineProperty(window, "navigator", {
      value: { maxTouchPoints: 5 },
      configurable: true,
    });
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === TABLET_QUERY,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useIsTablet());
    expect(result.current).toBe(true);
  });
});
