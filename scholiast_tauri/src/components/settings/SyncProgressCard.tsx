import { useState } from "react";
import { invokeCommand } from "../../lib/ipc";
import { useSyncStatus } from "../../hooks/useSyncStatus";
import { formatRelativeTime } from "../SyncStatusBar";

function stateLine(phase: string | null, error: string | null): string {
  if (error) return "Not Connected • Tap to Authorize";
  switch (phase) {
    case "discovering":
      return "Discovering changes…";
    case "reconciling":
      return "Reconciling pages…";
    case "pushing":
      return "Pushing page…";
    default:
      return "Up to date";
  }
}

export default function SyncProgressCard() {
  const status = useSyncStatus();
  const [manualError, setManualError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

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

  const running = status.phase !== null;
  const error = manualError ?? status.error;
  const indeterminate = status.phase === "discovering" || syncing;
  const percent =
    status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;

  return (
    <div
      aria-label="Sync progress"
    >
      <h3 className="text-sm font-medium text-text">Sync progress</h3>
      <p className="mt-2 text-sm text-text-2" data-testid="sync-state-line">
        {stateLine(status.phase, error)}
        {!running && !error && status.lastSynced !== null && (
          <span className="text-text-3">
            {" "}
            · last synced {formatRelativeTime(status.lastSynced)}
          </span>
        )}
        {!running && !error && status.lastSynced === null && (
          <span className="text-text-3"> · never synced</span>
        )}
      </p>

      {(running || indeterminate) && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={indeterminate ? undefined : percent}
          data-testid="sync-progress-bar"
          className="mt-3 h-1 overflow-hidden rounded-full bg-elevated"
        >
          <div
            className={`h-full rounded-full bg-accent transition-[width] duration-[var(--sc-dur-slow)] ease-out ${
              indeterminate ? "w-1/3 animate-pulse" : ""
            }`}
            style={indeterminate ? undefined : { width: `${percent}%` }}
          />
        </div>
      )}

      {running && (status.url || status.title || status.total > 0) && (
        <p
          className="mt-2 truncate text-xs text-text-3"
          data-testid="sync-current-page"
        >
          {status.url ?? status.title ?? ""}
          {status.total > 0 && (
            <span className="tabular-nums">
              {" "}
              ({status.done}/{status.total})
            </span>
          )}
        </p>
      )}

      {status.pending > 0 && (
        <p className="mt-2 text-xs text-text-3">
          {status.pending} {status.pending === 1 ? "change" : "changes"} queued —
          will sync when online.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-text-2" role="status">
          {error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          className="min-h-[48px] rounded-md bg-accent px-5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>
    </div>
  );
}
