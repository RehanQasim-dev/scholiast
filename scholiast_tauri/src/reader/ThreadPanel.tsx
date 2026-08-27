/*
 * Reader thread panel (task 31): every annotation on the page as a card,
 * WhatsApp-style reply composer pinned to the panel bottom for the active
 * thread only.
 *
 * Data comes from the same TanStack Query cache task-29 fills
 * (`["highlights", urlHash]` — comments ride on each stored highlight as
 * marker strings), so an optimistic patch here repaints the article through
 * the HighlightsLayer's existing effect. Rust owns persistence: every
 * mutation goes through readerIpc and ends in an invalidate.
 *
 * Deletions are optimistic with a snapshot kept in a ref; Undo re-saves the
 * exact payloads (same ids, anchors and marker strings) via save_highlight /
 * save_comment. The editor is a slim inline composer mirroring
 * CommentEditorSheet's markdown subset and formatting buttons — see LOG.md
 * for why the sheet itself is not mounted here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TagAutocomplete, {
  matchTags,
  type TagMatch,
} from "../components/TagAutocomplete";
import type { HighlightColor } from "../components/SwatchPopup";
import { invokeCommand } from "../lib/ipc";
import {
  deleteComment,
  saveComment,
  saveHighlight,
  type HighlightView,
} from "../lib/readerIpc";
import {
  READER_NEXT_ANNOTATION_EVENT,
  type ReaderNextAnnotationDetail,
} from "../lib/useReaderKeyboard";
import ThreadCard, {
  COLOR_TOKENS,
  createdTs,
  parseThreadComments,
  type ThreadCommentView,
} from "./ThreadCard";
import { findHighlightRange } from "./highlightPaint";
import { useHighlights } from "./useHighlights";

export interface ThreadSelectRequest {
  /** Highlight id clicked in the article. */
  id: string;
  /** Bumped by the caller so repeated clicks on one id re-trigger. */
  nonce: number;
}

interface ThreadPanelProps {
  urlHash: string;
  selectRequest?: ThreadSelectRequest | null;
}

interface ThreadEntry {
  /** Group id for grouped selections, else the lone highlight's id. */
  key: string;
  members: HighlightView[];
  comments: ThreadCommentView[];
}

interface UndoState {
  message: string;
  undo: () => void;
}

const UNDO_MS = 5000;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** Scrolls the painted range to the viewport center, briefly retrying while
 * the painter settles (fresh page load, sync pull, just-created highlight). */
function scrollToHighlight(highlightId: string): void {
  let tries = 0;
  const attempt = () => {
    const range = findHighlightRange(highlightId);
    if (range) {
      const node = range.startContainer;
      const el =
        node.nodeType === node.TEXT_NODE
          ? node.parentElement
          : (node as Element | null);
      if (el && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({
          block: "center",
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
      }
      return;
    }
    if (tries < 10) {
      tries += 1;
      window.requestAnimationFrame(attempt);
    }
  };
  attempt();
}

export default function ThreadPanel({ urlHash, selectRequest }: ThreadPanelProps) {
  const qc = useQueryClient();
  const { highlights, recolor, remove } = useHighlights(urlHash);

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [tagState, setTagState] = useState<{
    start: number;
    query: string;
    activeIndex: number;
  } | null>(null);
  const [sending, setSending] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);

  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const undoTimerRef = useRef<number | undefined>(undefined);

  // Mirrors useHighlights' query key so optimistic patches land in the same
  // cache entry the article paints from.
  const HIGHLIGHTS_KEY = useMemo(
    () => ["highlights", urlHash] as const,
    [urlHash],
  );
  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: HIGHLIGHTS_KEY });
  }, [qc, HIGHLIGHTS_KEY]);

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => invokeCommand<string[]>("list_tags"),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: activeKey !== null,
  });

  const entries = useMemo<ThreadEntry[]>(() => {
    const sorted = [...highlights].sort((a, b) => createdTs(b) - createdTs(a));
    const map = new Map<string, HighlightView[]>();
    for (const h of sorted) {
      const key = h.groupId ?? h.id;
      const group = map.get(key);
      if (group) group.push(h);
      else map.set(key, [h]);
    }
    return Array.from(map.entries()).map(([key, members]) => ({
      key,
      members,
      comments: parseThreadComments(members),
    }));
  }, [highlights]);

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const activeEntry =
    entries.find((e) => e.key === activeKey) ?? null;

  const disarmUndo = useCallback(() => {
    window.clearTimeout(undoTimerRef.current);
    setUndoState(null);
  }, []);

  const armUndo = useCallback((message: string, undo: () => void) => {
    window.clearTimeout(undoTimerRef.current);
    setUndoState({ message, undo });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoState(null);
    }, UNDO_MS);
  }, []);

  // A page switch strands pending undos and drafts — never restore them
  // against another page's store.
  useEffect(() => {
    setActiveKey(null);
    setReplyDraft("");
    setTagState(null);
    disarmUndo();
  }, [urlHash, disarmUndo]);

  const patchMemberNotes = useCallback(
    (highlightId: string, fn: (notes: string[]) => string[]) => {
      qc.setQueryData<HighlightView[]>(HIGHLIGHTS_KEY, (old) =>
        old?.map((h) =>
          h.id === highlightId ? { ...h, notes: fn(h.notes ?? []) } : h,
        ),
      );
    },
    [qc, HIGHLIGHTS_KEY],
  );

  const focusReplySoon = useCallback(() => {
    window.requestAnimationFrame(() => replyRef.current?.focus());
  }, []);

  const activate = useCallback(
    (entry: ThreadEntry, scrollTargetId: string) => {
      setActiveKey(entry.key);
      scrollToHighlight(scrollTargetId);
      focusReplySoon();
    },
    [focusReplySoon],
  );

  // j/k contract from the reader keyboard layer: walk the visible list.
  useEffect(() => {
    const onNext = (event: Event) => {
      const { direction } = (
        event as CustomEvent<ReaderNextAnnotationDetail>
      ).detail;
      const list = entriesRef.current;
      if (list.length === 0) return;
      const index = list.findIndex((e) => e.key === activeKeyRef.current);
      const next =
        index === -1
          ? direction === 1
            ? 0
            : list.length - 1
          : (index + direction + list.length) % list.length;
      const entry = list[next];
      activate(entry, entry.members[0].id);
    };
    window.addEventListener(READER_NEXT_ANNOTATION_EVENT, onNext);
    return () =>
      window.removeEventListener(READER_NEXT_ANNOTATION_EVENT, onNext);
  }, [activate]);

  // Clicks on painted highlights arrive from Reader via selectRequest.
  useEffect(() => {
    if (!selectRequest) return;
    const entry = entriesRef.current.find((e) =>
      e.members.some((m) => m.id === selectRequest.id),
    );
    if (!entry) return;
    activate(entry, selectRequest.id);
  }, [selectRequest, activate]);

  // Keep the newly active card visible inside the panel.
  useEffect(() => {
    if (!activeKey) return;
    const card = listRef.current?.querySelector(
      `[data-thread-key="${CSS.escape(activeKey)}"]`,
    );
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [activeKey, entries]);

  const handleRecolor = useCallback(
    (entry: ThreadEntry, color: HighlightColor) => {
      for (const member of entry.members) recolor(member.id, color);
    },
    [recolor],
  );

  const handleDeleteThread = useCallback(
    (entry: ThreadEntry) => {
      const snapshots = entry.members.map((m) => ({ ...m }));
      for (const snapshot of snapshots) remove(snapshot.id);
      const quote = entry.members[0].content ?? "";
      armUndo(`Deleted “${quote.slice(0, 40)}${quote.length > 40 ? "…" : ""}”.`, () => {
        void (async () => {
          for (const snapshot of snapshots) {
            await saveHighlight({ urlHash, highlight: snapshot });
          }
          invalidate();
        })();
      });
      setActiveKey(null);
    },
    [armUndo, invalidate, remove, urlHash],
  );

  const handleEditComment = useCallback(
    (comment: ThreadCommentView, body: string) => {
      // Same timestamp id, fresh edited marker — the pair IS the identity.
      const note = `${body}<!--timestamp:${comment.id}--><!--edited:${Date.now()}-->`;
      patchMemberNotes(comment.highlightId, (notes) =>
        notes.map((n) => (n === comment.note ? note : n)),
      );
      saveComment({ highlightId: comment.highlightId, note })
        .catch(invalidate)
        .finally(invalidate);
    },
    [invalidate, patchMemberNotes],
  );

  const handleDeleteComment = useCallback(
    (entry: ThreadEntry, comment: ThreadCommentView) => {
      const index = entry.comments.findIndex((c) => c.id === comment.id);
      patchMemberNotes(comment.highlightId, (notes) =>
        notes.filter((n) => n !== comment.note),
      );
      deleteComment({ commentId: comment.id })
        .catch(invalidate)
        .finally(invalidate);
      armUndo("Comment deleted.", () => {
        patchMemberNotes(comment.highlightId, (notes) => {
          const next = [...notes];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, comment.note);
          return next;
        });
        saveComment({ highlightId: comment.highlightId, note: comment.note })
          .catch(invalidate)
          .finally(invalidate);
      });
    },
    [armUndo, invalidate, patchMemberNotes],
  );

  const syncTagState = useCallback((value: string, caret: number) => {
    const upto = value.slice(0, caret);
    const m = /(^|\s)#([A-Za-z0-9_-]*)$/.exec(upto);
    setTagState(
      m ? { start: caret - m[2].length - 1, query: m[2], activeIndex: 0 } : null,
    );
  }, []);

  const commitReply = useCallback(
    (next: string, selStart: number, selEnd: number) => {
      setReplyDraft(next);
      window.requestAnimationFrame(() => {
        const ta = replyRef.current;
        ta?.setSelectionRange(selStart, selEnd);
      });
    },
    [],
  );

  // Same four transforms as CommentEditorSheet's formatting buttons.
  const surroundSelection = useCallback(
    (before: string, after: string) => {
      const ta = replyRef.current;
      if (!ta) return;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      const selected = replyDraft.slice(s, e);
      commitReply(
        replyDraft.slice(0, s) + before + selected + after + replyDraft.slice(e),
        s + before.length,
        s + before.length + selected.length,
      );
    },
    [replyDraft, commitReply],
  );

  const insertLink = useCallback(() => {
    const ta = replyRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const selected = replyDraft.slice(s, e);
    if (/^https?:\/\/\S+$/i.test(selected)) {
      const inserted = `[${selected}](${selected})`;
      commitReply(
        replyDraft.slice(0, s) + inserted + replyDraft.slice(e),
        s,
        s + inserted.length,
      );
    } else {
      const inserted = `[${selected || "text"}](url)`;
      commitReply(
        replyDraft.slice(0, s) + inserted + replyDraft.slice(e),
        s + selected.length + 1,
        s + inserted.length - 1,
      );
    }
  }, [replyDraft, commitReply]);

  const prefixBullet = useCallback(() => {
    const ta = replyRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const lineStart = replyDraft.lastIndexOf("\n", s - 1) + 1;
    const lineEnd =
      replyDraft.indexOf("\n", e) === -1
        ? replyDraft.length
        : replyDraft.indexOf("\n", e);
    const bulleted = replyDraft
      .slice(lineStart, lineEnd)
      .split("\n")
      .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
      .join("\n");
    commitReply(
      replyDraft.slice(0, lineStart) + bulleted + replyDraft.slice(lineEnd),
      lineStart,
      lineStart + bulleted.length,
    );
  }, [replyDraft, commitReply]);

  const matches: TagMatch[] = useMemo(
    () =>
      tagState && !sending
        ? matchTags(tagsQuery.data ?? [], tagState.query)
        : [],
    [sending, tagState, tagsQuery.data],
  );

  const pickTag = useCallback(
    (tag: string) => {
      if (!tagState) return;
      const caret = tagState.start + tagState.query.length;
      const next = `${replyDraft.slice(0, tagState.start)}#${tag} ${replyDraft.slice(caret)}`;
      const pos = tagState.start + tag.length + 1;
      setTagState(null);
      commitReply(next, pos, pos);
      focusReplySoon();
    },
    [tagState, replyDraft, commitReply, focusReplySoon],
  );

  const sendReply = useCallback(async () => {
    const entry = activeEntry;
    if (!entry || sending) return;
    const text = replyDraft.trim();
    if (!text) return;
    const representative = entry.members[0];
    const note = `${text}<!--timestamp:${Date.now()}-->`;
    setSending(true);
    patchMemberNotes(representative.id, (notes) => [...notes, note]);
    try {
      await saveComment({ highlightId: representative.id, note });
      setReplyDraft("");
      setTagState(null);
    } finally {
      setSending(false);
      invalidate();
    }
  }, [activeEntry, sending, replyDraft, patchMemberNotes, invalidate]);

  const handleReplyKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void sendReply();
        return;
      }
      if (matches.length > 0 && tagState) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setTagState({
            ...tagState,
            activeIndex: (tagState.activeIndex + 1) % matches.length,
          });
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setTagState({
            ...tagState,
            activeIndex: (tagState.activeIndex - 1 + matches.length) % matches.length,
          });
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          pickTag(matches[tagState.activeIndex].tag);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setTagState(null);
          return;
        }
      }
    },
    [matches, pickTag, sendReply, tagState],
  );

  if (urlHash === "") return null;

  const formatButtons = [
    { label: "B", title: "Bold (**text**)", className: "font-bold", action: () => surroundSelection("**", "**") },
    { label: "I", title: "Italic (*text*)", className: "italic", action: () => surroundSelection("*", "*") },
    { label: "Link", title: "Link ([text](url))", className: "underline", action: insertLink },
    { label: "• List", title: "Bullet list (- item)", className: "", action: prefixBullet },
  ];

  return (
    <div
      data-testid="thread-panel"
      className="flex h-full min-h-0 flex-col bg-base"
    >
      <header className="flex shrink-0 items-center justify-between px-3 py-2.5">
        <h2 className="text-sm font-medium text-text">Annotations</h2>
        <span className="font-mono text-[11px] tabular-nums text-text-3">
          {entries.length}
        </span>
      </header>

      {entries.length === 0 ? (
        <div
          data-testid="threads-empty"
          className="mx-3 rounded-md border border-dashed border-hairline px-4 py-6 text-center"
        >
          <p className="text-sm text-text-2">
            Select text in the article to annotate
          </p>
        </div>
      ) : (
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <div className="flex flex-col gap-2">
            {entries.map((entry) => (
              <div key={entry.key} data-thread-key={entry.key}>
                <ThreadCard
                  members={entry.members}
                  active={entry.key === activeKey}
                  comments={entry.comments}
                  onSelect={() => activate(entry, entry.members[0].id)}
                  onRecolor={(color) => handleRecolor(entry, color)}
                  onDelete={() => handleDeleteThread(entry)}
                  onEditComment={handleEditComment}
                  onDeleteComment={(comment) =>
                    handleDeleteComment(entry, comment)
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 space-y-2 border-t border-hairline p-3">
        {undoState ? (
          <div
            data-testid="undo-bar"
            role="status"
            className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-elevated px-3 py-2"
          >
            <span className="truncate text-xs text-text-2">
              {undoState.message}
            </span>
            <button
              type="button"
              data-testid="undo-button"
              onClick={() => {
                disarmUndo();
                undoState.undo();
              }}
              className="cursor-pointer rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-surface"
            >
              Undo
            </button>
          </div>
        ) : null}

        {activeEntry ? (
          <div data-testid="reply-composer">
            <div
              className="mb-2 flex items-start gap-2 rounded-md border-l-2 bg-surface px-2 py-1.5"
              style={{
                borderColor:
                  COLOR_TOKENS[
                    (activeEntry.members[0].color ?? "yellow") as HighlightColor
                  ],
              }}
            >
              <p className="line-clamp-2 text-xs leading-snug text-text-2">
                {activeEntry.members[0].content}
              </p>
            </div>
            <textarea
              ref={replyRef}
              rows={2}
              value={replyDraft}
              disabled={sending}
              aria-label="Reply"
              placeholder="Reply… **bold** · *italic* · #tag"
              onChange={(e) => {
                setReplyDraft(e.target.value);
                syncTagState(e.target.value, e.target.selectionStart);
              }}
              onClick={(e) =>
                syncTagState(e.currentTarget.value, e.currentTarget.selectionStart)
              }
              onKeyDown={handleReplyKeyDown}
              className="w-full resize-y rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm leading-relaxed text-text outline-none placeholder:text-text-3 focus:border-accent"
            />
            <div className="relative mt-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                {formatButtons.map((btn) => (
                  <button
                    key={btn.title}
                    type="button"
                    title={btn.title}
                    aria-label={btn.title}
                    disabled={sending}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={btn.action}
                    className={`cursor-pointer rounded px-2 py-1 text-xs text-text-2 hover:bg-surface hover:text-text ${btn.className}`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                data-testid="reply-send"
                aria-label="Send reply"
                disabled={sending || !replyDraft.trim()}
                onClick={() => void sendReply()}
                className="cursor-pointer rounded-md bg-accent px-3 py-1 text-xs font-medium text-[var(--sc-accent-text)] transition-opacity duration-[var(--sc-dur-fast)] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? "Saving…" : "Reply"}
              </button>
              <TagAutocomplete
                matches={matches}
                activeIndex={tagState?.activeIndex ?? 0}
                onPick={pickTag}
                onHoverIndex={(index) =>
                  setTagState((prev) =>
                    prev ? { ...prev, activeIndex: index } : prev,
                  )
                }
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
