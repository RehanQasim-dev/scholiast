/*
 * Quoteless margin thread card (extension parity).
 *
 * Unlike ThreadCard (panel/sheet: quote header + recolor + bottom composer),
 * a margin card sits beside its source line, so the quote is redundant — the
 * card is the reply thread only. Per-reply behavior mirrors the extension's
 * comment box (`src/utils/comment-overlays.ts`):
 * - replies clamp to 3 lines with a fade; tap expands, tap-away collapses;
 * - each reply carries its own timestamp + sync dot; desktop shows icon
 *   edit/delete buttons, plus a thread trash on the first reply when 2+;
 * - tablet hides the icon buttons: swipe-right deletes one reply,
 *   double-tap edits it.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { HighlightColor } from "../components/SwatchPopup";
import {
  parseNoteMarkdown,
  renderNoteNodes,
  stripHiddenIds,
} from "../lib/noteMarkdown";
import { COLOR_TOKENS, type ThreadCommentView } from "./ThreadCard";
import type { ThreadEntry } from "./useThreadModel";
import "./margin-thread-card.css";

const COLLAPSE_DELAY_MS = 200;
const DOUBLE_TAP_MS = 320;
const SWIPE_DELETE_PX = 64;

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

interface MarginThreadCardProps {
  entry: ThreadEntry;
  active: boolean;
  /** Engine's last successful sync stamp; null while unknown. */
  lastSyncedAt: number | null;
  /** Last local write through the thread model; null when clean. */
  lastMutationAt: number | null;
  isTablet: boolean;
  onSelect: () => void;
  onClearThread: () => void;
  onEditComment: (comment: ThreadCommentView, body: string) => void;
  onDeleteComment: (comment: ThreadCommentView) => void;
}

export default function MarginThreadCard({
  entry,
  active,
  lastSyncedAt,
  lastMutationAt,
  isTablet,
  onSelect,
  onClearThread,
  onEditComment,
  onDeleteComment,
}: MarginThreadCardProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const collapseTimers = useRef(new Map<string, number>());
  const lastTap = useRef<{ id: string; time: number } | null>(null);
  const editingRef = useRef<string | null>(null);
  editingRef.current = editingId;

  const representative = entry.members[0];
  const color = (representative.color ?? "yellow") as HighlightColor;
  const token = COLOR_TOKENS[color];
  const comments = entry.comments;

  // Leaving the card collapses every reply and drops the edit draft —
  // extension parity (click-away collapses + hides the reply field).
  useEffect(() => {
    if (!active) {
      for (const timer of collapseTimers.current.values()) {
        window.clearTimeout(timer);
      }
      collapseTimers.current.clear();
      setExpandedIds(new Set());
      setEditingId(null);
      setEditDraft("");
    }
  }, [active ]);

  useEffect(
    () => () => {
      for (const timer of collapseTimers.current.values()) {
        window.clearTimeout(timer);
      }
    },
    [],
  );

  const cancelCollapse = (id: string) => {
    const timer = collapseTimers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      collapseTimers.current.delete(id);
    }
  };

  const startEdit = (comment: ThreadCommentView) => {
    cancelCollapse(comment.id);
    setExpandedIds((prev) => new Set(prev).add(comment.id));
    setEditingId(comment.id);
    setEditDraft(stripHiddenIds(comment.note));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  const expand = (comment: ThreadCommentView) => {
    cancelCollapse(comment.id);
    setExpandedIds((prev) => new Set(prev).add(comment.id));
  };

  const armCollapse = (comment: ThreadCommentView) => {
    cancelCollapse(comment.id);
    const timer = window.setTimeout(() => {
      collapseTimers.current.delete(comment.id);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(comment.id);
        return next;
      });
    }, COLLAPSE_DELAY_MS);
    collapseTimers.current.set(comment.id, timer);
  };

  // Tap toggles; a second tap inside the window edits instead of collapsing
  // (the pending collapse is cancelled — same resolution as the extension's
  // click/double-click dance, which touch never fires reliably).
  const handleTap = (comment: ThreadCommentView) => {
    if (editingRef.current) return;
    const expanded = expandedIds.has(comment.id);
    const now = Date.now();
    if (
      expanded &&
      lastTap.current?.id === comment.id &&
      now - lastTap.current.time < DOUBLE_TAP_MS
    ) {
      lastTap.current = null;
      startEdit(comment);
      return;
    }
    lastTap.current = { id: comment.id, time: now };
    if (expanded) armCollapse(comment);
    else expand(comment);
  };

  return (
    <section
      data-testid={`margin-thread-card-${representative.id}`}
      data-active={active || undefined}
      onClick={onSelect}
      className="sc-note-terminal overflow-hidden rounded-md border border-l-4 bg-surface transition-colors duration-[var(--sc-dur-fast)] ease-out"
      style={{ borderColor: "var(--sc-hairline)", borderLeftColor: token }}
    >
      {comments.length === 0 ? (
        <p className="px-3 py-2 text-xs text-text-3">No replies yet.</p>
      ) : (
        <ul>
          {comments.map((comment, index) => (
            <ReplyRow
              key={comment.id}
              comment={comment}
              index={index}
              threadLength={comments.length}
              expanded={expandedIds.has(comment.id)}
              editing={editingId === comment.id}
              editDraft={editDraft}
              isTablet={isTablet}
              lastSyncedAt={lastSyncedAt}
              lastMutationAt={lastMutationAt}
              onTap={() => handleTap(comment)}
              onDoubleEdit={() => {
                if (!editingRef.current) startEdit(comment);
              }}
              onClearThread={onClearThread}
              onDelete={() => onDeleteComment(comment)}
              onEditDraftChange={setEditDraft}
              onCancelEdit={cancelEdit}
              onSaveEdit={() => {
                const body = editDraft.trim();
                if (!body) return;
                onEditComment(comment, body);
                cancelEdit();
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ReplyRowProps {
  comment: ThreadCommentView;
  index: number;
  threadLength: number;
  expanded: boolean;
  editing: boolean;
  editDraft: string;
  isTablet: boolean;
  lastSyncedAt: number | null;
  lastMutationAt: number | null;
  onTap: () => void;
  onDoubleEdit: () => void;
  onClearThread: () => void;
  onDelete: () => void;
  onEditDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
}

function ReplyRow({
  comment,
  index,
  threadLength,
  expanded,
  editing,
  editDraft,
  isTablet,
  lastSyncedAt,
  lastMutationAt,
  onTap,
  onDoubleEdit,
  onClearThread,
  onDelete,
  onEditDraftChange,
  onCancelEdit,
  onSaveEdit,
}: ReplyRowProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLLIElement | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [overflows, setOverflows] = useState(false);

  // A reply only clamps when its text actually exceeds 3 lines.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [comment.note, expanded ]);

  // Pending while the page is dirty or the reply postdates the last sync.
  const synced =
    lastSyncedAt !== null &&
    comment.createdAt <= lastSyncedAt &&
    (lastMutationAt === null || lastMutationAt <= lastSyncedAt);

  if (editing) {
    return (
      <li
        ref={rowRef}
        className="border-b border-hairline px-2.5 py-1.5 last:border-b-0"
        onClick={(e) => e.stopPropagation()}
      >
        <textarea
          autoFocus
          rows={3}
          value={editDraft}
          aria-label="Edit comment"
          onChange={(e) => onEditDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              onSaveEdit();
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancelEdit();
            }
          }}
          className="w-full resize-y rounded-md border border-hairline bg-base px-2 py-1.5 leading-relaxed text-text outline-none focus:border-accent"
        />
        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelEdit}
            className="cursor-pointer rounded px-2 py-1 text-xs text-text-2 hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="save-margin-comment-edit"
            onClick={onSaveEdit}
            className="cursor-pointer rounded bg-accent px-2 py-1 text-xs font-medium text-[var(--sc-accent-text)] hover:opacity-90"
          >
            Save
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      ref={rowRef}
      data-testid={`margin-reply-${comment.id}`}
      className="mtc-reply-row group/comment border-b border-hairline px-2.5 py-1.5 last:border-b-0"
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleEdit();
      }}
      onTouchStart={(e) => {
        const touch = e.touches[0];
        if (touch) touchStart.current = { x: touch.clientX, y: touch.clientY };
      }}
      onTouchMove={(e) => {
        if (!isTablet || !touchStart.current || !rowRef.current) return;
        const touch = e.touches[0];
        if (!touch) return;
        const dx = touch.clientX - touchStart.current.x;
        const dy = touch.clientY - touchStart.current.y;
        // Horizontal intent only; vertical pans stay with the article scroll.
        if (dx > 0 && dx > Math.abs(dy) * 1.5) {
          rowRef.current.style.transform = `translateX(${Math.min(dx, 96)}px)`;
        }
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (rowRef.current) rowRef.current.style.transform = "";
        if (!isTablet || !start) return;
        const touch = e.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        // Swipe-right deletes just this reply; the model arms an undo toast.
        if (dx >= SWIPE_DELETE_PX && Math.abs(dy) < 40) {
          e.stopPropagation();
          onDelete();
        }
      }}
    >
      <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-text-3">
        <span>{relativeTime(comment.createdAt)}</span>
        <span
          data-testid={`margin-sync-${comment.id}`}
          data-synced={synced || undefined}
          title={synced ? "Synced" : "Waiting to sync"}
          aria-label={synced ? "Synced" : "Not synced"}
          className={`ml-auto inline-block h-1.5 w-1.5 rounded-full ${synced ? "bg-[color:#6fcf97]" : "bg-text-3 opacity-40"}`}
        />
        {!isTablet ? (
          <span className="flex gap-1 opacity-0 transition-opacity duration-[var(--sc-dur-fast)] ease-out focus-within:opacity-100 group-hover/comment:opacity-100">
            <button
              type="button"
              aria-label="Edit comment"
              data-testid={`margin-edit-comment-${comment.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onDoubleEdit();
              }}
              className="cursor-pointer rounded px-1 hover:text-text"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            </button>
            <button
              type="button"
              aria-label="Delete comment"
              data-testid={`margin-delete-comment-${comment.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="cursor-pointer rounded px-1 hover:text-[color:var(--sc-danger)]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
            {index === 0 && threadLength > 1 ? (
              <button
                type="button"
                aria-label="Delete comment thread"
                title="Delete comment thread"
                data-testid="margin-thread-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearThread();
                }}
                className="cursor-pointer rounded border-l border-hairline px-1 pl-2 hover:text-[color:var(--sc-danger)]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            ) : null}
          </span>
        ) : index === 0 && threadLength > 1 ? (
          <button
            type="button"
            aria-label="Delete comment thread"
            title="Delete comment thread"
            data-testid="margin-thread-delete"
            onClick={(e) => {
              e.stopPropagation();
              onClearThread();
            }}
            className="cursor-pointer rounded px-1 text-text-3 hover:text-[color:var(--sc-danger)]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
          </button>
        ) : null}
      </div>
      <div
        ref={bodyRef}
        className={`mtc-reply-body leading-relaxed ${!expanded && overflows ? "mtc-clamped mtc-overflows" : ""}`}
        style={{ color: "var(--sc-note-text)" }}
      >
        {renderNoteNodes(parseNoteMarkdown(comment.note))}
      </div>
    </li>
  );
}
