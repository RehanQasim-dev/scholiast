import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Mic, Plus } from "lucide-react";
import { toast } from "./Toast";
import { addNote } from "../lib/ipc";
import { getPlayerSnapshot } from "../player/playerBridge";
import { useVoiceComment } from "../voice/useVoiceComment";

interface StudyDockProps {
  urlHash: string | null;
  onCapture: () => void;
  onNewNote: () => void;
  onVoiceNoteCreated?: () => void;
}

export default function StudyDock({ urlHash, onCapture, onNewNote, onVoiceNoteCreated }: StudyDockProps) {
  const queryClient = useQueryClient();
  const voice = useVoiceComment({ kind: "add", enabled: true });
  const [holding, setHolding] = useState(false);

  const createVoiceNote = useCallback(
    async (text: string) => {
      if (!urlHash || !text.trim()) return;
      const videoTime = getPlayerSnapshot().time;
      try {
        await addNote({ urlHash, videoTime, body: text.trim() });
        void queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
        onVoiceNoteCreated?.();
        toast("Voice note saved");
      } catch {
        toast("Couldn't save voice note");
      }
    },
    [urlHash, queryClient, onVoiceNoteCreated],
  );

  const handlePointerDown = useCallback(async () => {
    if (voice.disabledReason) {
      toast(voice.disabledReason);
      return;
    }
    setHolding(true);
    try {
      await voice.start();
    } catch {
      setHolding(false);
      toast("Microphone unavailable.");
    }
  }, [voice]);

  const handlePointerUp = useCallback(async () => {
    if (!holding) return;
    setHolding(false);
    if (!voice.recording) return;
    try {
      const text = await voice.stop();
      if (text) void createVoiceNote(text);
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "Transcription failed");
    }
  }, [holding, voice, createVoiceNote]);

  const handlePointerCancel = useCallback(() => {
    if (holding) {
      setHolding(false);
      void voice.cancel();
    }
  }, [holding, voice]);

  return (
    <nav
      aria-label="Study tools"
      data-testid="study-dock"
      className="flex h-10 shrink-0 items-center justify-around border-t border-hairline bg-surface px-2"
      style={{ height: "calc(40px + var(--sc-safe-bottom))", paddingBottom: "var(--sc-safe-bottom)" }}
    >
      <button
        type="button"
        aria-label={voice.disabledReason ?? (holding ? "Release to save" : "Hold to talk")}
        title={voice.disabledReason ?? "Hold to talk"}
        aria-pressed={holding}
        disabled={Boolean(voice.disabledReason)}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        className={`sc-hit flex items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
          holding ? "bg-[color:var(--sc-accent)] text-white" : "text-text-2 hover:bg-elevated hover:text-text"
        }`}
        data-testid="dock-mic"
      >
        {voice.state === "transcribing" ? (
          <span aria-hidden className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        ) : holding ? (
          <span aria-hidden className="h-3 w-3 rounded-sm bg-white" />
        ) : (
          <Mic size={24} strokeWidth={2} aria-hidden />
        )}
      </button>

      <button
        type="button"
        aria-label="Capture frame"
        onClick={onCapture}
        className="sc-hit flex items-center justify-center rounded-full text-text-2 hover:bg-elevated hover:text-text"
        data-testid="dock-camera"
      >
        <Camera size={24} strokeWidth={2} aria-hidden />
      </button>

      <button
        type="button"
        aria-label="New text note"
        onClick={onNewNote}
        className="sc-hit flex items-center justify-center rounded-full text-text-2 hover:bg-elevated hover:text-text"
        data-testid="dock-edit"
      >
        <Plus size={24} strokeWidth={2} aria-hidden />
      </button>
    </nav>
  );
}
