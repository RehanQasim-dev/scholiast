import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Clock, Edit3, FileText, Mic, Plus, X } from "lucide-react";
import AudioWave from "../AudioWave";
import { invokeCommand } from "../../lib/ipc";
import { type TimelineItem } from "../NoteCard";
import { toast } from "../Toast";
import { useVoiceComment, voiceFailureMessage } from "../../voice/useVoiceComment";
import {
  getPlayerSnapshot,
  playerBridge,
} from "../../player/playerBridge";

function formatVideoTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";
function genVideoItemId(): string {
  const millis = Date.now().toString(36);
  let suffix = "";
  try {
    const bytes = new Uint8Array(5);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) suffix += BASE36[byte % 36];
  } catch {
    for (let i = 0; i < 5; i += 1)
      suffix += BASE36[Math.floor(Math.random() * 36)];
  }
  return millis + suffix;
}

export interface TabletVideoDockProps {
  activePanel: "notes" | "transcript" | null;
  onTogglePanel: (panel: "notes" | "transcript") => void;
  onAddNote: () => void;
  onCaptureFrame: () => void;
  urlHash?: string;
}

interface PopoverState {
  timestamp: number;
  draft: string;
  wasPlaying: boolean;
}

export default function TabletVideoDock({
  activePanel,
  onTogglePanel,
  onAddNote,
  onCaptureFrame,
  urlHash,
}: TabletVideoDockProps) {
  const queryClient = useQueryClient();
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [recordingTimestamp, setRecordingTimestamp] = useState(0);
  const [recordedWasPlaying, setRecordedWasPlaying] = useState(false);
  const [savingPopover, setSavingPopover] = useState(false);

  const voice = useVoiceComment({
    kind: "add",
    enabled: true,
  });

  const handleMicClick = async () => {
    if (voice.recording) {
      try {
        const text = await voice.stop();
        setPopover({
          timestamp: recordingTimestamp,
          draft: text || "",
          wasPlaying: recordedWasPlaying,
        });
      } catch (err) {
        toast(voiceFailureMessage(err, "Voice transcription failed"));
        if (recordedWasPlaying) playerBridge.commands.play();
      }
    } else {
      const snap = getPlayerSnapshot();
      const wasPlaying = snap.playing;
      if (wasPlaying) playerBridge.commands.pause();

      setRecordedWasPlaying(wasPlaying);
      setRecordingTimestamp(snap.time);

      try {
        await voice.start();
      } catch {
        toast("Microphone unavailable");
        if (wasPlaying) playerBridge.commands.play();
      }
    }
  };

  const handleSavePopover = async () => {
    if (!popover || !urlHash) return;
    const text = popover.draft.trim();
    if (!text) {
      handleClosePopover();
      return;
    }

    setSavingPopover(true);
    try {
      const note = `${text}<!--timestamp:${Date.now()}-->`;
      const newItem: TimelineItem = {
        id: genVideoItemId(),
        kind: "note",
        videoTime: popover.timestamp,
        notes: [note],
        updatedAt: Date.now(),
      };

      await invokeCommand("save_video_item", { urlHash, item: newItem });
      await queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
      const resume = popover.wasPlaying;
      setPopover(null);
      if (resume) playerBridge.commands.play();
    } catch {
      toast("Couldn't save voice note");
    } finally {
      setSavingPopover(false);
    }
  };

  const handleClosePopover = () => {
    if (!popover) return;
    const resume = popover.wasPlaying;
    setPopover(null);
    if (resume) playerBridge.commands.play();
  };

  return (
    <>
      <nav
        aria-label="Video tools dock"
        data-testid="tablet-video-dock"
        className="fixed top-0 right-0 bottom-0 w-12 z-30 flex flex-col items-center py-4 bg-surface/95 border-l border-hairline backdrop-blur shadow-lg gap-2"
      >
        {/* Notes Toggle */}
        <button
          type="button"
          aria-label="Toggle notes panel"
          title="Notes"
          onClick={() => onTogglePanel("notes")}
          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-95 ${
            activePanel === "notes"
              ? "bg-accent/20 text-accent ring-1 ring-accent/40"
              : "text-text-2 hover:bg-elevated hover:text-text"
          }`}
        >
          <Edit3 size={18} strokeWidth={2} />
        </button>

        {/* Transcript Toggle */}
        <button
          type="button"
          aria-label="Toggle transcript panel"
          title="Transcript"
          onClick={() => onTogglePanel("transcript")}
          className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-95 ${
            activePanel === "transcript"
              ? "bg-accent/20 text-accent ring-1 ring-accent/40"
              : "text-text-2 hover:bg-elevated hover:text-text"
          }`}
        >
          <FileText size={18} strokeWidth={2} />
        </button>

        <div className="my-1 h-px w-6 bg-hairline" aria-hidden="true" />

        {/* Add Note Button */}
        <button
          type="button"
          aria-label="Add note"
          title="Add note"
          onClick={onAddNote}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-text-2 hover:bg-elevated hover:text-text transition-all active:scale-95"
        >
          <Plus size={18} strokeWidth={2.2} />
        </button>

        {/* Capture Frame Button */}
        <button
          type="button"
          aria-label="Capture frame snapshot"
          title="Capture frame"
          onClick={onCaptureFrame}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-text-2 hover:bg-elevated hover:text-text transition-all active:scale-95"
        >
          <Camera size={18} strokeWidth={2} />
        </button>

        {/* Voice Note Button with in-dock wave animation */}
        <button
          type="button"
          aria-label={voice.recording ? "Stop voice note" : "Record voice note"}
          title={voice.recording ? "Stop recording" : "Record voice note"}
          onClick={() => void handleMicClick()}
          disabled={voice.state === "transcribing" || Boolean(voice.disabledReason)}
          className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-all active:scale-95 ${
            voice.recording
              ? "bg-[color:var(--sc-danger)]/20 text-[color:var(--sc-danger)] ring-1 ring-[color:var(--sc-danger)]/50"
              : voice.disabledReason
                ? "text-text-3 opacity-40 cursor-not-allowed"
                : "text-text-2 hover:bg-elevated hover:text-text"
          }`}
        >
          {voice.state === "transcribing" ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          ) : voice.recording ? (
            <AudioWave bars={3} className="text-[var(--sc-danger)]" />
          ) : (
            <Mic size={18} strokeWidth={2} />
          )}
        </button>
      </nav>

      {/* Floating Right-Anchored Transcription Popover */}
      {popover && (
        <div
          role="dialog"
          aria-label="Transcribed voice note"
          data-testid="tablet-voice-popover"
          className="fixed right-14 top-20 z-40 w-80 max-w-[calc(100vw-4rem)] rounded-xl border border-hairline bg-surface/95 p-3.5 shadow-2xl backdrop-blur-md ring-1 ring-accent/20 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 border border-accent/30 px-2 py-0.5 font-mono text-[11px] font-medium text-accent">
              <Clock size={11} strokeWidth={2} /> {formatVideoTime(popover.timestamp)}
            </span>
            <button
              type="button"
              onClick={handleClosePopover}
              aria-label="Discard voice note"
              className="flex h-5 w-5 items-center justify-center rounded-full text-text-3 hover:bg-elevated hover:text-text"
            >
              <X size={13} />
            </button>
          </div>

          <textarea
            value={popover.draft}
            onChange={(e) =>
              setPopover((prev) => (prev ? { ...prev, draft: e.target.value } : null))
            }
            rows={3}
            autoFocus={false}
            placeholder="Transcribed voice note…"
            className="w-full resize-none rounded-lg border border-hairline bg-base/80 p-2 text-sm text-text outline-none focus:border-accent"
          />

          <div className="flex items-center justify-end gap-2 pt-1 border-t border-hairline/60">
            <button
              type="button"
              onClick={handleClosePopover}
              className="px-2.5 py-1 rounded-lg text-xs text-text-2 hover:bg-elevated hover:text-text"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSavePopover()}
              disabled={savingPopover || !popover.draft.trim()}
              className="px-3 py-1 rounded-lg bg-accent text-[var(--sc-accent-text)] text-xs font-semibold hover:opacity-90 active:scale-95 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </>
  );
}
