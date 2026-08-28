import { useCallback, useRef, useState } from "react";
import { Trash2, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { parseNoteMarkdown, renderNoteNodes, stripHiddenIds } from "../lib/noteMarkdown";
import type { VideoItem } from "../lib/ipc";
import TimestampChip from "./TimestampChip";
import { invokeCommand } from "../lib/ipc";

export type TimelineItem = VideoItem & { ocrText?: string; drmBlocked?: boolean };


function colorRail(color?: string | null): string {
  switch (color) {
    case "yellow":
      return "var(--sc-hl-yellow)";
    case "red":
      return "var(--sc-hl-red)";
    case "green":
      return "var(--sc-hl-green)";
    default:
      return "#FFFFFF22";
  }
}

interface NoteCardProps {
  item: TimelineItem;
  onDelete?: (item: TimelineItem) => void;
  onEdit?: (item: TimelineItem, body: string) => void;
}

function FrameThumb({
  frame,
  drmBlocked,
  onClick,
}: {
  frame?: NonNullable<VideoItem["frame"]>;
  drmBlocked?: boolean;
  onClick?: () => void;
}) {
  if (drmBlocked || !frame) {
    return (
      <div
        data-testid="frame-thumb"
        className="flex h-8 w-12 shrink-0 items-center justify-center rounded-md border border-hairline bg-elevated"
      >
        <Play size={14} strokeWidth={2} className="text-text-3" />
      </div>
    );
  }
  if (frame.dataUrl) {
    return (
      <img
        data-testid="frame-thumb"
        src={frame.dataUrl}
        alt="Frame thumbnail"
        onClick={onClick}
        className={`h-8 w-12 shrink-0 rounded-md border border-hairline object-cover ${
          onClick ? "cursor-pointer transition-opacity hover:opacity-80 active:scale-95" : ""
        }`}
        style={{ width: 48, height: 32 }}
        title={onClick ? "Tap to draw / edit frame" : undefined}
      />
    );
  }
  return (
    <div
      data-testid="frame-thumb"
      onClick={onClick}
      className={`flex h-8 w-12 shrink-0 items-center justify-center rounded-md border border-hairline bg-elevated text-[10px] tabular-nums text-text-3 ${
        onClick ? "cursor-pointer transition-opacity hover:opacity-80 active:scale-95" : ""
      }`}
      style={{ width: 48, height: 32 }}
      title={onClick ? "Tap to draw / edit frame" : undefined}
    >
      {frame.w}×{frame.h}
    </div>
  );
}

export default function NoteCard({ item, onDelete, onEdit }: NoteCardProps) {
  const navigate = useNavigate();
  const primary = item.ocrText ?? item.quote ?? "";
  const body = item.notes[0];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => (body ? stripHiddenIds(body) : primary));
  const [saving, setSaving] = useState(false);
  const [offsetX, setOffsetX] = useState(0);
  const startXRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  const handleSave = useCallback(async () => {
    const text = draft.trim();
    if (!text) {
      setEditing(false);
      return;
    }
    if (onEdit) {
      setSaving(true);
      try {
        await Promise.resolve(onEdit(item, text));
      } finally {
        setSaving(false);
        setEditing(false);
      }
      return;
    }
    try {
      const note = `${text}<!--timestamp:${Date.now()}-->`;
      const nextNotes = body ? item.notes.map((n, i) => (i === 0 ? note : n)) : [note];
      await invokeCommand("save_video_item", {
        urlHash: (item as unknown as { urlHash?: string }).urlHash ?? "",
        item: { ...item, notes: nextNotes },
      });
      setEditing(false);
    } catch {
      setSaving(false);
    }
  }, [draft, body, item, onEdit]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (editing) return;
    startXRef.current = e.clientX;
    draggingRef.current = false;
  }, [editing]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startXRef.current === null || editing) return;
    const dx = e.clientX - startXRef.current;
    if (Math.abs(dx) > 6) draggingRef.current = true;
    if (dx < 0) setOffsetX(Math.max(dx, -96));
    else setOffsetX(0);
  }, [editing]);

  const onPointerUp = useCallback(() => {
    if (startXRef.current === null) return;
    if (offsetX < -48 && onDelete) {
      onDelete(item);
    }
    startXRef.current = null;
    draggingRef.current = false;
    setOffsetX(0);
  }, [offsetX, onDelete, item]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (editing) return;
    startXRef.current = e.touches[0]!.clientX;
  }, [editing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startXRef.current === null || editing) return;
    const dx = e.touches[0]!.clientX - startXRef.current;
    if (dx < 0) setOffsetX(Math.max(dx, -96));
  }, [editing]);

  const onTouchEnd = useCallback(() => {
    if (startXRef.current === null) return;
    if (offsetX < -48 && onDelete) onDelete(item);
    startXRef.current = null;
    setOffsetX(0);
  }, [offsetX, onDelete, item]);

  return (
    <div className="relative overflow-hidden rounded-lg border border-hairline bg-surface">
      <div className="absolute inset-y-0 right-0 flex w-24 items-center justify-end bg-[#EF4444] px-3">
        <Trash2 size={20} strokeWidth={2} className="text-white" aria-hidden />
      </div>
      <article
        className="sc-note-terminal relative flex gap-3 bg-surface p-3 transition-transform duration-150 ease-out"
        style={{ transform: `translateX(${offsetX}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <span
          aria-hidden
          data-testid="color-rail"
          className="absolute inset-y-2 left-0 w-[3px] rounded-full"
          style={{ background: colorRail(item.color) }}
        />
        <div className="min-w-0 flex-1 pl-1.5">
          <div className="flex items-center gap-2">
            <TimestampChip seconds={item.videoTime} secondsEnd={item.timeEnd} />
            {item.frame || item.drmBlocked ? (
              <FrameThumb
                frame={item.frame}
                drmBlocked={item.drmBlocked}
                onClick={
                  item.kind === "frame"
                    ? () => navigate("/frame", { state: { itemId: item.id } })
                    : undefined
                }
              />
            ) : null}
            {item.drmBlocked ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium text-text-2">
                <Play size={10} strokeWidth={2} /> Play
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1">
              {!editing && onDelete && (
                <button
                  type="button"
                  aria-label="Delete note"
                  onClick={() => onDelete(item)}
                  className="flex h-7 w-7 items-center justify-center rounded text-text-3 opacity-60 transition-all hover:bg-elevated hover:text-[color:var(--sc-danger)] hover:opacity-100"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              )}
            </span>
          </div>

          {!editing ? (
            <button
              type="button"
              onClick={() => {
                if (draggingRef.current) return;
                if (onEdit || body !== undefined) {
                  setDraft(body ? stripHiddenIds(body) : primary);
                  setEditing(true);
                }
              }}
              className="mt-1.5 w-full text-left"
            >
              {item.drmBlocked && !primary && !body ? (
                <span className="text-sm text-text-3">Protected segment — tap timestamp to seek.</span>
              ) : null}
              {primary && (
                <p className="line-clamp-3 break-words text-text" style={{ color: "var(--sc-note-text)" }}>{primary}</p>
              )}
              {body && stripHiddenIds(body).trim() ? (
                <div className="mt-1 line-clamp-3 break-words text-text-2" style={{ color: "var(--sc-note-text)" }}>
                  {renderNoteNodes(parseNoteMarkdown(body))}
                </div>
              ) : !primary && !item.frame && !item.drmBlocked ? (
                <p className="mt-1 text-xs italic text-text-3">Add text or tap to edit…</p>
              ) : null}
            </button>
          ) : (
            <div className="mt-2 sc-note-terminal">
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                className="w-full resize-none rounded-md border border-accent bg-base px-2.5 py-1.5 text-text outline-none"
                placeholder="Edit note…"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="h-8 rounded-md border border-hairline px-3 text-xs font-medium text-text-2 hover:bg-elevated hover:text-text"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !draft.trim()}
                  className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-[var(--sc-accent-text)] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}
