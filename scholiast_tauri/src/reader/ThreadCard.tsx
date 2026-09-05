/*
 * One annotation card in the reader thread panel (task 31).
 *
 * A card covers a whole *annotation*: either a single stored highlight or a
 * group of them (a multi-block selection shares `groupId`, extension
 * semantics). The quote header carries the highlight color as a left rail +
 * tinted background and is clamped to a single small line; the comment
 * thread renders below only while the card is the panel's active thread.
 *
 * Comment bodies are stored marker strings (`body<!--timestamp:N-->`), parsed
 * and rendered by the shared note-markdown module — the same renderer every
 * other surface uses (plan §6.9 "no second implementation"). Timestamp ids are
 * stable sync keys: edit re-saves with the SAME id plus a fresh
 * `<!--edited:M-->` marker; they are never displayed.
 */

import { useState } from "react";
import type { HighlightColor } from "../components/SwatchPopup";
import type { HighlightView } from "../lib/readerIpc";
import {
  parseNoteMarkdown,
  renderNoteNodes,
  stripHiddenIds,
} from "../lib/noteMarkdown";

export interface ThreadCommentView {
  /** Stored highlight that owns this note (reply target for edits/deletes). */
  highlightId: string;
  /** Digits of the `<!--timestamp:N-->` marker — the stable sync id. */
  id: string;
  /** Full marker string exactly as stored; preserved byte-for-byte on undo. */
  note: string;
  createdAt: number;
  editedAt: number | null;
}

export const COLOR_TOKENS: Record<HighlightColor, string> = {
  yellow: "var(--sc-hl-yellow, #d29600)",
  red: "var(--sc-hl-red, #dc3c5a)",
  green: "var(--sc-hl-green, #2da05f)",
};

export const COLOR_BG_TOKENS: Record<HighlightColor, string> = {
  yellow: "var(--sc-hl-yellow-tint, rgba(210, 150, 0, 0.09))",
  red: "var(--sc-hl-red-tint, rgba(220, 60, 90, 0.07))",
  green: "var(--sc-hl-green-tint, rgba(45, 160, 95, 0.09))",
};

const COLORS: HighlightColor[] = ["yellow", "red", "green"];

/**
 * Creation time from useHighlights' `${Date.now().toString(36)}-seq` ids —
 * "when the annotation was made", matching dashboard ordering semantics
 * (updatedAt would jump cards around on every comment edit).
 */
export function createdTs(h: HighlightView): number {
  const decoded = Number.parseInt(h.id.split("-")[0] ?? "", 36);
  return Number.isFinite(decoded) ? decoded : (h.updatedAt ?? 0);
}

/** Extracts the hidden ids from a stored note without touching its text. */
function noteIds(note: string): { id: string | null; editedAt: number | null } {
  let id: string | null = null;
  let editedAt: number | null = null;
  for (const node of parseNoteMarkdown(note)) {
    if (node.kind === "timestamp-id") id = node.value;
    else if (node.kind === "edited-id") editedAt = Number(node.value);
  }
  return { id, editedAt };
}

/** Flattens a group's notes into ordered comments keyed by owner highlight. */
export function parseThreadComments(members: HighlightView[]): ThreadCommentView[] {
  const out: ThreadCommentView[] = [];
  for (const member of members) {
    for (const note of member.notes ?? []) {
      const { id, editedAt } = noteIds(note);
      // Rust only persists parsed comments, so a missing id cannot happen in
      // practice; an unparsable marker would have no stable key to act on.
      if (!id) continue;
      const created = Number(id);
      out.push({
        highlightId: member.id,
        id,
        note,
        createdAt: Number.isFinite(created) ? created : 0,
        editedAt,
      });
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

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

interface ThreadCardProps {
  members: HighlightView[];
  active: boolean;
  comments: ThreadCommentView[];
  onSelect: () => void;
  onRecolor: (color: HighlightColor) => void;
  onDelete: () => void;
  onEditComment: (comment: ThreadCommentView, body: string) => void;
  onDeleteComment: (comment: ThreadCommentView) => void;
}

export default function ThreadCard({
  members,
  active,
  comments,
  onSelect,
  onRecolor,
  onDelete,
  onEditComment,
  onDeleteComment,
}: ThreadCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const representative = members[0];
  const color = (representative.color ?? "yellow") as HighlightColor;
  const token = COLOR_TOKENS[color];

  const startEdit = (comment: ThreadCommentView) => {
    setEditingId(comment.id);
    setEditDraft(stripHiddenIds(comment.note));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft("");
  };

  return (
    <section
      data-testid={`thread-card-${representative.id}`}
      data-active={active || undefined}
      className="sc-note-terminal overflow-hidden rounded-md border bg-surface transition-colors duration-[var(--sc-dur-fast)] ease-out"
      style={{ borderColor: active ? token : "var(--sc-hairline)" }}
    >
      <div className="group/header relative">
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={active}
          data-testid="thread-quote"
          className="block w-full cursor-pointer border-0 border-l-4 px-2.5 py-1.5 text-left"
          style={{
            borderLeftColor: token,
            backgroundColor: COLOR_BG_TOKENS[color] || "rgba(255, 255, 255, 0.06)",
          }}
        >
          <p className="line-clamp-1 break-words text-[13px] leading-snug" style={{ color: "var(--sc-note-text)" }}>
            {representative.content}
          </p>
          <p className="mt-1 flex items-center gap-2 font-mono text-[11px] tabular-nums text-text-3">
            <span>{relativeTime(createdTs(representative))}</span>
            <span>
              {comments.length === 1 ? "1 reply" : `${comments.length} replies`}
            </span>
          </p>
        </button>
        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-[var(--sc-dur-fast)] ease-out focus-within:opacity-100 group-hover/header:opacity-100">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={`${c[0].toUpperCase()}${c.slice(1)} highlight`}
              aria-label={`Recolor ${c}`}
              disabled={c === color}
              onClick={() => onRecolor(c)}
              className="h-4 w-4 cursor-pointer rounded-full border border-black/40 transition-transform duration-[var(--sc-dur-fast)] ease-out hover:scale-110 disabled:cursor-default disabled:opacity-40"
              style={{ backgroundColor: COLOR_TOKENS[c] }}
            />
          ))}
          <button
            type="button"
            title="Delete annotation"
            aria-label="Delete annotation"
            data-testid="delete-thread"
            onClick={onDelete}
            className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-xs text-text-3 hover:bg-elevated hover:text-[color:var(--sc-danger)]"
          >
            ✕
          </button>
        </div>
      </div>

      {active ? (
        <div className="border-t border-hairline" data-testid="thread-comments">
          {comments.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-3">No replies yet.</p>
          ) : (
            <ul>
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className="group/comment border-b border-hairline px-2.5 py-1.5 last:border-b-0"
                >
                  {editingId === comment.id ? (
                    <div>
                      <textarea
                        autoFocus
                        rows={3}
                        value={editDraft}
                        aria-label="Edit comment"
                        onChange={(e) => setEditDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                            e.preventDefault();
                            const body = editDraft.trim();
                            if (!body) return;
                            onEditComment(comment, body);
                            cancelEdit();
                            return;
                          }
                          if (e.key === "Escape") {
                            e.preventDefault();
                            cancelEdit();
                          }
                        }}
                        className="w-full resize-y rounded-md border border-hairline bg-base px-2 py-1.5 leading-relaxed text-text outline-none focus:border-accent"
                      />
                      <div className="mt-1 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="cursor-pointer rounded px-2 py-1 text-xs text-text-2 hover:text-text"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          data-testid="save-comment-edit"
                          onClick={() => {
                            const body = editDraft.trim();
                            if (!body) return;
                            onEditComment(comment, body);
                            cancelEdit();
                          }}
                          className="cursor-pointer rounded bg-accent px-2 py-1 text-xs font-medium text-[var(--sc-accent-text)] hover:opacity-90"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="leading-relaxed" style={{ color: "var(--sc-note-text)" }}>
                        {renderNoteNodes(parseNoteMarkdown(comment.note))}
                      </div>
                      <div className="mt-1 flex items-center gap-2 font-mono text-[11px] tabular-nums text-text-3">
                        <span>{relativeTime(comment.createdAt)}</span>
                        <span className="ml-auto flex gap-1 opacity-0 transition-opacity duration-[var(--sc-dur-fast)] ease-out focus-within:opacity-100 group-hover/comment:opacity-100">
                          <button
                            type="button"
                            aria-label="Edit comment"
                            data-testid={`edit-comment-${comment.id}`}
                            onClick={() => startEdit(comment)}
                            className="cursor-pointer rounded px-1 hover:text-text"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            aria-label="Delete comment"
                            data-testid={`delete-comment-${comment.id}`}
                            onClick={() => onDeleteComment(comment)}
                            className="cursor-pointer rounded px-1 hover:text-[color:var(--sc-danger)]"
                          >
                            Delete
                          </button>
                        </span>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
