import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Check, Download, FolderUp, Trash2 } from "lucide-react";
import { invokeCommand } from "../../lib/ipc";
import { PREF_KEYS, getPref, setPref } from "../../lib/store";

interface CatalogEntry {
  id: string;
  label: string;
  sizeBytes: number;
  isDefault: boolean;
  installed: boolean;
}

interface ModelListResponse {
  models: CatalogEntry[];
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  const chunk = 8192;
  for (let i = 0; i < len; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunk, len)) as unknown as number[],
    );
  }
  return btoa(binary);
}

export default function ModelManagerSection() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: ["stt", "models"],
    queryFn: () => invokeCommand<ModelListResponse>("list_stt_models"),
    retry: false,
  });

  const [activeModel, setActiveModel] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPref(PREF_KEYS.localModel, "").then((value) => {
      if (!cancelled) setActiveModel(value);
    });
    return () => {
      cancelled = true;
    };
  }, [list.data]);

  async function activate(id: string) {
    setActiveModel(id);
    await setPref(PREF_KEYS.localModel, id);
  }

  async function download(id: string) {
    setDownloadingId(id);
    setDownloadNote("Downloading…");
    try {
      await invokeCommand("download_stt_model", { id });
      setDownloadNote("Download complete.");
      await queryClient.invalidateQueries({ queryKey: ["stt", "models"] });
    } catch (err) {
      setDownloadNote(
        err instanceof Error ? `Download failed: ${err.message}` : "Download failed.",
      );
    } finally {
      setDownloadingId(null);
    }
  }

  async function deleteModel(id: string) {
    try {
      await invokeCommand("delete_stt_model", { id });
      if (activeModel === id) {
        setActiveModel("");
        await setPref(PREF_KEYS.localModel, "");
      }
      await queryClient.invalidateQueries({ queryKey: ["stt", "models"] });
    } catch (err) {
      setDownloadNote(err instanceof Error ? err.message : "Failed to delete model.");
    }
  }

  async function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".bin")) {
      setImportError("Please select a valid Whisper .bin model file.");
      return;
    }

    setImporting(true);
    setImportProgress(0);
    setImportFileName(file.name);
    setImportError(null);

    const CHUNK_SIZE = 1024 * 1024; // 1 MB chunks
    const totalBytes = file.size;
    let offset = 0;
    let isFirst = true;

    try {
      while (offset < totalBytes) {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const arrayBuf = await slice.arrayBuffer();
        const chunkBase64 = uint8ArrayToBase64(new Uint8Array(arrayBuf));

        await invokeCommand("import_stt_model_chunk", {
          fileName: file.name,
          chunkBase64,
          append: !isFirst,
        });

        isFirst = false;
        offset += CHUNK_SIZE;
        setImportProgress(Math.min(100, Math.round((offset / totalBytes) * 100)));
      }

      await queryClient.invalidateQueries({ queryKey: ["stt", "models"] });
      await activate(file.name);
      setDownloadNote(`Successfully imported and activated "${file.name}"`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import model.");
    } finally {
      setImporting(false);
      setImportProgress(0);
      setImportFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (list.isError) {
    return (
      <p className="text-sm text-text-2" data-testid="local-stt-unavailable">
        Local speech-to-text is not built into this install — cloud providers
        still work.
      </p>
    );
  }

  const models = list.data?.models ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <h4 className="text-sm font-medium text-text">On-Device Whisper Models</h4>
          <p className="text-xs text-text-3 mt-0.5">
            Private, offline transcription without cloud APIs or network calls.
          </p>
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing || downloadingId !== null}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto rounded-lg border border-hairline bg-elevated px-3 py-2 text-xs font-medium text-text hover:border-accent hover:text-accent transition-colors disabled:opacity-50"
        >
          <FolderUp size={14} />
          <span>Import .bin Model</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".bin"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {importing && (
        <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-text">
            <span>Importing {importFileName}…</span>
            <span className="font-mono text-accent">{importProgress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-base">
            <div
              className="h-full bg-accent transition-all duration-150"
              style={{ width: `${importProgress}%` }}
            />
          </div>
        </div>
      )}

      {importError && (
        <p role="alert" className="text-xs text-[var(--sc-danger)]">
          {importError}
        </p>
      )}

      <div className="divide-y divide-hairline rounded-lg border border-hairline bg-surface/50">
        {models.map((model) => {
          const active = activeModel === model.id;
          return (
            <div
              key={model.id}
              className="flex items-center justify-between gap-3 p-3 first:rounded-t-lg last:rounded-b-lg"
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-text truncate">
                    {model.label}
                  </span>
                  {active && (
                    <span
                      data-testid={`active-${model.id}`}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"
                    >
                      <Check size={10} strokeWidth={3} />
                      Active
                    </span>
                  )}
                </div>
                <span className="text-xs text-text-3">
                  {model.installed ? "Installed on device" : "Available to download"}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {model.installed ? (
                  <>
                    {!active && (
                      <button
                        type="button"
                        onClick={() => void activate(model.id)}
                        disabled={downloadingId !== null || importing}
                        className="rounded-md border border-hairline bg-elevated px-3 py-1.5 text-xs text-text-2 hover:border-accent hover:text-text transition-colors disabled:opacity-50"
                      >
                        Activate
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteModel(model.id)}
                      disabled={downloadingId !== null || importing}
                      title="Delete model from storage"
                      aria-label={`Delete ${model.label}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-rose-500/20 hover:text-rose-400 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={13} />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void download(model.id)}
                    disabled={downloadingId !== null || importing}
                    className="inline-flex items-center gap-1 rounded-md border border-hairline bg-elevated px-3 py-1.5 text-xs text-text-2 hover:border-accent hover:text-text transition-colors disabled:opacity-50"
                  >
                    <Download size={12} />
                    <span>{downloadingId === model.id ? "Downloading…" : "Download"}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {downloadNote && (
        <p role="status" className="text-xs text-text-2">
          {downloadNote}
        </p>
      )}
    </div>
  );
}
