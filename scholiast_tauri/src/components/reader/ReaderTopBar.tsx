import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  Globe,
  MoveHorizontal,
  Trash2,
  Type,
  X,
} from "lucide-react";

export const COLUMN_WIDTHS = [700, 736, 800, 960] as const;
const CONFIRM_WORD = "DELETE";

export type ReaderTheme = "oled" | "sepia" | "slate" | "light";
export type ReaderViewMode = "web" | "reader";

export interface ReaderTopBarProps {
  title: string | null;
  hasArticle: boolean;
  viewMode?: ReaderViewMode;
  onToggleViewMode?: () => void;
  fontStep: number;
  serif: boolean;
  columnWidth: number;
  theme?: ReaderTheme;
  onThemeChange?: (theme: ReaderTheme) => void;
  onFontStep: (delta: number) => void;
  onToggleSerif: () => void;
  onCycleColumnWidth: () => void;
  onSetColumnWidth?: (width: number) => void;
  onDelete: () => Promise<void> | void;
  annotationsCount?: number;
  annotationsOpen?: boolean;
  onToggleAnnotations?: () => void;
  hideAppearanceOnTablet?: boolean;
  hideViewModeOnTablet?: boolean;
  hideAnnotationsOnTablet?: boolean;
  /** "Swipe" select mode (finger drags select without long-press). */
  swipeMode?: boolean;
  onToggleSwipe?: () => void;
  /** Narrow screens: Swipe toggle replaces the Notes toggle (notes stay
   * reachable via bottom-up swipe + floating pill). */
  showSwipeToggle?: boolean;
}

export default function ReaderTopBar({
  title,
  hasArticle,
  viewMode = "web",
  onToggleViewMode,
  fontStep,
  serif,
  columnWidth,
  theme = "oled",
  onThemeChange,
  onFontStep,
  onToggleSerif,
  onCycleColumnWidth,
  onSetColumnWidth,
  onDelete,
  annotationsCount = 0,
  annotationsOpen = false,
  onToggleAnnotations,
  hideAppearanceOnTablet = false,
  hideViewModeOnTablet = false,
  hideAnnotationsOnTablet = false,
  swipeMode = false,
  onToggleSwipe,
  showSwipeToggle = false,
}: ReaderTopBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fontPx = 16 + fontStep;

  // Close formatting popover on click away
  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && popoverRef.current && !popoverRef.current.contains(target)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [popoverOpen]);

  useEffect(() => {
    if (dialogOpen) {
      setTyped("");
      inputRef.current?.focus();
    }
  }, [dialogOpen]);

  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD.toLowerCase();

  const closeDialog = () => {
    setDialogOpen(false);
    setTyped("");
  };

  const handleDelete = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      await onDelete();
      closeDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex h-[50px] shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-3">
      {/* Left side: Back to Library */}
      <div className="flex min-w-0 items-center gap-2">
        <Link
          to="/home"
          data-testid="reader-back"
          aria-label="Back to Library"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-elevated hover:text-text"
        >
          <ArrowLeft size={18} strokeWidth={2} aria-hidden />
        </Link>

        {title ? (
          <h1 className="truncate text-sm font-medium text-text max-w-[200px] sm:max-w-xs md:max-w-md">
            {title}
          </h1>
        ) : (
          <span className="text-xs text-text-3">Reader</span>
        )}
      </div>

      {/* Right side: Clean [aA] popover toggle + Annotations toggle */}
      <div className="flex shrink-0 items-center gap-1.5">
        {hasArticle && (
          <>
            {/* Authentic Web vs Clean Reader Toggle */}
            {onToggleViewMode && (
              <button
                type="button"
                aria-label={viewMode === "web" ? "Switch to clean reader" : "Switch to authentic webview"}
                title={viewMode === "web" ? "Authentic Web (Click for Clean Reader)" : "Clean Reader (Click for Authentic Web)"}
                onClick={onToggleViewMode}
                className={`flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors ${hideViewModeOnTablet ? "lg:hidden" : ""} ${
                  viewMode === "web"
                    ? "bg-elevated text-accent border border-accent/40"
                    : "text-text-2 hover:bg-elevated hover:text-text border border-hairline"
                }`}
              >
                {viewMode === "web" ? (
                  <>
                    <Globe size={14} strokeWidth={2} />
                    <span>Web</span>
                  </>
                ) : (
                  <>
                    <FileText size={14} strokeWidth={2} />
                    <span>Reader</span>
                  </>
                )}
              </button>
            )}

            {/* aA Reading Settings Toggle */}
            <div className={`relative ${hideAppearanceOnTablet ? "lg:hidden" : ""}`} ref={popoverRef}>
              <button
                type="button"
                aria-label="Reading appearance settings"
                aria-expanded={popoverOpen}
                onClick={() => setPopoverOpen((v) => !v)}
                className={`flex h-9 items-center gap-1 rounded-md px-2.5 text-xs font-semibold transition-colors ${
                  popoverOpen ? "bg-elevated text-accent" : "text-text-2 hover:bg-elevated hover:text-text"
                }`}
              >
                <Type size={16} strokeWidth={2} />
                <span className="font-mono text-[11px]">aA</span>
              </button>

              {/* Formatting Popover */}
              {popoverOpen && (
                <div
                  role="dialog"
                  aria-label="Reading settings"
                  className="absolute right-0 top-full mt-1.5 z-40 w-72 rounded-lg border border-hairline bg-surface p-3 shadow-xl backdrop-blur-md"
                >
                  <div className="space-y-3">
                    {/* Font size stepper */}
                    <div>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">Text Size</span>
                      <div className="mt-1 flex items-center justify-between rounded-md border border-hairline bg-base p-1">
                        <button
                          type="button"
                          data-testid="font-step-down"
                          onClick={() => onFontStep(-1)}
                          disabled={fontStep <= -2}
                          className="h-8 w-10 rounded text-xs font-semibold text-text-2 hover:bg-elevated hover:text-text disabled:opacity-30"
                        >
                          A−
                        </button>
                        <span className="font-mono text-xs tabular-nums text-text">{fontPx}px</span>
                        <button
                          type="button"
                          data-testid="font-step-up"
                          onClick={() => onFontStep(1)}
                          disabled={fontStep >= 4}
                          className="h-8 w-10 rounded text-xs font-semibold text-text-2 hover:bg-elevated hover:text-text disabled:opacity-30"
                        >
                          A+
                        </button>
                      </div>
                    </div>

                    {/* Theme Presets */}
                    <div>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">Theme</span>
                      <div className="mt-1 flex items-center gap-1.5 rounded-md border border-hairline bg-base p-1.5">
                        {[
                          { id: "oled", label: "OLED", bg: "#000000", border: "#27272a" },
                          { id: "sepia", label: "Sepia", bg: "#1c1815", border: "#443428" },
                          { id: "slate", label: "Slate", bg: "#0f172a", border: "#334155" },
                          { id: "light", label: "Light", bg: "#fbfbfa", border: "#d4d4d8" },
                        ].map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            title={t.label}
                            onClick={() => onThemeChange?.(t.id as ReaderTheme)}
                            className={`flex-1 flex flex-col items-center gap-1 rounded py-1 transition-all cursor-pointer ${
                              theme === t.id ? "ring-1 ring-accent/30" : "opacity-60 hover:opacity-100"
                            }`}
                          >
                            <span
                              className="h-4 w-full rounded border shadow-sm"
                              style={{ backgroundColor: t.bg, borderColor: t.border }}
                            />
                            <span className="text-[10px] font-medium text-text-2">{t.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Typeface Toggle */}
                    <div>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">Typeface</span>
                      <div className="mt-1 flex rounded-md border border-hairline bg-base p-1">
                        <button
                          type="button"
                          onClick={() => serif && onToggleSerif()}
                          className={`flex-1 rounded py-1 text-xs font-medium transition-colors border ${
                            !serif ? "bg-[rgba(58,166,125,0.14)] border-accent/20 text-[color:var(--sc-note-text)]" : "border-transparent text-text-2 hover:text-text"
                          }`}
                        >
                          Sans
                        </button>
                        <button
                          type="button"
                          data-testid="serif-toggle"
                          aria-pressed={serif}
                          onClick={() => !serif && onToggleSerif()}
                          className={`flex-1 rounded py-1 font-serif text-xs font-medium transition-colors border ${
                            serif ? "bg-[rgba(58,166,125,0.14)] border-accent/20 text-[color:var(--sc-note-text)]" : "border-transparent text-text-2 hover:text-text"
                          }`}
                        >
                          Serif
                        </button>
                      </div>
                    </div>

                    {/* Column Width Cycle */}
                    <div>
                      <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">Column Width</span>
                      <div className="mt-1 flex rounded-md border border-hairline bg-base p-1">
                        {COLUMN_WIDTHS.map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => {
                              if (columnWidth === w) return;
                              if (onSetColumnWidth) onSetColumnWidth(w);
                              else onCycleColumnWidth();
                            }}
                            className={`flex-1 rounded py-1 text-xs font-medium transition-colors border ${
                              columnWidth === w ? "bg-[rgba(58,166,125,0.14)] border-accent/20 text-[color:var(--sc-note-text)]" : "border-transparent text-text-2 hover:text-text"
                            }`}
                          >
                            {w === 700 ? "Narrow" : w === 736 ? "Default" : w === 800 ? "Wide" : "Extra"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Delete Article */}
                    <div className="border-t border-hairline pt-2">
                      <button
                        type="button"
                        data-testid="delete-article-button"
                        onClick={() => {
                          setPopoverOpen(false);
                          setDialogOpen(true);
                        }}
                        className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-[color:var(--sc-danger)] hover:bg-elevated"
                      >
                        <span>Delete Article</span>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Swipe-select Toggle (narrow): replaces the Notes toggle */}
            {showSwipeToggle && onToggleSwipe ? (
              <button
                type="button"
                aria-label="Toggle swipe select"
                aria-pressed={swipeMode}
                data-testid="reader-swipe-toggle"
                onClick={onToggleSwipe}
                className={`flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors border ${
                  swipeMode
                    ? "bg-[rgba(58,166,125,0.14)] border-accent/20 text-accent"
                    : "border-transparent text-text-2 hover:bg-elevated hover:text-text"
                }`}
              >
                <MoveHorizontal size={15} strokeWidth={2} />
                <span>Swipe</span>
              </button>
            ) : (
              onToggleAnnotations && (
                <button
                  type="button"
                  aria-label="Toggle annotations panel"
                  data-testid="annotations-toggle"
                  onClick={onToggleAnnotations}
                  className={`flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors border ${hideAnnotationsOnTablet ? "lg:hidden" : ""} ${
                    annotationsOpen
                      ? "bg-[rgba(58,166,125,0.14)] border-accent/20 text-accent"
                      : "border-transparent text-text-2 hover:bg-elevated hover:text-text"
                  }`}
                >
                  <FileText size={15} strokeWidth={2} />
                  <span>Notes</span>
                  {annotationsCount > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.2 font-mono text-[10px] font-semibold leading-none ${
                        annotationsOpen ? "bg-white text-accent" : "bg-elevated text-text"
                      }`}
                    >
                      {annotationsCount}
                    </span>
                  )}
                </button>
              )
            )}
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {dialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") closeDialog();
          }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeDialog}
            aria-hidden="true"
          />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm deletion"
            className="relative w-full max-w-sm rounded-lg border border-hairline bg-surface p-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Delete article?</h3>
              <button
                type="button"
                onClick={closeDialog}
                className="flex h-7 w-7 items-center justify-center rounded text-text-3 hover:bg-elevated hover:text-text"
              >
                <X size={16} />
              </button>
            </div>
            <p className="mt-2 text-xs text-text-2">
              This will permanently delete <strong className="text-text">{title ?? "this article"}</strong> and its annotations. Type <strong className="font-mono text-accent">DELETE</strong> to confirm.
            </p>
            <input
              ref={inputRef}
              value={typed}
              data-testid="delete-confirm-input"
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              className="mt-3 w-full rounded-md border border-hairline bg-base px-3 py-1.5 font-mono text-sm text-text outline-none focus:border-[color:var(--sc-danger)]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                data-testid="delete-cancel-button"
                onClick={closeDialog}
                className="h-8 rounded-md border border-hairline px-3 text-xs font-medium text-text-2 hover:bg-elevated hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="delete-confirm-button"
                disabled={!confirmed || busy}
                onClick={() => void handleDelete()}
                className="h-8 rounded-md bg-[color:var(--sc-danger)] px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
