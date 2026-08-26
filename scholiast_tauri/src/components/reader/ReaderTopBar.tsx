import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlignLeft,
  ArrowLeft,
  BookmarkPlus,
  ChevronLeft,
  SlidersHorizontal,
} from "lucide-react";

export const COLUMN_WIDTHS = [700, 736, 800] as const;
const CONFIRM_WORD = "DELETE";

export interface ReaderTopBarProps {
  title: string | null;
  hasArticle: boolean;
  fontStep: number;
  serif: boolean;
  columnWidth: number;
  onFontStep: (delta: number) => void;
  onToggleSerif: () => void;
  onCycleColumnWidth: () => void;
  onDelete: () => Promise<void> | void;
  showLibraryToggle?: boolean;
  onLibraryToggle?: () => void;
}

function TopBarIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-6 w-6 shrink-0"
    >
      <path d={path} />
    </svg>
  );
}

export default function ReaderTopBar({
  title,
  hasArticle,
  fontStep,
  serif,
  columnWidth,
  onFontStep,
  onToggleSerif,
  onCycleColumnWidth,
  onDelete,
  showLibraryToggle,
  onLibraryToggle,
}: ReaderTopBarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [widthSheetOpen, setWidthSheetOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const widthSheetRef = useRef<HTMLDivElement>(null);

  const onCycleColumnWidthTo = (next: number) => {
    const idx = COLUMN_WIDTHS.indexOf(next as (typeof COLUMN_WIDTHS)[number]);
    const curIdx = COLUMN_WIDTHS.indexOf(
      columnWidth as (typeof COLUMN_WIDTHS)[number],
    );
    if (idx === -1 || idx === curIdx) return;
    const steps = (idx - curIdx + COLUMN_WIDTHS.length) % COLUMN_WIDTHS.length;
    for (let i = 0; i < steps; i++) onCycleColumnWidth();
    setWidthSheetOpen(false);
  };

  useEffect(() => {
    if (!widthSheetOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        widthSheetRef.current &&
        !widthSheetRef.current.contains(target) &&
        !(target as HTMLElement)?.closest?.('[data-testid="column-width-cycle"]')
      ) {
        setWidthSheetOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [widthSheetOpen]);

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

  const fontPx = 16 + fontStep;

  return (
    <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-3">
      <div className="flex min-w-0 items-center gap-2">
        {!showLibraryToggle ? (
          <Link
            to="/home"
            data-testid="reader-back"
            aria-label="Back"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-elevated hover:text-text"
            style={{ minWidth: 48, minHeight: 48 }}
          >
            <ArrowLeft size={24} strokeWidth={2} aria-hidden />
          </Link>
        ) : null}
        {showLibraryToggle && onLibraryToggle ? (
          <button
            type="button"
            data-testid="library-drawer-toggle"
            aria-label="Open library"
            onClick={onLibraryToggle}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-elevated hover:text-text"
            style={{ minWidth: 48, minHeight: 48 }}
          >
            <ChevronLeft size={24} strokeWidth={2} aria-hidden />
          </button>
        ) : null}
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
          <Link
            to="/reader"
            data-testid="breadcrumb-library"
            className="shrink-0 text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-text"
          >
            Library
          </Link>
          {title ? (
            <>
              <span aria-hidden="true" className="text-text-3">/</span>
              <span className="truncate font-medium text-text">{title}</span>
            </>
          ) : null}
        </nav>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {hasArticle ? (
          <button
            type="button"
            data-testid="delete-article-button"
            aria-label="Delete article"
            onClick={() => setDialogOpen(true)}
            className="flex h-12 w-12 items-center justify-center rounded-md text-text-2 hover:text-[color:var(--sc-danger)]"
            style={{ minWidth: 48, minHeight: 48 }}
          >
            <TopBarIcon path="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" />
          </button>
        ) : null}
        <span
          data-testid="sync-chip"
          title="Sync status (coming soon)"
          className="hidden h-8 items-center rounded-full border border-hairline px-2.5 text-xs text-text-3 tabular-nums sm:inline-flex"
        >
          Sync
        </span>

        <div className="ml-1 flex items-center gap-1 rounded-full border border-hairline bg-[#11141A] px-1 py-1">
          <button
            type="button"
            data-testid="font-step-down"
            aria-label="Smaller text"
            onClick={() => onFontStep(-1)}
            disabled={fontStep <= -2}
            className="inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-xs font-medium text-text-2 hover:bg-elevated hover:text-text disabled:opacity-40"
            style={{ minWidth: 48, minHeight: 48 }}
          >
            A−
          </button>
          <span className="px-1 font-mono text-[11px] tabular-nums text-text-3">Aa {fontPx}px</span>
          <button
            type="button"
            data-testid="font-step-up"
            aria-label="Larger text"
            onClick={() => onFontStep(1)}
            disabled={fontStep >= 4}
            className="inline-flex h-10 min-w-10 items-center justify-center rounded-full px-3 text-xs font-medium text-text-2 hover:bg-elevated hover:text-text disabled:opacity-40"
            style={{ minWidth: 48, minHeight: 48 }}
          >
            A+
          </button>
          <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
          <button
            type="button"
            data-testid="serif-toggle"
            aria-label="Toggle serif typeface"
            aria-pressed={serif}
            onClick={onToggleSerif}
            className={`inline-flex h-10 items-center justify-center rounded-full px-3 text-xs font-semibold transition-colors ${
              serif
                ? "bg-accent text-white"
                : "text-text-2 hover:bg-elevated hover:text-text"
            }`}
            style={{ minWidth: 48, minHeight: 48 }}
          >
            Serif
          </button>
          <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
          <button
            type="button"
            data-testid="align-toggle"
            aria-label="Text alignment left"
            title="Align left 100%"
            className="flex h-10 w-10 items-center justify-center rounded-full text-text hover:bg-elevated"
            style={{ minWidth: 48, minHeight: 48 }}
          >
            <AlignLeft size={24} strokeWidth={2} />
          </button>
          <div className="relative">
            <button
              type="button"
              data-testid="column-width-cycle"
              aria-label={`Reading width ${columnWidth} pixels — tap to change`}
              aria-expanded={widthSheetOpen}
              aria-haspopup="dialog"
              onClick={() => setWidthSheetOpen((v) => !v)}
              className="flex h-10 w-10 items-center justify-center rounded-full text-text-2 hover:bg-elevated hover:text-text"
              style={{ minWidth: 48, minHeight: 48 }}
              title="Reading width 100%"
            >
              <SlidersHorizontal size={24} strokeWidth={2} />
            </button>
            {widthSheetOpen ? (
              <div
                ref={widthSheetRef}
                role="dialog"
                aria-label="Reading column width"
                data-testid="width-sheet"
                className="absolute right-0 top-10 z-30 w-64 rounded-lg border border-hairline bg-elevated p-4 shadow-xl"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setWidthSheetOpen(false);
                }}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium text-text-2">Width</span>
                  <span className="rounded bg-surface px-2 py-0.5 font-mono text-xs tabular-nums text-text-3">
                    {columnWidth}px
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={COLUMN_WIDTHS.length - 1}
                  step={1}
                  value={COLUMN_WIDTHS.indexOf(
                    columnWidth as (typeof COLUMN_WIDTHS)[number],
                  )}
                  onChange={(e) => {
                    const next = COLUMN_WIDTHS[Number(e.target.value)];
                    if (next !== columnWidth) onCycleColumnWidthTo(next);
                  }}
                  aria-label="Column width"
                  className="w-full accent-accent"
                />
                <div className="mt-2 flex justify-between text-[10px] text-text-3">
                  <span>Narrow</span>
                  <span>Wide</span>
                </div>
                <div className="mt-3 flex gap-1.5">
                  {COLUMN_WIDTHS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => onCycleColumnWidthTo(w)}
                      aria-pressed={w === columnWidth}
                      className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium tabular-nums transition-colors ${
                        w === columnWidth
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-hairline text-text-3 hover:text-text"
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          data-testid="bookmark-plus"
          aria-label="Bookmark"
          title="Bookmark"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-text-2 hover:bg-elevated hover:text-text"
          style={{ minWidth: 48, minHeight: 48 }}
        >
          <BookmarkPlus size={24} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {dialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-article-title"
            className="w-full max-w-md rounded-lg border border-hairline bg-elevated p-5 shadow-xl"
          >
            <h2 id="delete-article-title" className="text-base font-semibold text-text">
              Delete this article?
            </h2>
            <p className="mt-2 text-sm text-text-2">
              {title ? `“${title}”` : "This article"} and its annotations will be
              removed from this device. Type{" "}
              <span className="font-mono text-text">{CONFIRM_WORD}</span> to confirm.
            </p>
            <input
              ref={inputRef}
              data-testid="delete-confirm-input"
              aria-label={`Type ${CONFIRM_WORD} to confirm`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              className="mt-3 h-14 w-full rounded-md border border-hairline bg-transparent px-3 text-sm text-text outline-none focus:border-accent"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="delete-cancel-button"
                onClick={closeDialog}
                className="min-h-[48px] rounded-md border border-hairline px-4 py-2 text-sm font-medium text-text-2 hover:bg-elevated hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="delete-confirm-button"
                disabled={!confirmed || busy}
                onClick={() => void handleDelete()}
                className="min-h-[48px] rounded-md border border-hl-red px-4 py-2 text-sm font-semibold text-hl-red hover:bg-hl-red/10 disabled:opacity-40"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
