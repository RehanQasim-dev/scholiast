import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import DynamicAuraPill from "./DynamicAuraPill";

export type HighlightColor = "yellow" | "red" | "green";

interface SwatchPopupProps {
  /** Fixed-viewport coordinates where the popup's bottom-center sits. */
  anchor: { top: number; left: number };
  onPickColor: (color: HighlightColor) => void;
  onSaveComment?: (color: HighlightColor, text: string) => void;
  onOpenDiagram?: (color: HighlightColor) => void;
  onComment: () => void;
  onClose: () => void;
}

const SWATCHES: { color: HighlightColor; token: string; label: string }[] = [
  { color: "yellow", token: "var(--sc-hl-yellow)", label: "Yellow highlight" },
  { color: "red", token: "var(--sc-hl-red)", label: "Red highlight" },
  { color: "green", token: "var(--sc-hl-green)", label: "Green highlight" },
];

/** Clean custom vector icons matching the Obsidian Clipper design system */
function CommentTextIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="8" y1="9" x2="16" y2="9" />
      <line x1="8" y1="13" x2="13" y2="13" />
    </svg>
  );
}

function CommentMicIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Speech bubble outline */}
      <path d="M19 14a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h6" />
      {/* Overlay microphone nestled on top-right */}
      <rect x="14" y="2" width="6" height="7.5" rx="3" fill="currentColor" stroke="none" />
      <path d="M12.5 6.5a4.5 4.5 0 0 0 9 0" strokeWidth="1.6" />
      <line x1="17" y1="11" x2="17" y2="13.5" strokeWidth="1.6" />
    </svg>
  );
}

function ShapesDiagramIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Triangle on top */}
      <path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
      {/* Square at bottom-left */}
      <rect x="3" y="14" width="7" height="7" rx="1" />
      {/* Circle at bottom-right */}
      <circle cx="17.5" cy="17.5" r="3.5" />
    </svg>
  );
}

export default function SwatchPopup({
  anchor,
  onPickColor,
  onSaveComment,
  onOpenDiagram,
  onComment,
  onClose,
}: SwatchPopupProps) {
  const [mode, setMode] = useState<"swatches" | "aura" | "comment">("swatches");
  const [selectedColor, setSelectedColor] = useState<HighlightColor>("yellow");
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (popupRef.current && !popupRef.current.contains(target)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [onClose]);

  const handleStartComment = () => {
    if (!onSaveComment) {
      onComment();
      return;
    }
    setMode("comment");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleStartVoice = () => {
    setMode("aura");
  };

  const handleSaveTextComment = () => {
    if (text.trim() && onSaveComment) {
      onSaveComment(selectedColor, text.trim());
      onClose();
    }
  };

  return (
    <div
      ref={popupRef}
      role="dialog"
      aria-label="Highlight tools"
      data-testid="swatch-popup"
      className="fixed z-50 -translate-x-1/2 -translate-y-full select-none animate-in fade-in zoom-in-95 duration-100"
      style={{
        top: Math.max(12, anchor.top - 8),
        left: Math.min(window.innerWidth - 140, Math.max(140, anchor.left)),
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {mode === "aura" ? (
        /* Dynamic Aura Pill: 4-bar frequency visualizer + 2s VAD auto-commit */
        <DynamicAuraPill
          onSave={(spokenText) => {
            onSaveComment?.(selectedColor, spokenText);
            onClose();
          }}
          onCancel={onClose}
        />
      ) : mode === "swatches" ? (
        /* Compact Swatch Strip */
        <div className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface/90 px-2.5 py-1.5 shadow-2xl backdrop-blur-md">
          {/* Exactly 3 Colors matching the Clipper extension */}
          <div className="flex items-center gap-1.5 pr-1">
            {SWATCHES.map(({ color, token, label }) => (
              <button
                key={color}
                type="button"
                aria-label={label}
                title={label}
                data-testid={`swatch-${color}`}
                onClick={() => {
                  setSelectedColor(color);
                  onPickColor(color);
                }}
                className="h-6 w-6 rounded-full border border-black/25 transition-transform duration-[var(--sc-dur-fast)] ease-out hover:scale-115 active:scale-95 cursor-pointer shadow-sm"
                style={{ backgroundColor: token }}
              />
            ))}
          </div>

          <span className="h-4 w-px bg-hairline" aria-hidden />

          {/* Text Comment Button */}
          <button
            type="button"
            aria-label="Add comment"
            title="Write text note"
            data-testid="swatch-comment"
            onClick={handleStartComment}
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-elevated hover:text-text cursor-pointer"
          >
            <CommentTextIcon />
          </button>

          {/* Voice Comment Combined (Mic on top of comment) */}
          <button
            type="button"
            aria-label="Speak voice note"
            title="Speak voice note"
            data-testid="swatch-voice"
            onClick={handleStartVoice}
            className="flex h-7 w-7 items-center justify-center rounded-full text-accent transition-colors hover:bg-elevated hover:text-accent-press cursor-pointer"
          >
            <CommentMicIcon />
          </button>

          {/* Diagram / Shapes Button (3 shapes: triangle, square, circle) */}
          <button
            type="button"
            aria-label="Add diagram"
            title="Draw diagram / sketch"
            data-testid="swatch-diagram"
            onClick={() => {
              if (onOpenDiagram) {
                onOpenDiagram(selectedColor);
              } else {
                onPickColor(selectedColor);
              }
              onClose();
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-elevated hover:text-text cursor-pointer"
          >
            <ShapesDiagramIcon />
          </button>
        </div>
      ) : (
        /* Typed Comment Box */
        <div className="w-72 rounded-xl border border-hairline bg-surface p-2.5 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5">
              {SWATCHES.map(({ color, token }) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className={`h-4 w-4 rounded-full transition-transform ${
                    selectedColor === color ? "scale-125 ring-2 ring-accent" : "opacity-60"
                  }`}
                  style={{ backgroundColor: token }}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-5 w-5 items-center justify-center rounded text-text-3 hover:text-text"
            >
              <X size={13} />
            </button>
          </div>

          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSaveTextComment();
              }
            }}
            placeholder="Write note… (Enter to save)"
            rows={2}
            className="w-full resize-none rounded-md border border-hairline bg-base p-1.5 text-xs text-text outline-none focus:border-accent"
          />

          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="h-6 rounded px-2 text-[11px] font-medium text-text-3 hover:bg-elevated hover:text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveTextComment}
              className="inline-flex h-6 items-center gap-1 rounded bg-accent px-2 text-[11px] font-medium text-[var(--sc-accent-text)] shadow-sm hover:bg-accent-press"
            >
              <Check size={12} strokeWidth={2} />
              <span>Save</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
