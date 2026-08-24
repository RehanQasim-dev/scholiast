import { useEffect, useRef } from "react";

/**
 * Reader keyboard layer.
 *
 * Contract (consumed by task-29 selection highlights / task-31 threads):
 * `j` / `k` dispatch a `CustomEvent<"reader:next-annotation">` on `window`
 * with `detail: { direction: 1 | -1 }` (1 = next annotation, -1 = previous).
 * Listeners own all scrolling/focusing of annotation placeholders; this hook
 * only emits. `f` toggles focus mode, `g g` (two `g` presses within 400ms)
 * scrolls to top. Keys are ignored while typing in editable targets.
 */
export const READER_NEXT_ANNOTATION_EVENT = "reader:next-annotation";

export interface ReaderNextAnnotationDetail {
  direction: 1 | -1;
}

const GG_WINDOW_MS = 400;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export interface ReaderKeyboardHandlers {
  enabled?: boolean;
  onFocusModeToggle: () => void;
  onScrollTop: () => void;
}

export function useReaderKeyboard({
  enabled = true,
  onFocusModeToggle,
  onScrollTop,
}: ReaderKeyboardHandlers): void {
  const handlersRef = useRef({ onFocusModeToggle, onScrollTop });
  handlersRef.current = { onFocusModeToggle, onScrollTop };

  useEffect(() => {
    if (!enabled) return;
    let lastGAt = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (isEditableTarget(event.target)) return;

      if (event.key === "j" || event.key === "k") {
        const direction: 1 | -1 = event.key === "j" ? 1 : -1;
        window.dispatchEvent(
          new CustomEvent<ReaderNextAnnotationDetail>(
            READER_NEXT_ANNOTATION_EVENT,
            { detail: { direction } },
          ),
        );
        return;
      }
      if (event.key === "f") {
        handlersRef.current.onFocusModeToggle();
        return;
      }
      if (event.key === "g") {
        const now = Date.now();
        if (now - lastGAt <= GG_WINDOW_MS) {
          lastGAt = 0;
          handlersRef.current.onScrollTop();
        } else {
          lastGAt = now;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
