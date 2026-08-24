import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export const COLUMN_WIDTHS = [680, 736, 820] as const;
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
}

function TopBarIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-4 w-4 shrink-0"
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
}: ReaderTopBarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-4">
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

      <div className="flex shrink-0 items-center gap-1.5">
        {hasArticle ? (
          <button
            type="button"
            data-testid="delete-article-button"
            aria-label="Delete article"
            onClick={() => setDialogOpen(true)}
            className="rounded-md border border-hairline p-2 text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:border-hl-red hover:text-hl-red"
          >
            <TopBarIcon path="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" />
          </button>
        ) : null}
        <span
          data-testid="sync-chip"
          title="Sync status (coming soon)"
          className="rounded-full border border-hairline px-2.5 py-1 text-xs text-text-3 tabular-nums"
        >
          Sync
        </span>
        <button
          type="button"
          data-testid="font-step-down"
          aria-label="Smaller text"
          onClick={() => onFontStep(-1)}
          disabled={fontStep <= -2}
          className="rounded-md border border-hairline px-3 py-2 text-sm font-medium text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-elevated hover:text-text disabled:opacity-40"
        >
          A−
        </button>
        <button
          type="button"
          data-testid="font-step-up"
          aria-label="Larger text"
          onClick={() => onFontStep(1)}
          disabled={fontStep >= 4}
          className="rounded-md border border-hairline px-3 py-2 text-sm font-medium text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-elevated hover:text-text disabled:opacity-40"
        >
          A+
        </button>
        <button
          type="button"
          data-testid="serif-toggle"
          aria-label="Toggle serif typeface"
          aria-pressed={serif}
          onClick={onToggleSerif}
          className={`rounded-md border px-3 py-2 text-sm font-semibold transition-colors duration-[var(--sc-dur-fast)] ease-out ${
            serif
              ? "border-accent text-accent"
              : "border-hairline text-text-2 hover:bg-elevated hover:text-text"
          }`}
        >
          Serif
        </button>
        <button
          type="button"
          data-testid="column-width-cycle"
          aria-label={`Reading column width ${columnWidth}px`}
          onClick={onCycleColumnWidth}
          className="rounded-md border border-hairline px-3 py-2 text-sm font-medium text-text-2 tabular-nums transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-elevated hover:text-text"
        >
          {columnWidth}px
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
              className="mt-3 w-full rounded-md border border-hairline bg-transparent px-3 py-2 text-sm text-text outline-none focus:border-accent"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                data-testid="delete-cancel-button"
                onClick={closeDialog}
                className="rounded-md border border-hairline px-4 py-2 text-sm font-medium text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-elevated hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="delete-confirm-button"
                disabled={!confirmed || busy}
                onClick={() => void handleDelete()}
                className="rounded-md border border-hl-red px-4 py-2 text-sm font-semibold text-hl-red transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-hl-red/10 disabled:opacity-40"
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
