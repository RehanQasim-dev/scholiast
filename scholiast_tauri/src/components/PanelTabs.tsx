import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Edit3, FileText } from "lucide-react";
import { usePlayerEvent } from "../player/playerBridge";
import TranscriptPanel from "../player/TranscriptPanel";
import { getVideoItems, upsertVideo } from "../lib/ipc";
import NotesTab from "./NotesTab";

type Tab = "notes" | "transcript";

interface PanelTabsProps {
  url: string;
  videoId?: string | null;
  onCaptureFrame?: () => Promise<{ path: string; w: number; h: number; urlHash: string } | null>;
}

export default function PanelTabs({ url, videoId, onCaptureFrame }: PanelTabsProps) {
  const [tab, setTab] = useState<Tab>("notes");
  const [captionsAvailable, setCaptionsAvailable] = useState(false);
  usePlayerEvent("onCaptionsAvailable", setCaptionsAvailable);

  const videoQuery = useQuery({
    queryKey: ["video", url],
    queryFn: () => upsertVideo({ url }),
    enabled: Boolean(url),
    staleTime: Infinity,
  });
  const urlHash = videoQuery.data?.urlHash;
  const itemsQuery = useQuery({
    queryKey: ["videoItems", urlHash],
    queryFn: async () => getVideoItems({ urlHash: urlHash! }),
    enabled: Boolean(urlHash),
  });
  const notesCount = useMemo(() => (itemsQuery.data ?? []).length, [itemsQuery.data]);

  const segBase =
    "sc-hit flex flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors duration-[var(--sc-dur-fast)] ease-out";
  const segActive = "bg-elevated text-text";
  const segIdle = "text-text-2 hover:text-text";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-hairline bg-surface px-2 py-2">
        <button
          type="button"
          onClick={() => setTab("notes")}
          aria-current={tab === "notes" ? "page" : undefined}
          data-testid="panel-tab-notes"
          className={`${segBase} ${tab === "notes" ? segActive : segIdle}`}
        >
          <Edit3 size={24} strokeWidth={2} aria-hidden />
          <span>Notes</span>
          <span className="ml-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[var(--sc-accent-text)]">
            {notesCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab("transcript")}
          aria-current={tab === "transcript" ? "page" : undefined}
          data-testid="panel-tab-transcript"
          title={captionsAvailable ? undefined : "No captions for this video — add notes manually"}
          className={`${segBase} ${tab === "transcript" ? segActive : segIdle} ${!captionsAvailable ? "opacity-60" : ""}`}
        >
          <FileText size={24} strokeWidth={2} aria-hidden />
          <span>Transcript</span>
        </button>
      </div>
      {tab === "notes" ? (
        <NotesTab url={url} onCaptureFrame={onCaptureFrame} />
      ) : (
        <TranscriptPanel url={url} videoId={videoId ?? null} />
      )}
    </div>
  );
}
