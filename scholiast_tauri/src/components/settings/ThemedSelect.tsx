import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type SelectOption = readonly [value: string, label: string];

interface ThemedSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<SelectOption>;
  testId?: string;
  ariaLabel?: string;
}

/**
 * Theme-native dropdown replacing the OS-rendered `<select>` popup (orange
 * GTK highlight, unthemed list on Linux). Trigger matches the STT model
 * picker; the list portals to document.body so settings cards with
 * overflow-hidden never clip it, flipping upward when room below runs out.
 */
export default function ThemedSelect({
  value,
  onChange,
  options,
  testId,
  ariaLabel,
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxH: number;
  } | null>(null);

  const selected = options.find(([v]) => v === value);
  const selectedLabel = selected?.[1] ?? value;

  const updateGeom = useCallback(() => {
    const el = buttonRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const MARGIN = 8;
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const spaceBelow = viewH - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const width = Math.max(rect.width || 0, 200);
    const left = Math.max(MARGIN, Math.min(rect.left, viewW - width - MARGIN));
    const avail = openUp ? spaceAbove : spaceBelow;
    const maxH = Math.max(120, Math.min(avail - MARGIN - 8, viewH * 0.5));
    setGeom(
      openUp
        ? { bottom: viewH - rect.top + 6, left, width, maxH }
        : { top: rect.bottom + 6, left, width, maxH },
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setGeom(null);
      return;
    }
    updateGeom();
    window.addEventListener("resize", updateGeom);
    window.addEventListener("scroll", updateGeom, true);
    return () => {
      window.removeEventListener("resize", updateGeom);
      window.removeEventListener("scroll", updateGeom, true);
    };
  }, [open, updateGeom]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={buttonRef}
        data-testid={testId}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className="flex h-12 min-h-[48px] w-full items-center justify-between rounded-lg border border-hairline bg-elevated px-3 text-sm text-text outline-none transition-colors hover:border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/20"
      >
        <span className="truncate font-medium">{selectedLabel}</span>
        <ChevronDown
          size={16}
          className={`ml-2 shrink-0 text-text-3 transition-transform duration-150 ${
            open ? "rotate-180 text-text" : ""
          }`}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            data-testid={testId ? `${testId}-dropdown` : undefined}
            className="fixed z-[100] overflow-hidden rounded-xl border border-hairline bg-surface py-1 shadow-2xl"
            style={{
              top: geom?.top,
              bottom: geom?.bottom,
              left: geom?.left ?? 8,
              width: geom?.width ?? 200,
            }}
          >
            <div className="overflow-y-auto" style={{ maxHeight: geom?.maxH ?? 240 }}>
              {options.map(([optValue, optLabel]) => {
                const isSelected = optValue === value;
                return (
                  <button
                    key={optValue}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-testid={testId ? `${testId}-option-${optValue}` : undefined}
                    onClick={() => {
                      onChange(optValue);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-elevated ${
                      isSelected
                        ? "bg-accent/15 font-medium text-accent"
                        : "text-text"
                    }`}
                  >
                    <span className="truncate">{optLabel}</span>
                    {isSelected && <Check size={14} className="shrink-0 text-accent" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
