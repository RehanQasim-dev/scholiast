import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Camera, Clock, Keyboard, Mic, MicOff, Send, X } from "lucide-react";
import { deleteVideoItem, getVideoItems, upsertVideo, invokeCommand } from "../lib/ipc";
import NoteCard, { type TimelineItem } from "./NoteCard";
import { toast } from "./Toast";
import { formatElapsedMs, useVoiceComment } from "../voice/useVoiceComment";
import { getPlayerSnapshot, subscribePlayerState } from "../player/playerBridge";

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

interface NotesTabProps {
  url: string;
  deleteGraceMs?: number;
  onCaptureFrame?: () => Promise<CapturedFrameMeta | null>;
}

interface PendingDelete {
  item: TimelineItem;
  snapshot: TimelineItem[];
}

export default function NotesTab({
  url,
  deleteGraceMs = 5000,
  onCaptureFrame,
}: NotesTabProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const pendingRef = useRef<PendingDelete | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Composer state
  const [draft, setDraft] = useState("");
  const [useTimestamp, setUseTimestamp] = useState(true);
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrameMeta | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => getPlayerSnapshot().time);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const listEndRef = useRef<HTMLDivElement | null>(null);

  const voice = useVoiceComment({
    kind: "add",
    enabled: true,
  });

  // Track player time live for the timestamp chip
  useEffect(() => {
    const unsubscribe = subscribePlayerState(() => {
      setCurrentTime(getPlayerSnapshot().time);
    });
    return () => unsubscribe();
  }, []);

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
        .catch(() => {
          /* tauri event API unavailable (e.g. mocked test env) */
        });
    } catch {
      /* tauri event API unavailable (e.g. mocked test env) */
    }
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [queryClient, urlHash]);

  useEffect(
    () => () => {
      // Leaving the panel with an un-undone delete: commit it.
      if (timerRef.current) clearTimeout(timerRef.current);
      const candidate = pendingRef.current;
      if (candidate && urlHash) {
        void deleteVideoItem({ urlHash, itemId: candidate.item.id }).catch(
          () => {
            /* offline-safe: next reconcile re-surfaces the item */
          },
        );
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
    } catch {
      /* offline-safe: next reconcile re-surfaces the item */
    }
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

  const handleMicToggle = async () => {
    if (voice.recording) {
      try {
        const text = await voice.stop();
        if (text) {
          setDraft((prev) => (prev ? `${prev} ${text}` : text));
        }
      } catch {
        toast("Voice transcription failed");
      }
    } else {
      try {
        await voice.start();
      } catch {
        toast("Microphone unavailable");
      }
    }
  };

  const handleCapture = async () => {
    if (!onCaptureFrame) return;
    try {
      const frame = await onCaptureFrame();
      if (frame) {
        setCapturedFrame(frame);
      }
    } catch {
      toast("Frame capture failed");
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text && !capturedFrame) return;
    if (!urlHash) return;

    setSubmitting(true);
    try {
      const videoTime = useTimestamp ? currentTime : 0;
      const note = text ? `${text}<!--timestamp:${Date.now()}-->` : "";
      const itemId = genVideoItemId();

      const newItem: TimelineItem = {
        id: itemId,
        kind: capturedFrame ? "frame" : "note",
        videoTime,
        notes: note ? [note] : [],
        updatedAt: Date.now(),
        frame: capturedFrame ? { w: capturedFrame.w, h: capturedFrame.h } : undefined,
      };

      await invokeCommand("save_video_item", { urlHash, item: newItem });
      await queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
      setDraft("");
      setCapturedFrame(null);
      listEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } catch {
      toast("Couldn't save note");
    } finally {
      setSubmitting(false);
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      {/* Scrollable Notes Stream */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {items.length === 0 ? (
          <div className="my-auto flex flex-col items-center gap-1 rounded-lg border border-dashed border-hairline px-6 py-12 text-center">
            <p className="text-sm font-medium text-text">No notes yet.</p>
            <p className="text-xs text-text-3">
              Capture a frame or add a note while watching — they'll show up here
              in video order.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <NoteCard key={item.id} item={item} onDelete={startDelete} onEdit={handleEdit} />
          ))
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

      {/* Sleek Pinned Composer at Bottom */}
      <div className="shrink-0 border-t border-hairline bg-surface/90 backdrop-blur-md p-2.5">
        {/* Frame preview if captured */}
        {capturedFrame && (
          <div className="mb-2 relative inline-flex items-center gap-2 rounded-lg border border-hairline bg-elevated p-1.5">
            <img
              src={convertFileSrc(capturedFrame.path)}
              alt="Captured frame"
              onClick={() => {
                navigate("/frame", {
                  state: {
                    urlHash,
                    url,
                    tmpPath: capturedFrame.path,
                    w: capturedFrame.w,
                    h: capturedFrame.h,
                    videoTime: currentTime,
                  },
                });
              }}
              className="h-12 w-20 object-cover rounded cursor-pointer border border-hairline hover:opacity-90"
              title="Tap to draw over frame"
            />
            <div className="text-xs text-text-2">
              <span className="font-mono">{formatVideoTime(currentTime)}</span>
              <p className="text-[11px] text-text-3">Tap image to draw</p>
            </div>
            <button
              type="button"
              onClick={() => setCapturedFrame(null)}
              className="ml-2 flex h-5 w-5 items-center justify-center rounded-full text-text-3 hover:bg-surface hover:text-text"
              title="Discard frame"
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Voice recording progress status */}
        {voice.recording && (
          <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-[color:var(--sc-danger)]">
            <span className="h-2 w-2 rounded-full bg-[color:var(--sc-danger)] animate-ping" />
            <span>Recording voice note ({formatElapsedMs(voice.elapsedMs)})</span>
          </div>
        )}

        {/* Composer Row */}
        <div className="sc-note-terminal flex items-end gap-1.5 rounded-xl border border-hairline bg-base/80 p-1.5 transition-colors focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/30">
          <div className="mb-1 shrink-0">
            <button
              type="button"
              onClick={() => setUseTimestamp((v) => !v)}
              title={useTimestamp ? "Timestamp enabled (tap to disable)" : "Timestamp disabled (tap to enable)"}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] tabular-nums font-medium transition-colors ${
                useTimestamp
                  ? "bg-accent/20 text-accent border border-accent/40"
                  : "bg-elevated text-text-3 border border-hairline opacity-60"
              }`}
            >
              <Clock size={11} strokeWidth={2} />
              {useTimestamp ? formatVideoTime(currentTime) : "None"}
            </button>
          </div>

          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Write or speak a note…"
            rows={1}
            className="min-h-[36px] max-h-24 min-w-0 flex-1 resize-none bg-transparent py-1.5 px-1 text-text outline-none placeholder:text-text-3"
          />

          <div className="flex items-center gap-1 mb-0.5 shrink-0">
            {onCaptureFrame && (
              <button
                type="button"
                title="Capture frame snapshot"
                onClick={() => void handleCapture()}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-elevated hover:text-text active:scale-95"
              >
                <Camera size={18} strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              title="Toggle keyboard"
              onClick={() => textareaRef.current?.focus()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-text-2 transition-colors hover:bg-elevated hover:text-text active:scale-95"
            >
              <Keyboard size={18} strokeWidth={2} />
            </button>
            <button
              type="button"
              title={voice.disabledReason ?? (voice.recording ? "Stop recording" : "Record voice note")}
              onClick={() => void handleMicToggle()}
              disabled={voice.state === "transcribing" || Boolean(voice.disabledReason)}
              className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-all active:scale-95 ${
                voice.recording
                  ? "bg-[color:var(--sc-danger)] text-white animate-pulse"
                  : voice.disabledReason
                    ? "text-text-3 opacity-40 cursor-not-allowed"
                    : "text-text-2 hover:bg-elevated hover:text-text"
              }`}
            >
              {voice.state === "transcribing" ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              ) : voice.recording ? (
                <MicOff size={18} strokeWidth={2} />
              ) : (
                <Mic size={18} strokeWidth={2} />
              )}
            </button>
            <button
              type="button"
              title="Save note"
              onClick={() => void handleSend()}
              disabled={submitting || (!draft.trim() && !capturedFrame)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-[var(--sc-accent-text)] shadow-sm shadow-accent/20 transition-all hover:opacity-90 active:scale-95 disabled:opacity-30 disabled:shadow-none"
            >
              <Send size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
