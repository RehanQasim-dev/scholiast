import { useEffect } from "react";
import { RATE_STEPS, commands, usePlayerSnapshot } from "./playerBridge";

interface PlaybackSheetProps {
  open: boolean;
  onClose: () => void;
}

export default function PlaybackSheet({ open, onClose }: PlaybackSheetProps) {
  const snap = usePlayerSnapshot();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close playback settings"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Playback settings"
        data-open={open ? "true" : "false"}
        className="sc-bottom-sheet relative flex w-full max-w-[520px] flex-col gap-4 rounded-t-2xl border-t border-hairline bg-elevated px-4 pb-[calc(16px+var(--sc-safe-bottom))] pt-3 shadow-2xl"
        style={{ transform: open ? "translateY(0)" : "translateY(100%)" }}
      >
        <div aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-text-3" />
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Playback</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="sc-hit flex items-center justify-center rounded-full text-text-2 hover:bg-surface"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-text-3">Speed</p>
          <div
            role="listbox"
            aria-label="Playback speed"
            className="grid grid-cols-4 gap-2"
          >
            {RATE_STEPS.map((r) => (
              <button
                key={r}
                type="button"
                role="option"
                aria-selected={r === snap.rate}
                onClick={() => {
                  commands.setRate(r);
                  onClose();
                }}
                className={`sc-hit rounded-lg border text-sm font-medium tabular-nums transition-colors ${
                  r === snap.rate
                    ? "border-[color:var(--sc-accent)] bg-[color:var(--sc-accent)] text-[var(--sc-accent-text)]"
                    : "border-hairline bg-surface text-text-2 hover:text-text"
                }`}
              >
                {r}×
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-text-3">Captions & quality</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={snap.captionsEnabled}
              onClick={() => commands.setCaptions(!snap.captionsEnabled)}
              className={`sc-hit flex flex-1 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors ${
                snap.captionsEnabled
                  ? "border-[color:var(--sc-accent)] bg-[color:var(--sc-accent)] text-[var(--sc-accent-text)]"
                  : "border-hairline bg-surface text-text-2"
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
                <rect x="3" y="7" width="18" height="10" rx="2" />
                <path d="M7 12h2M13 12h2" />
              </svg>
              CC {snap.captionsEnabled ? "On" : "Off"}
            </button>
            <div className="sc-hit flex flex-1 items-center justify-center gap-2 rounded-lg border border-hairline bg-surface text-sm text-text-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h6v6H9z" />
              </svg>
              Auto
            </div>
          </div>
          <p className="text-[11px] text-text-3">Quality follows YouTube auto — CC toggle controls captions.</p>
        </div>
      </div>
    </div>
  );
}
