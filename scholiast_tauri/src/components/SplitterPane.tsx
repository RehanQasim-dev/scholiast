import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getPref, setPref } from "../lib/store";

interface SplitterPaneProps {
  left: ReactNode;
  right: ReactNode;
  storageKey?: string;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  className?: string;
}

export default function SplitterPane({
  left,
  right,
  storageKey = "layout.player_split_ratio",
  defaultRatio = 0.6,
  minRatio = 0.35,
  maxRatio = 0.75,
  className = "",
}: SplitterPaneProps) {
  const [ratio, setRatio] = useState(defaultRatio);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  // Load saved ratio from preferences
  useEffect(() => {
    let cancelled = false;
    void getPref<number>(storageKey, defaultRatio)
      .then((val) => {
        if (cancelled) return;
        const num = Number(val);
        if (Number.isFinite(num)) {
          setRatio(Math.min(maxRatio, Math.max(minRatio, num)));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [defaultRatio, maxRatio, minRatio, storageKey]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* fallback if pointer capture fails */
      }
      setIsDragging(true);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const rawRatio = (e.clientX - rect.left) / rect.width;
      const clamped = Math.min(maxRatio, Math.max(minRatio, rawRatio));
      setRatio(clamped);
    },
    [isDragging, maxRatio, minRatio],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setIsDragging(false);
      void setPref(storageKey, ratioRef.current).catch(() => {});
    },
    [isDragging, storageKey],
  );

  const handleDoubleClick = useCallback(() => {
    setRatio(defaultRatio);
    void setPref(storageKey, defaultRatio).catch(() => {});
  }, [defaultRatio, storageKey]);

  const leftPercent = `${(ratio * 100).toFixed(2)}%`;
  const rightPercent = `${((1 - ratio) * 100).toFixed(2)}%`;

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full w-full select-none overflow-hidden ${className}`}
      data-testid="splitter-pane-root"
    >
      {/* Left Pane */}
      <div
        style={{ width: leftPercent }}
        className="relative h-full shrink-0 overflow-hidden"
        data-testid="splitter-left"
      >
        {left}
      </div>

      {/* Draggable Divider */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        aria-label="Resize panels"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        className={`group relative z-20 flex h-full w-2 shrink-0 cursor-col-resize touch-none items-center justify-center transition-colors ${
          isDragging ? "bg-accent/20" : "hover:bg-accent/15"
        }`}
        data-testid="splitter-divider"
      >
        <div
          className={`h-12 w-1 rounded-full transition-colors ${
            isDragging ? "bg-accent" : "bg-hairline group-hover:bg-accent/70"
          }`}
        />
      </div>

      {/* Right Pane */}
      <div
        style={{ width: rightPercent }}
        className="relative h-full shrink-0 overflow-hidden"
        data-testid="splitter-right"
      >
        {right}
      </div>

      {/* Shield during drag so underlying iframes don't steal pointer events */}
      {isDragging && (
        <div
          className="fixed inset-0 z-50 cursor-col-resize select-none"
          style={{ cursor: "col-resize" }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
