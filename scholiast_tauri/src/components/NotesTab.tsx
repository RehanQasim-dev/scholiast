import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Camera, Check, Clock, Keyboard, Mic, Square, X } from "lucide-react";
import { deleteVideoItem, getVideoItems, upsertVideo, invokeCommand } from "../lib/ipc";
import NoteCard, { type TimelineItem } from "./NoteCard";
import AudioWave from "./AudioWave";
import { toast } from "./Toast";
import { formatElapsedMs, micErrorMessage, useVoiceComment, voiceFailureMessage } from "../voice/useVoiceComment";
import {
  getPlayerSnapshot,
  playerBridge,
} from "../player/playerBridge";
import useIsNarrow from "../hooks/useIsNarrow";
import useIsTablet from "../hooks/useIsTablet";

export function orderItems(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => {
    if (a.videoTime !== b.videoTime) return a.videoTime - b.videoTime;
    return (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
  });
}

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

export interface CapturedFrameMeta {
  path: string;
  w: number;
  h: number;
  urlHash: string;
}

export interface ActiveComposerState {
  timestamp: number;
  draft: string;
  wasPlaying: boolean;
  capturedFrame?: CapturedFrameMeta | null;
  autoFocus?: boolean;
}

interface InSituCardProps {
  composer: ActiveComposerState;
  onSave: (text: string, frame?: CapturedFrameMeta | null) => Promise<void>;
  onCancel: () => void;
  onDrawFrame?: (frame: CapturedFrameMeta) => void;
  onRemoveFrame?: () => void;
}

export function InSituCard({
  composer,
  onSave,
  onCancel,
  onDrawFrame,
  onRemoveFrame,
}: InSituCardProps) {
  const [draft, setDraft] = useState(composer.draft);
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof cardRef.current?.scrollIntoView === "function") {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Real wrap detection (extension pattern): reset to one row, then the
    // text wraps iff scrollHeight exceeds the single-row clientHeight.
    // No char-count guessing — the button stays inline until the text truly
    // reaches the right edge, on any screen width.
    el.style.height = "auto";
    setIsMultiLine(
      draft.includes("\n") || el.scrollHeight - el.clientHeight > 4,
    );
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [draft]);

  const handleCommit = async () => {
    if (!draft.trim() && !composer.capturedFrame) return;
    setSaving(true);
    try {
      await onSave(draft.trim(), composer.capturedFrame);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key === "Enter") {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        void handleCommit();
      } else {
        e.stopPropagation();
      }
    }
  };

  return (
    <article
      ref={cardRef}
      data-testid="in-situ-composer"
      className="rounded-xl border border-accent/40 bg-surface/95 px-2.5 py-2 shadow-md shadow-black/20 ring-1 ring-accent/30 transition-all flex flex-col gap-1.5"
    >
      {/* Header: Timestamp Chip & Discard Button */}
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 border border-accent/30 px-2 py-0.5 font-mono text-[11px] font-medium text-accent">
          <Clock size={11} strokeWidth={2} />
          {formatVideoTime(composer.timestamp)}
        </span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Discard note"
          title="Discard (Esc)"
          className="flex h-5 w-5 items-center justify-center rounded-full text-text-3 hover:bg-elevated hover:text-text transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* Captured Frame Thumbnail if present */}
      {composer.capturedFrame && (
        <div className="relative inline-flex items-center gap-2 rounded-lg border border-hairline bg-elevated p-1.5">
          <img
            src={convertFileSrc(composer.capturedFrame.path)}
            alt="Captured frame"
            onClick={() => onDrawFrame?.(composer.capturedFrame!)}
            className="h-12 w-20 object-cover rounded cursor-pointer border border-hairline hover:opacity-90"
            title="Tap to draw over frame"
          />
          <div className="text-xs text-text-2">
            <span className="font-mono">{formatVideoTime(composer.timestamp)}</span>
            <p className="text-[11px] text-text-3">Tap image to draw</p>
          </div>
          {onRemoveFrame && (
            <button
              type="button"
              onClick={onRemoveFrame}
              aria-label="Remove captured frame"
              className="ml-auto flex h-5 w-5 items-center justify-center rounded-full text-text-3 hover:bg-surface hover:text-text"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Dynamic Save Button: one box, like the extension thread box — Save
        rides inline on the first line and drops below only once the text
        wraps past the right edge. A single textarea (never remounted) so
        focus survives the inline↔below switch mid-typing. */}
      <div className={`flex gap-2 ${isMultiLine ? "flex-col" : "items-center"}`}>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus={composer.autoFocus !== false}
          placeholder="Write a note…"
          rows={1}
          className="min-h-[36px] flex-1 resize-none bg-transparent py-1 px-1 text-sm text-text outline-none placeholder:text-text-3 font-normal max-h-[130px] overflow-y-auto"
        />
        <button
          type="button"
          onClick={() => void handleCommit()}
          disabled={saving || (!draft.trim() && !composer.capturedFrame)}
          data-testid={isMultiLine ? "save-note-btn-bottom" : "save-note-btn-inline"}
          className={`flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[var(--sc-accent-text)] shadow-sm hover:opacity-90 active:scale-95 disabled:opacity-30 transition-all ${isMultiLine ? "self-end" : "shrink-0"}`}
        >
          <Check size={14} strokeWidth={2.5} />
          <span>Save</span>
        </button>
      </div>
    </article>
  );
}

interface NotesTabProps {
  url: string;
  deleteGraceMs?: number;
  onCaptureFrame?: () => Promise<CapturedFrameMeta | null>;
  fontStep?: number;
  composer?: ActiveComposerState | null;
  onComposerChange?: (c: ActiveComposerState | null) => void;
  isMobile?: boolean;
  isTablet?: boolean;
}

interface PendingDelete {
  item: TimelineItem;
  snapshot: TimelineItem[];
}

export default function NotesTab({
  url,
  deleteGraceMs = 5000,
  onCaptureFrame,
  fontStep = 0,
  composer: controlledComposer,
  onComposerChange,
  isMobile,
  isTablet,
}: NotesTabProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const pendingRef = useRef<PendingDelete | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Composer internal state fallback if uncontrolled
  const [internalComposer, setInternalComposer] = useState<ActiveComposerState | null>(null);
  const activeComposer = controlledComposer !== undefined ? controlledComposer : internalComposer;
  const setComposerState = (c: ActiveComposerState | null) => {
    if (onComposerChange) onComposerChange(c);
    setInternalComposer(c);
  };

  const isNarrowHook = useIsNarrow();
  const isTabletHook = useIsTablet();
  const isNarrowDevice = isMobile !== undefined ? isMobile : (isNarrowHook && !isTabletHook && !isTablet);

  const [mobileVoiceWasPlaying, setMobileVoiceWasPlaying] = useState(false);
  const [mobileVoiceTimestamp, setMobileVoiceTimestamp] = useState(0);

  const voice = useVoiceComment({
    kind: "add",
    enabled: true,
  });

  const listEndRef = useRef<HTMLDivElement | null>(null);

  const videoQuery = useQuery({
    queryKey: ["video", url],
    queryFn: () => upsertVideo({ url }),
    enabled: Boolean(url),
    staleTime: Infinity,
  });
  const urlHash = videoQuery.data?.urlHash;

  const itemsQuery = useQuery({
    queryKey: ["videoItems", urlHash],
    queryFn: async () => orderItems(await getVideoItems({ urlHash: urlHash! })),
    enabled: Boolean(urlHash),
  });

  useEffect(() => {
    if (!urlHash) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    try {
      void listen("db://changed:video_items", () => {
        void queryClient.invalidateQueries({
          queryKey: ["videoItems", urlHash],
        });
      })
        .then((fn) => {
          if (cancelled) fn();
          else dispose = fn;
        })
        .catch(() => {});
    } catch {}
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [queryClient, urlHash]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const candidate = pendingRef.current;
      if (candidate && urlHash) {
        void deleteVideoItem({ urlHash, itemId: candidate.item.id }).catch(() => {});
      }
    },
    [urlHash],
  );

  const finalize = async (candidate: PendingDelete) => {
    if (pendingRef.current === candidate) {
      pendingRef.current = null;
      setPending(null);
    }
    try {
      await deleteVideoItem({ urlHash: urlHash!, itemId: candidate.item.id });
    } catch {}
    void queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
  };

  const startDelete = (item: TimelineItem) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const snapshot = [...(itemsQuery.data ?? [])];
    const filtered = snapshot.filter((i) => i.id !== item.id);
    queryClient.setQueryData(["videoItems", urlHash], filtered);
    const candidate = { item, snapshot };
    pendingRef.current = candidate;
    setPending(candidate);
    timerRef.current = setTimeout(() => {
      void finalize(candidate);
    }, deleteGraceMs);
  };

  const undoDelete = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const candidate = pendingRef.current;
    if (candidate) {
      pendingRef.current = null;
      setPending(null);
      queryClient.setQueryData(["videoItems", urlHash], candidate.snapshot);
    }
  };

  const handleEdit = async (item: TimelineItem, body: string) => {
    if (!urlHash) return;
    const note = `${body}<!--timestamp:${Date.now()}-->`;
    const nextNotes = item.notes.length > 0 ? item.notes.map((_, i) => (i === 0 ? note : item.notes[i]!)) : [note];
    const updated: TimelineItem = { ...item, notes: nextNotes, updatedAt: Date.now() };
    queryClient.setQueryData<TimelineItem[]>(["videoItems", urlHash], (prev) =>
      prev ? prev.map((i) => (i.id === item.id ? updated : i)) : prev,
    );
    try {
      await invokeCommand("save_video_item", { urlHash, item: updated });
      await queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
    }
  };

  const handleSaveComposer = async (text: string, frame?: CapturedFrameMeta | null) => {
    if (!text && !frame) return;
    if (!urlHash || !activeComposer) return;

    try {
      const videoTime = activeComposer.timestamp;
      const note = text ? `${text}<!--timestamp:${Date.now()}-->` : "";
      const itemId = genVideoItemId();

      const newItem: TimelineItem = {
        id: itemId,
        kind: frame ? "frame" : "note",
        videoTime,
        notes: note ? [note] : [],
        updatedAt: Date.now(),
        frame: frame ? { w: frame.w, h: frame.h } : undefined,
      };

      await invokeCommand("save_video_item", { urlHash, item: newItem });
      await queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
      const resume = activeComposer.wasPlaying;
      setComposerState(null);
      if (resume) {
        playerBridge.commands.play();
      }
    } catch {
      toast("Couldn't save note");
    }
  };

  const handleCancelComposer = () => {
    if (!activeComposer) return;
    const resume = activeComposer.wasPlaying;
    setComposerState(null);
    if (resume) {
      playerBridge.commands.play();
    }
  };

  const handleDrawFrame = (frame: CapturedFrameMeta) => {
    navigate("/frame", {
      state: {
        urlHash,
        url,
        tmpPath: frame.path,
        w: frame.w,
        h: frame.h,
        videoTime: activeComposer?.timestamp ?? 0,
      },
    });
  };

  const handleRemoveFrame = () => {
    if (activeComposer) {
      setComposerState({ ...activeComposer, capturedFrame: null });
    }
  };

  // Mobile Bottom Bar handlers
  const handleMobileVoiceTap = async () => {
    if (voice.recording) {
      try {
        const text = await voice.stop();
        setComposerState({
          timestamp: mobileVoiceTimestamp,
          draft: text || "",
          wasPlaying: mobileVoiceWasPlaying,
          autoFocus: false, // Don't autofocus to avoid pop-up keyboard
        });
      } catch (err) {
        toast(voiceFailureMessage(err, "Voice transcription failed"));
        if (mobileVoiceWasPlaying) playerBridge.commands.play();
      }
    } else {
      const snap = getPlayerSnapshot();
      const wasPlaying = snap.playing;
      if (wasPlaying) playerBridge.commands.pause();
      setMobileVoiceWasPlaying(wasPlaying);
      setMobileVoiceTimestamp(snap.time);

      try {
        await voice.start();
      } catch (err) {
        toast(micErrorMessage(err, "Microphone unavailable"));
        if (wasPlaying) playerBridge.commands.play();
      }
    }
  };

  const handleCancelMobileVoice = async () => {
    try {
      await voice.cancel();
    } finally {
      if (mobileVoiceWasPlaying) playerBridge.commands.play();
    }
  };

  const handleMobileTypeTap = () => {
    const snap = getPlayerSnapshot();
    const wasPlaying = snap.playing;
    if (wasPlaying) playerBridge.commands.pause();

    setComposerState({
      timestamp: snap.time,
      draft: "",
      wasPlaying,
      autoFocus: true,
    });
  };

  const handleCaptureFrameClick = async () => {
    if (!onCaptureFrame) return;
    const snap = getPlayerSnapshot();
    const wasPlaying = snap.playing;
    if (wasPlaying) playerBridge.commands.pause();

    const frame = await onCaptureFrame();
    if (frame) {
      if (activeComposer) {
        setComposerState({ ...activeComposer, capturedFrame: frame });
      } else {
        setComposerState({
          timestamp: snap.time,
          draft: "",
          wasPlaying,
          capturedFrame: frame,
          autoFocus: true,
        });
      }
    } else if (wasPlaying) {
      playerBridge.commands.play();
    }
  };

  if (!url || videoQuery.isError) {
    return (
      <p className="p-4 text-sm text-text-2">
        Couldn't load this video's notes.
      </p>
    );
  }

  if (videoQuery.isPending || (urlHash && itemsQuery.isPending)) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    );
  }

  if (itemsQuery.isError) {
    return (
      <p className="p-4 text-sm text-text-2">
        Couldn't load notes for this video.
      </p>
    );
  }

  const items = itemsQuery.data ?? [];

  // Build rendered list with InSituCard chronologically inserted
  const renderList = () => {
    if (!activeComposer) {
      return items.map((item) => (
        <NoteCard key={item.id} item={item} onDelete={startDelete} onEdit={handleEdit} />
      ));
    }

    const elements: React.ReactNode[] = [];
    let inserted = false;

    for (const item of items) {
      if (!inserted && activeComposer.timestamp <= item.videoTime) {
        elements.push(
          <InSituCard
            key="active-composer"
            composer={activeComposer}
            onSave={handleSaveComposer}
            onCancel={handleCancelComposer}
            onDrawFrame={handleDrawFrame}
            onRemoveFrame={handleRemoveFrame}
          />,
        );
        inserted = true;
      }
      elements.push(
        <NoteCard key={item.id} item={item} onDelete={startDelete} onEdit={handleEdit} />,
      );
    }

    if (!inserted) {
      elements.push(
        <InSituCard
          key="active-composer"
          composer={activeComposer}
          onSave={handleSaveComposer}
          onCancel={handleCancelComposer}
          onDrawFrame={handleDrawFrame}
          onRemoveFrame={handleRemoveFrame}
        />,
      );
    }

    return elements;
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-surface"
      style={{ ["--sc-note-font" as unknown as string]: `${15 + fontStep}px` } as any}
    >
      {/* Scrollable Chronological Notes Stream */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2 sm:px-3 sm:py-2.5 flex flex-col gap-1.5">
        {items.length === 0 && !activeComposer ? (
          <div className="my-auto flex flex-col items-center gap-1 rounded-lg border border-dashed border-hairline px-6 py-12 text-center">
            <p className="text-sm font-medium text-text">No notes yet.</p>
            <p className="text-xs text-text-3">
              Capture a frame or add a note while watching — they'll show up here
              in video order.
            </p>
          </div>
        ) : (
          renderList()
        )}
        <div ref={listEndRef} />
      </div>

      {pending && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-t border-hairline bg-elevated px-3 py-2 text-sm text-text"
        >
          <span>Note deleted.</span>
          <button
            type="button"
            onClick={undoDelete}
            className="rounded px-2 py-0.5 font-medium text-accent transition-opacity duration-[var(--sc-dur-fast)] ease-out hover:opacity-80"
          >
            Undo
          </button>
        </div>
      )}

      {/* Mobile-Only 3-Action Bottom Bar (Hidden completely on Desktop & Tablet) */}
      {isNarrowDevice && (
        <div className="shrink-0 border-t border-hairline bg-surface/95 backdrop-blur-md p-2.5">
          {voice.recording ? (
            /* Live Audio Wave Visualizer while recording */
            <div
              data-testid="mobile-wave-bar"
              className="flex items-center justify-between gap-3 rounded-full border border-[color:var(--sc-danger)]/40 bg-base/90 px-3.5 py-2 shadow-sm"
            >
              <div className="flex items-center gap-2 text-xs text-[color:var(--sc-danger)]">
                <span className="h-2 w-2 rounded-full bg-[color:var(--sc-danger)] animate-ping" />
                <AudioWave bars={5} className="text-[var(--sc-danger)]" />
                <span className="font-mono tabular-nums font-medium">
                  {formatElapsedMs(voice.elapsedMs)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleMobileVoiceTap()}
                  className="flex items-center gap-1 rounded-full bg-[color:var(--sc-danger)] px-3 py-1 text-xs font-semibold text-white shadow-sm hover:opacity-90 active:scale-95"
                >
                  <Square size={12} fill="currentColor" />
                  <span>Stop</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleCancelMobileVoice()}
                  aria-label="Cancel recording"
                  className="flex h-6 w-6 items-center justify-center rounded-full text-text-3 hover:text-text active:scale-95"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            /* 3-Action Pill Bar */
            <div
              data-testid="mobile-action-bar"
              className="flex items-center gap-2"
            >
              {/* Voice Note (STT) - Prominent Emerald Action Pill */}
              <button
                type="button"
                data-testid="mobile-voice-btn"
                onClick={() => void handleMobileVoiceTap()}
                disabled={voice.state === "transcribing" || Boolean(voice.disabledReason)}
                title={voice.disabledReason ?? "Record voice note"}
                aria-label={voice.disabledReason ?? "Record voice note"}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-[var(--sc-accent-text)] transition-all active:scale-95"
              >
                {voice.state === "transcribing" ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--sc-accent-text)] border-t-transparent" />
                ) : (
                  <Mic size={18} strokeWidth={2.2} />
                )}
                <span>Voice Note</span>
              </button>

              {/* Frame Capture */}
              {onCaptureFrame && (
                <button
                  type="button"
                  data-testid="mobile-frame-btn"
                  onClick={() => void handleCaptureFrameClick()}
                  title="Capture frame snapshot"
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-hairline bg-elevated text-text-2 transition-colors hover:text-text active:scale-95"
                >
                  <Camera size={20} strokeWidth={2} />
                </button>
              )}

              {/* Type Note */}
              <button
                type="button"
                data-testid="mobile-type-btn"
                onClick={handleMobileTypeTap}
                title="Type note"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-hairline bg-elevated text-text-2 transition-colors hover:text-text active:scale-95"
              >
                <Keyboard size={20} strokeWidth={2} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
