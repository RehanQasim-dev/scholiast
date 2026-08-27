import { useCallback, useState } from "react";
import MicButton from "../components/MicButton";
import { IpcCommandError, invokeCommand } from "../lib/ipc";

export interface VoiceEditSheetProps {
  /** The current note text being revised. */
  original: string;
  /** Edit-comment instruction prefilled by the caller (from the `prompt.edit_comment` pref). */
  initialPrompt: string;
  /** When set, the mic is off and this string explains why (e.g. no provider configured). */
  micDisabledReason?: string | null;
  /** Receives the revised note text. */
  onAccept: (edited: string) => void;
  onDiscard: () => void;
}

type SheetPhase = "idle" | "transcribing" | "preview" | "error";

interface ErrorInfo {
  kind: string;
  message: string;
}

/**
 * Tauri rejects commands with the raw `{ok:false, error:{kind,message}}` envelope
 * (ScholiastError/SttError's Serialize form); IpcCommandError only appears once
 * invokeCommand has unwrapped a resolved envelope. Handle both shapes here.
 */
function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof IpcCommandError) {
    return { kind: err.kind, message: err.message };
  }
  const raw = err as { error?: { kind?: string; message?: string } } | null;
  if (raw && typeof raw === "object" && raw.error?.message) {
    return { kind: raw.error.kind ?? "unknown", message: raw.error.message };
  }
  return {
    kind: "unknown",
    message: err instanceof Error ? err.message : String(err),
  };
}

export default function VoiceEditSheet({
  original,
  initialPrompt,
  micDisabledReason,
  onAccept,
  onDiscard,
}: VoiceEditSheetProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [phase, setPhase] = useState<SheetPhase>("idle");
  const [edited, setEdited] = useState("");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [wavPath, setWavPath] = useState<string | null>(null);

  const runEdit = useCallback(
    async (path: string) => {
      setWavPath(path);
      setPhase("transcribing");
      setError(null);
      try {
        const text = await invokeCommand<string>("stt_edit_text", {
          wavPath: path,
          original,
          promptOverride: prompt.trim() ? prompt : null,
        });
        setEdited(text);
        setPhase("preview");
      } catch (err) {
        setError(toErrorInfo(err));
        setPhase("error");
      }
    },
    [original, prompt],
  );

  const handleStopped = useCallback(
    (result: { path: string }) => {
      void runEdit(result.path);
    },
    [runEdit],
  );

  const handleRetry = useCallback(() => {
    if (wavPath) void runEdit(wavPath);
  }, [runEdit, wavPath]);

  const micBusy = phase === "transcribing";

  return (
    <section
      aria-label="Edit note by voice"
      className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4"
    >
      <h2 className="text-sm font-medium">Edit note by voice</h2>

      <div
        aria-label="Original note"
        className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-elevated p-3 text-sm leading-relaxed text-text-2"
      >
        {original}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-text-3">Instructions</span>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={3}
          className="resize-none rounded-md border border-hairline bg-elevated p-2 text-sm text-text outline-none transition-colors duration-[var(--sc-dur-fast)] ease-out focus:border-accent"
        />
      </label>

      <div className="flex items-center justify-center py-1">
        <MicButton
          disabled={Boolean(micDisabledReason)}
          disabledTitle={micDisabledReason ?? undefined}
          phase={micBusy ? "processing" : undefined}
          onStopped={handleStopped}
          onError={() => {}}
        />
      </div>

      {micDisabledReason && (
        <p role="note" className="text-center text-xs text-text-3">
          {micDisabledReason}
        </p>
      )}

      <div aria-live="polite" className="flex flex-col gap-3">
        {phase === "preview" && (
          <>
            <div>
              <span className="text-xs text-text-3">Revised note</span>
              <div className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-elevated p-3 text-sm leading-relaxed text-text">
                {edited}
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-md border border-hairline px-3 py-2 text-xs text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-text"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={onDiscard}
                className="rounded-md border border-hairline px-3 py-2 text-xs text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-text"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => onAccept(edited)}
                className="rounded-md bg-accent px-4 py-2 text-xs font-medium text-[var(--sc-accent-text)] transition-opacity duration-[var(--sc-dur-fast)] ease-out hover:opacity-90"
              >
                Accept
              </button>
            </div>
          </>
        )}

        {phase === "error" && error && (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-xs text-[var(--sc-danger)]">
              {error.message.includes("Speech failed")
                ? error.message
                : `Speech failed: ${error.message}`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onDiscard}
                className="rounded-md border border-hairline px-3 py-2 text-xs text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-text"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-md border border-hairline px-3 py-2 text-xs text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-text"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
