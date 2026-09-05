import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, RefreshCw } from "lucide-react";
import { IpcCommandError, invokeCommand } from "../lib/ipc";
import { useSyncStatus } from "../hooks/useSyncStatus";
import { formatRelativeTime } from "./SyncStatusBar";
import { useOffline } from "./OfflineBanner";

interface DriveStatus {
  connected: boolean;
}

interface ConnectStart {
  url: string;
  port: number;
}

const POLL_INTERVAL_MS = 1_000;
const POLL_BUDGET_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForConnected(
  intervalMs: number,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    try {
      const status = await invokeCommand<DriveStatus>("drive_status");
      if (status.connected) return true;
    } catch {
      /* transient */
    }
  }
  return false;
}

function humanizeDriveError(raw: string): string {
  if (/not connected/i.test(raw) || /internal:/i.test(raw)) return "Not Connected • Tap to Authorize";
  if (/oauth/i.test(raw) && /not_config/i.test(raw)) return "Not Connected • Tap to Authorize";
  return raw;
}

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

export interface DriveSyncCardProps {
  pollIntervalMs?: number;
  pollBudgetMs?: number;
}

export default function DriveSyncCard({
  pollIntervalMs = POLL_INTERVAL_MS,
  pollBudgetMs = POLL_BUDGET_MS,
}: DriveSyncCardProps) {
  const queryClient = useQueryClient();
  const driveStatus = useQuery({
    queryKey: ["drive", "status"],
    queryFn: () => invokeCommand<DriveStatus>("drive_status"),
  });
  const syncStatus = useSyncStatus();

  const [connecting, setConnecting] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [driveError, setDriveError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [manualSyncError, setManualSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const confirmTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null)
        window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  async function connect() {
    setConnecting(true);
    setNotConfigured(false);
    setDriveError(null);
    try {
      const start = await invokeCommand<ConnectStart>("drive_connect");
      await openUrl(start.url);
      const connected = await waitForConnected(pollIntervalMs, pollBudgetMs);
      if (connected) {
        await queryClient.invalidateQueries({ queryKey: ["drive"] });
      } else {
        setDriveError("Not Connected • Tap to Authorize");
      }
    } catch (err) {
      if (err instanceof IpcCommandError && err.kind === "oauth_not_configured") {
        setNotConfigured(true);
      } else if (!(err instanceof IpcCommandError && err.kind === "oauth_denied")) {
        setDriveError(humanizeDriveError(err instanceof Error ? err.message : String(err)));
      }
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    if (!confirmingDisconnect) {
      setConfirmingDisconnect(true);
      confirmTimer.current = window.setTimeout(() => {
        setConfirmingDisconnect(false);
        confirmTimer.current = null;
      }, 4_000);
      return;
    }
    if (confirmTimer.current !== null) {
      window.clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
    }
    setConfirmingDisconnect(false);
    setDriveError(null);
    invokeCommand<boolean>("drive_disconnect")
      .then(() => queryClient.invalidateQueries({ queryKey: ["drive"] }))
      .catch((err: unknown) =>
        setDriveError(humanizeDriveError(err instanceof Error ? err.message : String(err))),
      );
  }

  async function syncNow() {
    setSyncing(true);
    setManualSyncError(null);
    try {
      await invokeCommand("sync_now");
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setManualSyncError(/not connected|internal:/i.test(raw) ? "Not Connected • Tap to Authorize" : raw);
    } finally {
      setSyncing(false);
    }
  }

  const offline = useOffline();
  const connected = driveStatus.data?.connected ?? false;
  const running = syncStatus.phase !== null;
  const activeError = manualSyncError ?? driveError ?? syncStatus.error;
  const indeterminate = syncStatus.phase === "discovering" || syncing;
  const percent =
    syncStatus.total > 0 ? Math.round((syncStatus.done / syncStatus.total) * 100) : 0;

  const statusLine = driveStatus.isPending
    ? "Checking connection…"
    : connecting
      ? "Waiting for Google sign-in…"
      : connected
        ? "Connected • Synced"
        : "Not Connected • Tap to Authorize";

  return (
    <div
      aria-label="Google Drive sync"
      data-testid="drive-sync-card"
      className={`space-y-4 ${offline ? "opacity-60" : ""}`}
    >
      {/* Sleek unified card header: Title + Status indicator + Right corner connect/disconnect button */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/25">
            <Cloud size={18} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text tracking-tight flex min-w-0 items-center gap-2">
              <span className="whitespace-nowrap">Google Drive</span>
              <span
                data-testid="drive-status-badge"
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  connected
                    ? "bg-accent/15 text-accent border border-accent/25"
                    : "bg-elevated text-text-3 border border-hairline"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    connected ? "bg-accent" : "bg-text-3"
                  }`}
                  aria-hidden
                />
                <span>{connected ? "Connected" : "Not connected"}</span>
              </span>
            </h3>
            <p className="text-xs text-text-3 truncate mt-0.5" data-testid="drive-status-line">
              <span className={connected ? "text-[var(--sc-success)]" : "text-text-2"}>
                {statusLine}
              </span>
            </p>
          </div>
        </div>

        {/* Small corner action button */}
        <div className="shrink-0">
          {!connected ? (
            <button
              type="button"
              onClick={connect}
              disabled={connecting}
              data-testid="drive-connect-btn"
              className="btn-emerald h-8 px-3.5 text-xs font-medium"
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
          ) : confirmingDisconnect ? (
            <button
              type="button"
              onClick={disconnect}
              className="h-8 rounded-lg border border-[var(--sc-danger)] px-3 text-xs font-medium text-[var(--sc-danger)] hover:bg-[var(--sc-danger)]/10 transition-colors"
            >
              Confirm disconnect?
            </button>
          ) : (
            <button
              type="button"
              onClick={disconnect}
              data-testid="drive-disconnect-btn"
              className="h-8 rounded-lg border border-hairline px-3 text-xs font-medium text-text-3 hover:text-text hover:bg-elevated transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Sync state & relative timestamp */}
      <div className="rounded-lg border border-hairline bg-elevated/40 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-text-2" data-testid="sync-state-line">
            {stateLine(syncStatus.phase, activeError)}
            {!running && !activeError && syncStatus.lastSynced !== null && (
              <span className="text-text-3 font-normal">
                {" "}· last synced {formatRelativeTime(syncStatus.lastSynced)}
              </span>
            )}
            {!running && !activeError && syncStatus.lastSynced === null && (
              <span className="text-text-3 font-normal"> · never synced</span>
            )}
          </span>

          {running && syncStatus.total > 0 && (
            <span className="tabular-nums font-mono font-semibold text-accent text-xs">
              {syncStatus.done}/{syncStatus.total}
            </span>
          )}
        </div>

        {/* Real-time thin emerald progress line */}
        {(running || indeterminate) && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={indeterminate ? undefined : percent}
            data-testid="sync-progress-bar"
            className="h-1.5 overflow-hidden rounded-full bg-surface"
          >
            <div
              className={`h-full rounded-full bg-accent transition-[width] duration-200 ease-out ${
                indeterminate ? "w-1/3 animate-pulse" : ""
              }`}
              style={indeterminate ? undefined : { width: `${percent}%` }}
            />
          </div>
        )}

        {/* Current file / page being synced in real-time */}
        {running && (syncStatus.url || syncStatus.title || syncStatus.total > 0) && (
          <p
            className="truncate text-[11px] font-mono text-text-3"
            data-testid="sync-current-page"
          >
            {syncStatus.url ?? syncStatus.title ?? "Processing files…"}
          </p>
        )}

        {syncStatus.pending > 0 && (
          <p className="text-[11px] text-text-3">
            {syncStatus.pending} {syncStatus.pending === 1 ? "change" : "changes"} queued — will sync when online.
          </p>
        )}

        {activeError && (
          <p className="text-xs text-[var(--sc-danger)]" role="alert">
            {activeError}
          </p>
        )}

        {notConfigured && (
          <p className="rounded-md border border-hairline bg-surface p-2 text-xs text-text-2">
            No Google OAuth client configured in this build. Set{" "}
            <code>SCHOLIAST_GOOGLE_CLIENT_ID</code> or add a gitignored{" "}
            <code>oauth.local.json</code> to the repo root — see DISTRIBUTION.md.
          </p>
        )}

        {/* Sync Now button */}
        {connected && (
          <div className="pt-1 flex items-center justify-end">
            <button
              type="button"
              onClick={syncNow}
              disabled={syncing || running}
              data-testid="sync-now-btn"
              className="btn-emerald h-8 px-4 text-xs font-medium inline-flex items-center gap-1.5"
            >
              <RefreshCw size={13} className={syncing || running ? "animate-spin" : ""} />
              <span>{syncing || running ? "Syncing…" : "Sync now"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
