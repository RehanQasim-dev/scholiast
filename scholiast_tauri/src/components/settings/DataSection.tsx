import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (dialog === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void open("local")}
          className="min-h-[48px] w-full rounded-md border border-[var(--sc-danger)] px-4 py-2 text-sm text-[var(--sc-danger)] hover:bg-elevated"
        >
          Delete local data…
        </button>
        <button
          type="button"
          onClick={() => void open("drive")}
          className="min-h-[48px] w-full rounded-md border border-hairline px-4 py-2 text-sm text-text-2 hover:text-text hover:bg-elevated"
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
        <div className="fixed inset-0 z-40 flex items-end justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={dialog === "local" ? "Delete local data" : "Delete Drive data"}
            className="relative w-full max-w-lg rounded-md border border-hairline bg-elevated p-5 shadow-2xl"
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
            <p className="mt-3 text-xs text-text-2">
              Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm.
            </p>
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              data-testid="wipe-confirm-input"
              aria-label={`Type ${CONFIRM_WORD} to confirm`}
              placeholder={CONFIRM_WORD}
              autoFocus
              className="mt-2 h-14 w-full rounded-md border border-hairline bg-surface px-3 text-sm outline-none focus:border-[var(--sc-danger)]"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void runWipe()}
                disabled={!confirmed || busy}
                data-testid="wipe-confirm-button"
                className="min-h-[48px] flex-1 rounded-md bg-[var(--sc-danger)] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
              <button
                type="button"
                onClick={close}
                disabled={busy}
                className="min-h-[48px] flex-1 rounded-md border border-hairline px-4 py-3 text-sm text-text-2 hover:text-text disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
