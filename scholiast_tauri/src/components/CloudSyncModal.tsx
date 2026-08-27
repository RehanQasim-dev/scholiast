import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, X, RefreshCw, CheckCircle2, AlertCircle, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IpcCommandError, invokeCommand } from "../lib/ipc";
import { getPref, setPref, PREF_KEYS } from "../lib/store";
import { toast } from "./Toast";

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

export interface CloudSyncModalProps {
  open: boolean;
  onClose: () => void;
  onSyncNow?: () => Promise<void>;
  syncing?: boolean;
}

export default function CloudSyncModal({
  open,
  onClose,
  onSyncNow,
  syncing = false,
}: CloudSyncModalProps) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["drive", "status"],
    queryFn: () => invokeCommand<DriveStatus>("drive_status"),
    enabled: open,
  });

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoInterval, setAutoInterval] = useState(true);
  const [onExit, setOnExit] = useState(true);

  // Load preferences
  useEffect(() => {
    if (!open) return;
    void getPref<boolean>(PREF_KEYS.syncAutoInterval, true).then(setAutoInterval);
    void getPref<boolean>(PREF_KEYS.syncOnExit, true).then(setOnExit);
  }, [open]);

  // Handle ESC key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isConnected = Boolean(status.data?.connected);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const start = await invokeCommand<ConnectStart>("drive_connect");
      await openUrl(start.url);
      const connected = await waitForConnected(POLL_INTERVAL_MS, POLL_BUDGET_MS);
      if (connected) {
        await queryClient.invalidateQueries({ queryKey: ["drive"] });
        toast("Google Drive connected");
      } else {
        setError("Authorization timed out. Please try again.");
      }
    } catch (err) {
      if (err instanceof IpcCommandError && err.kind === "oauth_not_configured") {
        setError("OAuth client credentials not configured.");
      } else if (!(err instanceof IpcCommandError && err.kind === "oauth_denied")) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await invokeCommand<boolean>("drive_disconnect");
      await queryClient.invalidateQueries({ queryKey: ["drive"] });
      toast("Disconnected from Google Drive");
    } catch (err) {
      toast("Failed to disconnect");
    }
  }

  async function toggleAutoInterval() {
    const next = !autoInterval;
    setAutoInterval(next);
    await setPref(PREF_KEYS.syncAutoInterval, next);
  }

  async function toggleOnExit() {
    const next = !onExit;
    setOnExit(next);
    await setPref(PREF_KEYS.syncOnExit, next);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-sync-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-hairline bg-surface p-6 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
              <Cloud size={20} strokeWidth={2} />
            </div>
            <div>
              <h2 id="cloud-sync-title" className="text-base font-semibold tracking-tight text-text">
                Cloud Backup
              </h2>
              <p className="text-xs text-text-3">Google Drive appData sync</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-3 hover:bg-elevated hover:text-text transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Connection Status & Main Action */}
        <div className="rounded-xl border border-hairline bg-elevated/40 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-2">Status</span>
            {isConnected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 size={12} /> Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-text-3/15 px-2.5 py-0.5 text-xs font-medium text-text-3 border border-text-3/20">
                Not Connected
              </span>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-2.5 text-xs text-red-400 border border-red-500/20">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isConnected ? (
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={async () => {
                  if (onSyncNow) {
                    await onSyncNow();
                    onClose();
                  }
                }}
                disabled={syncing}
                className="flex-1 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-accent text-[var(--sc-accent-text)] font-medium text-xs shadow-sm hover:bg-accent-press transition-colors disabled:opacity-50"
              >
                <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                {syncing ? "Syncing..." : "Sync Now"}
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="inline-flex h-9 px-3 items-center justify-center rounded-lg text-text-3 font-medium text-xs hover:bg-elevated hover:text-red-400 transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="w-full inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-accent text-[var(--sc-accent-text)] font-medium text-xs shadow-sm hover:bg-accent-press transition-colors disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  Connecting in browser...
                </>
              ) : (
                <>
                  <ExternalLink size={14} />
                  Authorize Google Drive
                </>
              )}
            </button>
          )}
        </div>

        {/* Automatic Backup Toggles */}
        <div className="space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-3">
            Automation Preferences
          </div>
          <div className="rounded-xl border border-hairline bg-elevated/40 divide-y divide-hairline">
            {/* Auto-backup every 5 minutes */}
            <label className="flex items-center justify-between p-3.5 cursor-pointer select-none">
              <div className="flex flex-col pr-4">
                <span className="text-xs font-medium text-text">Auto-backup every 5 minutes</span>
                <span className="text-[11px] text-text-3">
                  Pushes dirty highlights and drawings while you work
                </span>
              </div>
              <input
                type="checkbox"
                checked={autoInterval}
                onChange={toggleAutoInterval}
                className="h-4 w-4 rounded accent-accent cursor-pointer"
              />
            </label>

            {/* Auto-backup on exit */}
            <label className="flex items-center justify-between p-3.5 cursor-pointer select-none">
              <div className="flex flex-col pr-4">
                <span className="text-xs font-medium text-text">Auto-backup on exit</span>
                <span className="text-[11px] text-text-3">
                  Syncs automatically when closing notes or leaving study sessions
                </span>
              </div>
              <input
                type="checkbox"
                checked={onExit}
                onChange={toggleOnExit}
                className="h-4 w-4 rounded accent-accent cursor-pointer"
              />
            </label>
          </div>
        </div>

        {/* Footer info */}
        <p className="text-[11px] text-text-3 text-center">
          Uses encrypted appData storage compatible with Obsidian Clipper.
        </p>
      </div>
    </div>
  );
}
