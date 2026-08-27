import { useState } from "react";
import { Cloud, RefreshCw, AlertCircle } from "lucide-react";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { invokeCommand } from "../lib/ipc";
import { toast } from "./Toast";
import CloudSyncModal from "./CloudSyncModal";

interface DriveStatus {
  connected: boolean;
}

export default function CloudSyncIndicator() {
  const status = useSyncStatus();
  const [syncing, setSyncing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const running = syncing || status.phase !== null;
  const hasError = Boolean(status.error);
  const isSynced = !running && !hasError && status.lastSynced !== null;

  async function performSync() {
    if (running) return;
    setSyncing(true);
    try {
      await invokeCommand("sync_now");
      toast("Sync complete");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not connected/i.test(msg)) {
        setModalOpen(true);
      } else {
        toast("Sync failed • Check Settings");
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleClick() {
    if (running) return;
    try {
      const drive = await invokeCommand<DriveStatus>("drive_status");
      if (!drive.connected) {
        setModalOpen(true);
        return;
      }
      await performSync();
    } catch {
      setModalOpen(true);
    }
  }

  const label = running ? "Syncing…" : hasError ? "Sync failed" : isSynced ? "Synced" : "Offline";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={`Cloud sync status: ${label}`}
        title={
          running
            ? `Syncing: ${status.phase ?? "processing"}…`
            : hasError
              ? `Sync error: ${status.error}`
              : isSynced
                ? "Google Drive synced • Click to sync now"
                : "Google Drive • Click to setup backup"
        }
        className="relative flex h-11 min-h-[44px] shrink-0 items-center gap-2 rounded-full border border-hairline bg-elevated px-3.5 text-xs font-medium tabular-nums text-text-2 transition-all hover:bg-surface hover:text-text active:scale-[0.98] focus-visible:outline-none"
      >
        {running ? (
          <RefreshCw
            size={16}
            strokeWidth={2}
            className="animate-spin text-accent"
            style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties}
          />
        ) : hasError ? (
          <AlertCircle
            size={16}
            strokeWidth={2}
            className="text-[var(--sc-danger)]"
            style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties}
          />
        ) : (
          <Cloud
            size={16}
            strokeWidth={2}
            className={isSynced ? "text-[var(--sc-success)]" : "text-text-3"}
            style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties}
          />
        )}
        <span>{label}</span>
      </button>

      <CloudSyncModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSyncNow={performSync}
        syncing={running}
      />
    </>
  );
}
