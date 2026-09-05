import { beforeAll, describe, expect, test, vi } from "vitest";
import {
  getDarkReaderScript,
  getScholiastIframeScript,
  SWIPE_SELECT_MESSAGE,
} from "./darkReaderScript";
import { EDITABLE_SELECTOR, isEditableAnchor } from "./selectionBridge";

const bridgeFn = vi.fn();
const postFn = vi.fn();

function touchEvent(
  type: string,
  touches: Array<{ clientX: number; clientY: number }>,
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  const withTouches = ev as unknown as Record<string, unknown>;
  withTouches.touches = touches;
  withTouches.changedTouches = touches;
  return ev;
}

function postMessage(type: string, data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent("message", { data: { type, ...data } }));
}

beforeAll(() => {
  document.body.innerHTML =
    '<p id="art">hello world from the article</p><input id="inp" value="x"><div id="ce" contenteditable="true">edit me</div>';
  (window as unknown as Record<string, unknown>).AndroidSelection = {
    setSelectionEditable: bridgeFn,
  };
  (window as unknown as { postMessage: (...args: unknown[]) => void }).postMessage =
    postFn;
  // Pin the caretRangeFromPoint path: jsdom implements neither caret API for
  // real, and the fallback is also the production WebView path. The stub
  // returns a collapsed caret at the finger x, like the real API (the
  // script reads startContainer/startOffset, so start must track x).
  const doc = document as unknown as Record<string, unknown>;
  doc.caretPositionFromPoint = undefined;
  doc.caretRangeFromPoint = (x: number) => {
    const text = document.getElementById("art")!.firstChild!;
    const r = document.createRange();
    r.setStart(text, x > 40 ? 5 : 0);
    r.setEnd(text, x > 40 ? 5 : 0);
    return r;
  };
  window.eval(getScholiastIframeScript("oled"));
});

describe("editable classification (shared parent/iframe contract)", () => {
  test("article text is not editable", () => {
    expect(isEditableAnchor(document.getElementById("art")!.firstChild!)).toBe(
      false,
    );
  });

  test("input and contenteditable anchors are editable", () => {
    expect(isEditableAnchor(document.getElementById("inp")!)).toBe(true);
    expect(isEditableAnchor(document.getElementById("ce")!.firstChild!)).toBe(
      true,
    );
  });

  test("contenteditable=false opts out", () => {
    const host = document.createElement("div");
    host.setAttribute("contenteditable", "false");
    host.textContent = "nope";
    document.body.appendChild(host);
    expect(isEditableAnchor(host.firstChild!)).toBe(false);
    host.remove();
  });

  test("null anchor is not editable", () => {
    expect(isEditableAnchor(null)).toBe(false);
  });

  test("iframe script embeds the shared selector and message type", () => {
    const script = getScholiastIframeScript("oled");
    expect(script).toContain(`'${SWIPE_SELECT_MESSAGE}'`);
    expect(script).toContain(`'${EDITABLE_SELECTOR}'`);
    expect(getDarkReaderScript("oled")).toContain("SET_SWIPE_SELECT");
  });
});

describe("iframe selection flow (evaled script, mocked host)", () => {
  test("article selection reports non-editable and posts TEXT_SELECTED", () => {
    document.dispatchEvent(touchEvent("touchstart", []));
    bridgeFn.mockClear();
    postFn.mockClear();
    document.getSelection()?.selectAllChildren(document.getElementById("art")!);
    document.dispatchEvent(new Event("selectionchange"));
    expect(bridgeFn).toHaveBeenLastCalledWith(false);
    expect(postFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "TEXT_SELECTED",
        text: "hello world from the article",
      }),
      "*",
    );
  });

  test("collapse posts SELECTION_CLEARED", () => {
    document.dispatchEvent(touchEvent("touchstart", []));
    postFn.mockClear();
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(postFn).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SELECTION_CLEARED" }),
      "*",
    );
  });

  test("SET_SWIPE_SELECT toggles touch-action inside the page", () => {
    postMessage(SWIPE_SELECT_MESSAGE, { enabled: true });
    expect(document.documentElement.style.touchAction).toBe("pan-y");
    postMessage(SWIPE_SELECT_MESSAGE, { enabled: false });
    expect(document.documentElement.style.touchAction).toBe("");
  });

  test("swipe drag suppresses live posts and commits on lift", () => {
    postMessage(SWIPE_SELECT_MESSAGE, { enabled: true });
    document.getSelection()?.removeAllRanges();
    postFn.mockClear();
    document.dispatchEvent(
      touchEvent("touchstart", [{ clientX: 10, clientY: 10 }]),
    );
    document.dispatchEvent(
      touchEvent("touchmove", [{ clientX: 80, clientY: 12 }]),
    );
    // Platform selectionchange mid-drag: the popup must stay hidden.
    document.dispatchEvent(new Event("selectionchange"));
    expect(postFn).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "TEXT_SELECTED" }),
      "*",
    );
    // Lift commits: exactly one immediate TEXT_SELECTED.
    document.dispatchEvent(
      touchEvent("touchend", [{ clientX: 80, clientY: 12 }]),
    );
    expect(postFn).toHaveBeenCalledWith(
      expect.objectContaining({ type: "TEXT_SELECTED" }),
      "*",
    );
    postMessage(SWIPE_SELECT_MESSAGE, { enabled: false });
  });
});
