/*
 * Reports the current selection kind to the Android host so MainActivity can
 * suppress the OS floating text-selection toolbar (Copy/Share/Select all)
 * over article text — where it covers the in-app SwatchPopup — while keeping
 * it inside editable fields where copy/paste is needed.
 *
 * Pure DOM classification; the native side owns the menu. No-ops wherever
 * the AndroidSelection bridge is absent (desktop, tests, older builds).
 */

/** Elements inside which the OS selection toolbar must stay (copy/paste).
 * Single source for the parent classifier below and the iframe-injected
 * script (`darkReaderScript.ts` interpolates this same const), so the two
 * sides can never disagree about what counts as editable. */
export const EDITABLE_SELECTOR = "input, textarea, [contenteditable]";

/** Pure classification of one selection anchor; unit-tested. */
export function isEditableAnchor(anchor: Node | null): boolean {
  const element =
    anchor?.nodeType === Node.ELEMENT_NODE
      ? (anchor as Element)
      : anchor?.parentElement;
  if (!element?.closest) return false;
  if (element.closest('[contenteditable="false"]')) return false;
  return Boolean(element.closest(EDITABLE_SELECTOR));
}

interface AndroidSelectionBridge {
  setSelectionEditable?: (editable: boolean) => void;
}

function bridge(): AndroidSelectionBridge | undefined {
  try {
    const candidate = (window as unknown as Record<string, unknown>)
      .AndroidSelection as AndroidSelectionBridge | undefined;
    return typeof candidate?.setSelectionEditable === "function"
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}

/** Publish one classification to the host. Safe to call from anywhere. */
export function setSelectionEditableFlag(editable: boolean): void {
  try {
    bridge()?.setSelectionEditable?.(editable);
  } catch {
    /* bridge absent — nothing to report to */
  }
}

function selectionIsEditable(): boolean {
  return isEditableAnchor(document.getSelection()?.anchorNode ?? null);
}

let installed = false;
let lastReported: boolean | null = null;

/** Document-wide selectionchange classifier. Call once at startup. */
export function installSelectionBridge(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("selectionchange", () => {
    const editable = selectionIsEditable();
    if (editable === lastReported) return;
    lastReported = editable;
    setSelectionEditableFlag(editable);
  });
}
