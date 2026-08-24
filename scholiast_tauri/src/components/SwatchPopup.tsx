import { useEffect } from "react";

export type HighlightColor = "yellow" | "red" | "green";

interface SwatchPopupProps {
  /** Fixed-viewport coordinates where the popup's bottom-center sits. */
  anchor: { top: number; left: number };
  onPickColor: (color: HighlightColor) => void;
  onComment: () => void;
  onClose: () => void;
}

const SWATCHES: { color: HighlightColor; token: string; label: string }[] = [
  { color: "yellow", token: "var(--sc-hl-yellow)", label: "Yellow highlight" },
  { color: "red", token: "var(--sc-hl-red)", label: "Red highlight" },
  { color: "green", token: "var(--sc-hl-green)", label: "Green highlight" },
];

/**
 * Floating color-swatch strip shown over a text selection: three 28px
 * highlight circles + a 💬 comment button. Purely presentational — the
 * caller owns anchoring, selection bookkeeping and dismissal side effects.
 */
export default function SwatchPopup({
  anchor,
  onPickColor,
  onComment,
  onClose,
}: SwatchPopupProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-testid="swatch-popup"]')) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose]);

  return (
    <div
      data-testid="swatch-popup"
      className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-full border border-hairline bg-elevated px-1.5 py-1 shadow-xl"
      style={{ top: anchor.top, left: anchor.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-1">
        {SWATCHES.map(({ color, token, label }) => (
          <button
            key={color}
            type="button"
            aria-label={label}
            title={label}
            data-testid={`swatch-${color}`}
            onClick={() => onPickColor(color)}
            className="h-7 w-7 rounded-full border border-black/30 transition-transform duration-[var(--sc-dur-fast)] ease-out hover:scale-110 active:scale-95"
            style={{ backgroundColor: token }}
          />
        ))}
        <button
          type="button"
          aria-label="Comment on selection"
          title="Comment"
          data-testid="swatch-comment"
          onClick={onComment}
          className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-surface hover:text-text"
        >
          💬
        </button>
      </div>
    </div>
  );
}
