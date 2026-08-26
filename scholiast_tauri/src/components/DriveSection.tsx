import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IpcCommandError, invokeCommand } from "../lib/ipc";
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

export async function waitForConnected(
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

interface DriveSectionProps {
  pollIntervalMs?: number;
  pollBudgetMs?: number;
}

function humanizeDriveError(raw: string): string {
  if (/not connected/i.test(raw) || /internal:/i.test(raw)) return "Not Connected • Tap to Authorize";
  if (/oauth/i.test(raw) && /not_config/i.test(raw)) return "Not Connected • Tap to Authorize";
  return raw;
}

export default function DriveSection({
  pollIntervalMs = POLL_INTERVAL_MS,
  pollBudgetMs = POLL_BUDGET_MS,
}: DriveSectionProps) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["drive", "status"],
    queryFn: () => invokeCommand<DriveStatus>("drive_status"),
  });
  const [connecting, setConnecting] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
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
    setError(null);
    try {
      const start = await invokeCommand<ConnectStart>("drive_connect");
      await openUrl(start.url);
      const connected = await waitForConnected(pollIntervalMs, pollBudgetMs);
      if (connected) {
        await queryClient.invalidateQueries({ queryKey: ["drive"] });
      } else {
        setError("Not Connected • Tap to Authorize");
      }
    } catch (err) {
      if (err instanceof IpcCommandError && err.kind === "oauth_not_configured") {
        setNotConfigured(true);
      } else if (!(err instanceof IpcCommandError && err.kind === "oauth_denied")) {
        setError(humanizeDriveError(err instanceof Error ? err.message : String(err)));
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
    setError(null);
    invokeCommand<boolean>("drive_disconnect")
      .then(() => queryClient.invalidateQueries({ queryKey: ["drive"] }))
      .catch((err: unknown) =>
        setError(humanizeDriveError(err instanceof Error ? err.message : String(err))),
      );
  }

  const offline = useOffline();
  const connected = status.data?.connected ?? false;
  const statusLine = status.isPending
    ? "Checking connection…"
    : connecting
      ? "Waiting for Google sign-in…"
      : connected
        ? "Connected • Synced"
        : "Not Connected • Tap to Authorize";

  return (
    <section
      aria-label="Google Drive sync"
      className={`rounded-lg border border-hairline bg-surface p-4 ${offline ? "opacity-60" : ""}`}
    >
      <h2 className="text-sm font-semibold text-text">Google Drive sync</h2>
      <p className="mt-2 text-sm tabular-nums" data-testid="drive-status-line">
        <span className={connected ? "text-[var(--sc-success)]" : "text-text-2"}>{statusLine}</span>
        {connected && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[var(--sc-success)]" aria-hidden />}
      </p>
      {notConfigured && (
        <p className="mt-2 rounded-md border border-hairline bg-elevated p-2 text-xs text-text-2">
          No Google OAuth client configured in this build. Set{" "}
          <code>SCHOLIAST_GOOGLE_CLIENT_ID</code> or add a gitignored{" "}
          <code>oauth.local.json</code> to the repo root — see DISTRIBUTION.md.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-text-2" role="status">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        {!connected ? (
          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="min-h-[48px] rounded-md bg-accent px-5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Authorize Drive"}
          </button>
        ) : confirmingDisconnect ? (
          <button
            type="button"
            onClick={disconnect}
            className="min-h-[48px] rounded-md border border-[var(--sc-danger)] px-5 text-sm font-medium text-[var(--sc-danger)]"
          >
            Confirm disconnect?
          </button>
        ) : (
          <button
            type="button"
            onClick={disconnect}
            className="min-h-[48px] rounded-md border border-hairline px-5 text-sm text-text-2 hover:text-text hover:bg-elevated"
          >
            Disconnect
          </button>
        )}
      </div>
    </section>
  );
}
