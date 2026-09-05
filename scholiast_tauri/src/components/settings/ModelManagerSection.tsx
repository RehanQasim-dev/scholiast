import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, FolderUp, Trash2 } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invokeCommand } from "../../lib/ipc";
import { PREF_KEYS, getPref, setPref } from "../../lib/store";

const WHISPER_MODELS_URL = "https://keyboard.futo.org/voice-input-models";

interface CatalogEntry {
  id: string;
  label: string;
  fileName?: string;
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
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const installedModels = (list.data?.models ?? []).filter((m) => m.installed);

  useEffect(() => {
    let cancelled = false;
    getPref(PREF_KEYS.localModel, "").then((value) => {
      if (cancelled) return;
      if (installedModels.length > 0) {
        if (value && installedModels.some((m) => m.id === value || m.fileName === value)) {
          setActiveModel(value);
        } else {
          setActiveModel(installedModels[0].id);
        }
      } else {
        setActiveModel("");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [list.data]);

  async function activate(id: string) {
    setActiveModel(id);
    await setPref(PREF_KEYS.localModel, id);
  }

  async function handleExploreModels() {
    try {
      await openUrl(WHISPER_MODELS_URL);
    } catch {
      window.open(WHISPER_MODELS_URL, "_blank");
    }
  }

  async function deleteModel(id: string) {
    try {
      await invokeCommand("delete_stt_model", { id });
      const remaining = installedModels.filter((m) => m.id !== id);
      if (activeModel === id) {
        const next = remaining[0]?.id ?? "";
        setActiveModel(next);
        await setPref(PREF_KEYS.localModel, next);
      }
      await queryClient.invalidateQueries({ queryKey: ["stt", "models"] });
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : "Failed to delete model.");
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
    setStatusNote(null);

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
      setStatusNote(`Successfully imported and activated "${file.name}"`);
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

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-text">On-Device Whisper Models</h4>
        <p className="text-xs text-text-3 mt-0.5">
          Private, offline transcription without cloud APIs or network calls.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void handleExploreModels()}
          data-testid="explore-models-btn"
          className="flex items-center gap-3 p-3 rounded-lg border border-hairline bg-elevated/50 hover:bg-elevated hover:border-accent text-left transition-colors group"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-text-2 group-hover:text-accent group-hover:border-accent transition-colors border border-hairline">
            <ExternalLink size={16} />
          </div>
          <div className="min-w-0">
            <span className="block text-xs font-semibold text-text group-hover:text-accent transition-colors">
              Explore Models
            </span>
            <span className="block text-[11px] text-text-3 truncate">
              Download FUTO voice models (.bin)
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          data-testid="import-model-btn"
          className="flex items-center gap-3 p-3 rounded-lg border border-hairline bg-elevated/50 hover:bg-elevated hover:border-accent text-left transition-colors group disabled:opacity-50"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface text-text-2 group-hover:text-accent group-hover:border-accent transition-colors border border-hairline">
            <FolderUp size={16} />
          </div>
          <div className="min-w-0">
            <span className="block text-xs font-semibold text-text group-hover:text-accent transition-colors">
              Import Model
            </span>
            <span className="block text-[11px] text-text-3 truncate">
              Import a downloaded .bin file
            </span>
          </div>
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".bin"
        onChange={handleFileSelect}
        className="hidden"
        data-testid="model-file-input"
      />

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

      {installedModels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline p-5 text-center">
          <p className="text-xs font-medium text-text-2">No models imported yet</p>
          <p className="text-[11px] text-text-3 mt-1 max-w-xs mx-auto">
            Use <strong>Explore Models</strong> to download a Whisper model in your browser, then <strong>Import Model</strong> to load it.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-hairline rounded-lg border border-hairline bg-surface/50">
          {installedModels.map((model) => {
            const active = activeModel === model.id || activeModel === model.fileName;
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
                    Installed on device
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!active && (
                    <button
                      type="button"
                      onClick={() => void activate(model.id)}
                      disabled={importing}
                      className="rounded-md border border-hairline bg-elevated px-3 py-1.5 text-xs text-text-2 hover:border-accent hover:text-text transition-colors disabled:opacity-50"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteModel(model.id)}
                    disabled={importing}
                    title="Delete model from storage"
                    aria-label={`Delete ${model.label}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-rose-500/20 hover:text-rose-400 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {statusNote && (
        <p role="status" className="text-xs text-text-2">
          {statusNote}
        </p>
      )}
    </div>
  );
}
