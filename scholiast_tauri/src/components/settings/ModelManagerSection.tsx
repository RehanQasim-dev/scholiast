import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

export default function ModelManagerSection() {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["stt", "models"],
    queryFn: () => invokeCommand<ModelListResponse>("list_stt_models"),
    retry: false,
  });
  const [activeModel, setActiveModel] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);

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
    <div className="space-y-2">
      {models.map((model) => {
        const active = activeModel === model.id;
        return (
          <div
            key={model.id}
            className="flex items-center justify-between gap-3 rounded-sm border border-hairline bg-elevated px-3 py-2"
          >
            <button
              type="button"
              onClick={() => model.installed && void activate(model.id)}
              disabled={!model.installed || downloadingId !== null}
              className={`text-left text-sm ${model.installed ? "hover:text-[var(--sc-accent)]" : "cursor-default text-text-2"}`}
              title={model.installed ? "Activate" : undefined}
            >
              {model.label}
              {active && (
                <span data-testid={`active-${model.id}`} className="ml-2 text-xs font-medium text-[var(--sc-accent)]">
                  Active
                </span>
              )}
            </button>
            {!model.installed && (
              <button
                type="button"
                onClick={() => void download(model.id)}
                disabled={downloadingId !== null}
                className="rounded-sm border border-hairline px-2 py-1 text-xs text-text-2 hover:text-text disabled:opacity-50"
              >
                {downloadingId === model.id ? "Downloading…" : "Download"}
              </button>
            )}
          </div>
        );
      })}
      {downloadNote && (
        <p role="status" className="text-xs text-text-2">
          {downloadNote}
        </p>
      )}
      <p className="text-xs text-text-2">
        Click an installed model to make it the default for offline dictation.
      </p>
    </div>
  );
}
