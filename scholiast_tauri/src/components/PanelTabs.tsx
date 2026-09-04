import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Edit3, FileText, Plus, Settings } from "lucide-react";
import {
  getPlayerSnapshot,
  playerBridge,
  usePlayerEvent,
} from "../player/playerBridge";
import TranscriptPanel from "../player/TranscriptPanel";
import { getVideoItems, upsertVideo } from "../lib/ipc";
import { getPref, PREF_KEYS, setPref } from "../lib/store";
import NotesTab, { type ActiveComposerState, type CapturedFrameMeta } from "./NotesTab";

type Tab = "notes" | "transcript";

interface PanelTabsProps {
  url: string;
  videoId?: string | null;
  onCaptureFrame?: () => Promise<CapturedFrameMeta | null>;
  tab?: Tab;
  onTabChange?: (tab: Tab) => void;
  onAddNote?: () => void;
  composer?: ActiveComposerState | null;
  onComposerChange?: (c: ActiveComposerState | null) => void;
  isMobile?: boolean;
  isTablet?: boolean;
}

const MIN_FONT_STEP = -2;
const MAX_FONT_STEP = 4;

function clampFontStep(v: number): number {
  return Math.min(MAX_FONT_STEP, Math.max(MIN_FONT_STEP, Math.round(v)));
}

export default function PanelTabs({
  url,
  videoId,
  onCaptureFrame,
  tab: controlledTab,
  onTabChange,
  onAddNote,
  composer,
  onComposerChange,
  isMobile,
  isTablet,
}: PanelTabsProps) {
  const [internalTab, setInternalTab] = useState<Tab>("notes");
  const currentTab = controlledTab !== undefined ? controlledTab : internalTab;
  const setTab = (t: Tab) => {
    if (onTabChange) onTabChange(t);
    setInternalTab(t);
  };

  const [captionsAvailable, setCaptionsAvailable] = useState(false);
  const [fontStep, setFontStep] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  usePlayerEvent("onCaptionsAvailable", setCaptionsAvailable);

  useEffect(() => {
    void getPref<number>(PREF_KEYS.videoNoteFontStep, 0)
      .then((v) => setFontStep(clampFontStep(Number(v) || 0)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && settingsRef.current && !settingsRef.current.contains(t)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [settingsOpen]);

  const changeFontStep = (delta: number) => {
    setFontStep((prev) => {
      const next = clampFontStep(prev + delta);
      void setPref(PREF_KEYS.videoNoteFontStep, next).catch(() => {});
      return next;
    });
  };

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

  const handleAddNoteClick = () => {
    if (onAddNote) {
      onAddNote();
    } else {
      const snap = getPlayerSnapshot();
      const wasPlaying = snap.playing;
      if (wasPlaying) playerBridge.commands.pause();
      if (onComposerChange) {
        onComposerChange({
          timestamp: snap.time,
          draft: "",
          wasPlaying,
          autoFocus: true,
        });
      }
    }
  };

  const segBase =
    "sc-hit flex flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors duration-[var(--sc-dur-fast)] ease-out";
  const segActive = "bg-elevated text-text";
  const segIdle = "text-text-2 hover:text-text";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex items-center gap-1 border-b border-hairline bg-surface px-2 py-2">
        <button
          type="button"
          onClick={() => setTab("notes")}
          aria-current={currentTab === "notes" ? "page" : undefined}
          data-testid="panel-tab-notes"
          className={`${segBase} ${currentTab === "notes" ? segActive : segIdle}`}
        >
          <Edit3 size={16} strokeWidth={2} aria-hidden />
          <span>Notes</span>
          <span className="ml-0.5 rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold leading-none text-[var(--sc-accent-text)]">
            {notesCount}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab("transcript")}
          aria-current={currentTab === "transcript" ? "page" : undefined}
          data-testid="panel-tab-transcript"
          title={captionsAvailable ? undefined : "No captions for this video — add notes manually"}
          className={`${segBase} ${currentTab === "transcript" ? segActive : segIdle} ${!captionsAvailable ? "opacity-60" : ""}`}
        >
          <FileText size={16} strokeWidth={2} aria-hidden />
          <span>Transcript</span>
        </button>
        <div className="relative ml-auto flex items-center gap-1" ref={settingsRef}>
          {currentTab === "notes" && (
            <button
              type="button"
              aria-label="Add note at current timestamp"
              title="Add note (N)"
              data-testid="add-note-button"
              onClick={handleAddNoteClick}
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-2 hover:bg-elevated hover:text-accent transition-all active:scale-95"
            >
              <Plus size={16} strokeWidth={2.2} />
            </button>
          )}
          <button
            type="button"
            aria-label="Note display settings"
            aria-expanded={settingsOpen}
            data-testid="video-notes-settings"
            onClick={() => setSettingsOpen((v) => !v)}
            className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${settingsOpen ? "bg-elevated text-accent" : "text-text-2 hover:bg-elevated hover:text-text"}`}
          >
            <Settings size={16} strokeWidth={2} aria-hidden />
          </button>
          {settingsOpen && (
            <div
              role="dialog"
              aria-label="Note settings"
              className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-hairline bg-surface p-3 shadow-xl backdrop-blur-md"
            >
              <div className="space-y-3">
                <div>
                  <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">Comment Font Size</span>
                  <div className="mt-1 flex items-center justify-between rounded-md border border-hairline bg-base p-1">
                    <button
                      type="button"
                      onClick={() => changeFontStep(-1)}
                      disabled={fontStep <= MIN_FONT_STEP}
                      className="h-8 w-10 rounded text-xs font-semibold text-text-2 hover:bg-elevated hover:text-text disabled:opacity-30"
                    >
                      A−
                    </button>
                    <span className="font-mono text-xs tabular-nums text-text">{15 + fontStep}px</span>
                    <button
                      type="button"
                      onClick={() => changeFontStep(1)}
                      disabled={fontStep >= MAX_FONT_STEP}
                      className="h-8 w-10 rounded text-xs font-semibold text-text-2 hover:bg-elevated hover:text-text disabled:opacity-30"
                    >
                      A+
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-text-3">Applies to video notes and replies in this panel.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {currentTab === "notes" ? (
        <NotesTab
          url={url}
          onCaptureFrame={onCaptureFrame}
          fontStep={fontStep}
          composer={composer}
          onComposerChange={onComposerChange}
          isMobile={isMobile}
          isTablet={isTablet}
        />
      ) : (
        <TranscriptPanel url={url} videoId={videoId ?? null} />
      )}
    </div>
  );
}
