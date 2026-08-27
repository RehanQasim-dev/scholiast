import { useNavigate } from "react-router-dom";
import { useSyncStatus, type SyncStatus } from "../hooks/useSyncStatus";

const TITLE_MAX = 28;

function truncate(text: string): string {
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
}

export function formatRelativeTime(ms: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function syncStatusView(status: SyncStatus): {
  label: string;
  detail: string | null;
  tooltip: string;
  tone: "running" | "error" | "queued" | "idle";
} {
  const running = status.phase !== null;
  if (running) {
    return {
      label:
        status.total > 0 ? `${status.done}/${status.total}` : (status.phase ?? ""),
      detail:
        status.title || status.url
          ? truncate(status.title ?? status.url ?? "")
          : null,
      tooltip: `Syncing — ${status.phase}`,
      tone: "running",
    };
  }
  if (status.error) {
    return {
      label: "Sync failed",
      detail: null,
      tooltip: status.error,
      tone: "error",
    };
  }
  if (status.pending > 0) {
    return {
      label: status.pending === 1 ? "1 change queued" : `${status.pending} changes queued`,
      detail: null,
      tooltip: "Offline — changes will sync automatically.",
      tone: "queued",
    };
  }
  return {
    label:
      status.lastSynced !== null
        ? `Synced ${formatRelativeTime(status.lastSynced)}`
        : "Sync ready",
    detail: null,
    tooltip: status.lastSynced !== null ? "Up to date" : "No sync yet",
    tone: "idle",
  };
}

const TONE_CLASSES: Record<ReturnType<typeof syncStatusView>["tone"], string> = {
  running: "text-text-2 border-hairline",
  error: "text-[var(--sc-danger)] border-[var(--sc-danger)]/40",
  queued: "text-accent border-hairline",
  idle: "text-text-3 border-transparent hover:border-hairline hover:text-text-2",
};

function StatusBarView({
  status,
  onOpen,
}: {
  status: SyncStatus;
  onOpen: () => void;
}) {
  const view = syncStatusView(status);
  return (
    <button
      type="button"
      data-testid="sync-status"
      data-tone={view.tone}
      onClick={onOpen}
      title={view.tooltip}
      aria-label={`Sync status: ${view.label}. Open settings.`}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors duration-[var(--sc-dur-fast)] ease-out ${TONE_CLASSES[view.tone]}`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          view.tone === "error"
            ? "bg-[var(--sc-danger)]"
            : view.tone === "queued"
              ? "bg-accent"
              : view.tone === "running"
                ? "animate-pulse bg-text-2"
                : "bg-text-3"
        }`}
      />
      <span className="tabular-nums">{view.label}</span>
      {view.detail && (
        <span className="max-w-40 truncate text-text-3">{view.detail}</span>
      )}
    </button>
  );
}

export default function SyncStatusBar() {
  const navigate = useNavigate();
  const status = useSyncStatus();
  return <StatusBarView status={status} onOpen={() => navigate("/settings")} />;
}
