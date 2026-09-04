import { beforeEach, describe, expect, test } from "vitest";
import {
  installSelectionBridge,
  setSelectionEditableFlag,
} from "./selectionBridge";

function selectNode(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("selectionBridge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.getSelection()?.removeAllRanges();
    delete (window as unknown as Record<string, unknown>).AndroidSelection;
  });

  test("missing bridge never throws", () => {
    expect(() => setSelectionEditableFlag(true)).not.toThrow();
  });

  test("classifies article text vs editable fields", () => {
    const calls: boolean[] = [];
    (window as unknown as Record<string, unknown>).AndroidSelection = {
      setSelectionEditable: (editable: boolean) => {
        calls.push(editable);
      },
    };
    installSelectionBridge();
    installSelectionBridge(); // idempotent

    const article = document.createElement("p");
    article.textContent = "article prose";
    const box = document.createElement("textarea");
    document.body.append(article, box);

    selectNode(article);
    selectNode(box);
    selectNode(article);
    expect(calls).toEqual([false, true, false]);
  });

  test("contenteditable=false counts as article", () => {
    const calls: boolean[] = [];
    (window as unknown as Record<string, unknown>).AndroidSelection = {
      setSelectionEditable: (editable: boolean) => {
        calls.push(editable);
      },
    };
    installSelectionBridge();

    const locked = document.createElement("div");
    locked.setAttribute("contenteditable", "false");
    locked.textContent = "locked";
    const box = document.createElement("textarea");
    document.body.append(locked, box);
    selectNode(box);
    selectNode(locked);
    expect(calls).toEqual([true, false]);
  });
});
