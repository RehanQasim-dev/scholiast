import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { invokeCommand } from "../../lib/ipc";

interface DataStats {
  videos: number;
  items: number;
}

interface DataSectionProps {
  /** Injectable for tests; defaults to the real IPC command. */
  fetchStats?: () => Promise<DataStats>;
}

type Dialog = null | "local" | "drive";

const CONFIRM_WORD = "delete";

export default function DataSection({ fetchStats }: DataSectionProps) {
  const queryClient = useQueryClient();
  const loadStats =
    fetchStats ?? (() => invokeCommand<DataStats>("data_stats"));

  const [dialog, setDialog] = useState<Dialog>(null);
  const [stats, setStats] = useState<DataStats | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(which: Exclude<Dialog, null>) {
    setDialog(which);
    setTyped("");
    setError(null);
    if (which === "local" && !stats) {
      try {
        setStats(await loadStats());
      } catch {
        setStats(null);
      }
    }
  }

  function close() {
    setDialog(null);
    setTyped("");
  }

  const confirmed = typed.trim().toLowerCase() === CONFIRM_WORD;

  async function runWipe() {
    if (!confirmed || !dialog) return;
    setBusy(true);
    setError(null);
    try {
      if (dialog === "local") {
        await invokeCommand("wipe_local_data");
        setResult("Local data deleted.");
        await queryClient.invalidateQueries();
      } else {
        const deleted = await invokeCommand<number>("wipe_drive_data");
        setResult(
          deleted === 1
            ? "Deleted 1 file from Google Drive."
            : `Deleted ${deleted} files from Google Drive.`,
        );
      }
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Data" className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void open("local")}
          className="rounded-sm border border-[var(--sc-danger)] px-3 py-1.5 text-sm text-[var(--sc-danger)] hover:bg-elevated"
        >
          Delete local data…
        </button>
        <button
          type="button"
          onClick={() => void open("drive")}
          className="rounded-sm border border-hairline px-3 py-1.5 text-sm text-text-2 hover:text-text"
        >
          Delete all data on Google Drive…
        </button>
      </div>

      {result && (
        <p role="status" className="text-xs text-text-2">
          {result}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--sc-danger)]">
          {error}
        </p>
      )}

      {dialog !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={dialog === "local" ? "Delete local data" : "Delete Drive data"}
          className="rounded-md border border-[var(--sc-danger)] bg-elevated p-4"
        >
          {dialog === "local" ? (
            <>
              <h4 className="text-sm font-semibold text-[var(--sc-danger)]">
                Delete all local data?
              </h4>
              <p className="mt-2 text-sm text-text-2" data-testid="local-counts">
                {stats
                  ? `This permanently removes ${stats.videos} ${stats.videos === 1 ? "video" : "videos"} and ${stats.items} ${stats.items === 1 ? "item" : "items"} plus saved frames and models on this device.`
                  : "This permanently removes every video, item, frame file and downloaded model on this device."}
              </p>
            </>
          ) : (
            <>
              <h4 className="text-sm font-semibold text-[var(--sc-danger)]">
                Delete all Scholiast data on Google Drive?
              </h4>
              <p className="mt-2 text-sm text-text-2">
                Every file in the hidden app folder is removed from Drive.
                Local annotations stay; a later sync may push them back.
              </p>
            </>
          )}
          <p className="mt-2 text-xs text-text-2">
            Type <span className="font-mono">{CONFIRM_WORD}</span> to confirm.
          </p>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            data-testid="wipe-confirm-input"
            aria-label={`Type ${CONFIRM_WORD} to confirm`}
            className="mt-2 w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 text-sm"
          />
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void runWipe()}
              disabled={!confirmed || busy}
              data-testid="wipe-confirm-button"
              className="rounded-sm bg-[var(--sc-danger)] px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
            >
              {busy ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="rounded-sm border border-hairline px-3 py-1.5 text-sm text-text-2 hover:text-text disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
