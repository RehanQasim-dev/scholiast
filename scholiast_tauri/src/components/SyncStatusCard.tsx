import { useState } from "react";
import { CheckCircle } from "lucide-react";
import { invokeCommand } from "../lib/ipc";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { formatRelativeTime } from "./SyncStatusBar";

export default function SyncStatusCard() {
  const status = useSyncStatus();
  const [syncing, setSyncing] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  async function syncNow() {
    setSyncing(true);
    setManualError(null);
    try {
      await invokeCommand("sync_now");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setManualError(/not connected|internal:/i.test(raw) ? "Not Connected • Tap to Authorize" : raw);
    } finally {
      setSyncing(false);
    }
  }

  const error = manualError ?? status.error;
  const running = status.phase !== null;
  const isUpToDate = !running && !error;

  return (
    <section
      aria-label="Sync status"
      className="flex items-center justify-between gap-4 rounded-md border border-hairline bg-elevated px-4 py-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${error ? "text-[var(--sc-danger)]" : isUpToDate ? "text-[var(--sc-success)]" : "text-text-2"}`} aria-hidden="true">
          <CheckCircle size={24} strokeWidth={2} style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-text">Google Drive</span>
          <span className="text-xs tabular-nums text-text-2" data-testid="sync-status-detail">
            {error
              ? error
              : running
                ? `${status.phase}… ${status.done}/${status.total}`
                : status.lastSynced !== null
                  ? `Up to date • Last synced ${formatRelativeTime(status.lastSynced)}`
                  : "Up to date • Never synced"}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={syncNow}
        disabled={syncing || running}
        className="flex h-12 shrink-0 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {syncing ? "Syncing…" : "Sync Now"}
      </button>
    </section>
  );
}
