import { useState } from "react";
import { usePlayerEvent } from "../player/playerBridge";
import TranscriptPanel from "../player/TranscriptPanel";
import NotesTab from "./NotesTab";

type Tab = "notes" | "transcript";

interface PanelTabsProps {
  url: string;
  videoId?: string | null;
}

export default function PanelTabs({ url, videoId }: PanelTabsProps) {
  const [tab, setTab] = useState<Tab>("notes");
  const [captionsAvailable, setCaptionsAvailable] = useState(false);
  usePlayerEvent("onCaptionsAvailable", setCaptionsAvailable);

  const tabClass = (active: boolean) =>
    `rounded px-1 py-0.5 transition-colors duration-[var(--sc-dur-fast)] ease-out ${
      active ? "text-text" : "hover:text-text"
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-3 text-xs font-medium uppercase tracking-wide">
        <button
          type="button"
          onClick={() => setTab("notes")}
          aria-current={tab === "notes" ? "page" : undefined}
          className={tabClass(tab === "notes")}
        >
          Notes
        </button>
        <span aria-hidden className="text-text-3">
          ·
        </span>
        <button
          type="button"
          onClick={() => setTab("transcript")}
          disabled={!captionsAvailable}
          aria-disabled={!captionsAvailable}
          aria-current={tab === "transcript" ? "page" : undefined}
          title={
            captionsAvailable
              ? undefined
              : "No captions for this video"
          }
          className={`${tabClass(tab === "transcript")} disabled:text-text-3 disabled:hover:text-text-3`}
        >
          Transcript
        </button>
      </div>
      {tab === "notes" ? (
        <NotesTab url={url} />
      ) : (
        <TranscriptPanel url={url} videoId={videoId ?? null} />
      )}
    </div>
  );
}
