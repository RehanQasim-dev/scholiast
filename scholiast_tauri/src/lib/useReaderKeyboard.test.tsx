import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  READER_NEXT_ANNOTATION_EVENT,
  useReaderKeyboard,
} from "./useReaderKeyboard";

function key(key: string, modifiers?: { ctrl?: boolean }) {
  fireEvent(
    window,
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...(modifiers?.ctrl ? { ctrlKey: true } : {}),
    }),
  );
}

describe("useReaderKeyboard", () => {
  test("j/k emit the annotation-step contract events", () => {
    const onFocusModeToggle = vi.fn();
    const onScrollTop = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ onFocusModeToggle, onScrollTop }),
    );

    const seen: number[] = [];
    const listener = (event: Event) => {
      expect(event.type).toBe(READER_NEXT_ANNOTATION_EVENT);
      seen.push((event as CustomEvent<{ direction: 1 | -1 }>).detail.direction);
    };
    window.addEventListener(READER_NEXT_ANNOTATION_EVENT, listener);

    key("j");
    key("k");
    window.removeEventListener(READER_NEXT_ANNOTATION_EVENT, listener);

    expect(seen).toEqual([1, -1]);
    expect(onFocusModeToggle).not.toHaveBeenCalled();
  });

  test("f toggles focus mode", () => {
    const onFocusModeToggle = vi.fn();
    renderHook(() => useReaderKeyboard({ onFocusModeToggle, onScrollTop: vi.fn() }));
    key("f");
    expect(onFocusModeToggle).toHaveBeenCalledTimes(1);
  });

  test("g g within the window scrolls to top once", () => {
    const onScrollTop = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ onFocusModeToggle: vi.fn(), onScrollTop }),
    );
    key("g");
    expect(onScrollTop).not.toHaveBeenCalled();
    key("g");
    expect(onScrollTop).toHaveBeenCalledTimes(1);
    key("g");
    expect(onScrollTop).toHaveBeenCalledTimes(1);
  });

  test("keys typed in an editable target are ignored", () => {
    const onFocusModeToggle = vi.fn();
    const onScrollTop = vi.fn();
    const seen: unknown[] = [];
    window.addEventListener(READER_NEXT_ANNOTATION_EVENT, (e) => seen.push(e));
    renderHook(() => useReaderKeyboard({ onFocusModeToggle, onScrollTop }));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    for (const k of ["j", "k", "f", "g", "g"]) {
      fireEvent.keyDown(input, { key: k });
    }

    expect(seen).toEqual([]);
    expect(onFocusModeToggle).not.toHaveBeenCalled();
    expect(onScrollTop).not.toHaveBeenCalled();
  });

  test("modifier combos are ignored", () => {
    const onFocusModeToggle = vi.fn();
    renderHook(() => useReaderKeyboard({ onFocusModeToggle, onScrollTop: vi.fn() }));
    key("f", { ctrl: true });
    expect(onFocusModeToggle).not.toHaveBeenCalled();
  });

  test("enabled=false detaches the listener", () => {
    const onFocusModeToggle = vi.fn();
    renderHook(() =>
      useReaderKeyboard({ enabled: false, onFocusModeToggle, onScrollTop: vi.fn() }),
    );
    key("f");
    expect(onFocusModeToggle).not.toHaveBeenCalled();
  });
});
