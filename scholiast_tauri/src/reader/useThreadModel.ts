/*
 * Shared thread model for the reader annotation surfaces
 * (specs/tauri-margin-comments, task 01).
 *
 * Everything here is lifted verbatim from ThreadPanel: entry grouping,
 * active-thread state, the reply composer state machine, optimistic
 * mutations with undo, and the j/k + select-request effects. ThreadPanel
 * renders its exact previous JSX over this hook; MarginColumn consumes the
 * same model so both surfaces share one mutation implementation (No-Overlap
 * Rule: React holds ephemeral UI state only, Rust owns persistence).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { matchTags, type TagMatch } from "../components/TagAutocomplete";
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
import { createdTs, parseThreadComments, type ThreadCommentView } from "./ThreadCard";
import { findHighlightRange } from "./highlightPaint";
import { useHighlights } from "./useHighlights";
import type { ThreadSelectRequest } from "./ThreadPanel";

export interface ThreadEntry {
  /** Group id for grouped selections, else the lone highlight's id. */
  key: string;
  members: HighlightView[];
  comments: ThreadCommentView[];
}

export interface UndoState {
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

export interface ThreadModel {
  entries: ThreadEntry[];
  activeKey: string | null;
  activeEntry: ThreadEntry | null;
  activate: (entry: ThreadEntry, scrollTargetId: string) => void;
  deactivate: () => void;
  /** Epoch ms of the last local mutation; drives the per-comment sync dots. */
  lastMutationAt: number | null;
  replyRef: { current: HTMLTextAreaElement | null };
  replyDraft: string;
  sending: boolean;
  tagState: { start: number; query: string; activeIndex: number } | null;
  matches: TagMatch[];
  undoState: UndoState | null;
  dismissUndo: () => void;
  confirmUndo: () => void;
  handleRecolor: (entry: ThreadEntry, color: HighlightColor) => void;
  handleDeleteThread: (entry: ThreadEntry) => void;
  handleClearThread: (entry: ThreadEntry) => void;
  handleEditComment: (comment: ThreadCommentView, body: string) => void;
  handleDeleteComment: (entry: ThreadEntry, comment: ThreadCommentView) => void;
  handleDraftChange: (value: string, caret: number) => void;
  handleReplyKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  sendReply: () => void;
  surroundSelection: (before: string, after: string) => void;
  insertLink: () => void;
  prefixBullet: () => void;
  pickTag: (tag: string) => void;
  hoverTagIndex: (index: number) => void;
}

export function useThreadModel(
  urlHash: string,
  selectRequest?: ThreadSelectRequest | null,
): ThreadModel {
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
  // Last local write through this model. Margin cards compare it (with the
  // engine's last-synced stamp) to decide each reply's sync dot: anything
  // written after the last successful sync is still pending.
  const [lastMutationAt, setLastMutationAt] = useState<number | null>(null);

  const replyRef = useRef<HTMLTextAreaElement | null>(null);
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
    setLastMutationAt(null);
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

  const deactivate = useCallback(() => {
    setActiveKey(null);
  }, []);

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

  const handleRecolor = useCallback(
    (entry: ThreadEntry, color: HighlightColor) => {
      setLastMutationAt(Date.now());
      for (const member of entry.members) recolor(member.id, color);
    },
    [recolor],
  );

  const handleDeleteThread = useCallback(
    (entry: ThreadEntry) => {
      setLastMutationAt(Date.now());
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

  // Extension parity (`deleteCommentThread`): drop the whole reply thread but
  // keep the painted highlight. Undo restores the exact marker strings.
  const handleClearThread = useCallback(
    (entry: ThreadEntry) => {
      const snapshots = entry.members.map((m) => ({ ...m }));
      if (!snapshots.some((m) => (m.notes ?? []).length > 0)) return;
      setLastMutationAt(Date.now());
      for (const snapshot of snapshots) {
        patchMemberNotes(snapshot.id, () => []);
        void saveHighlight({ urlHash, highlight: { ...snapshot, notes: [] } })
          .catch(invalidate)
          .finally(invalidate);
      }
      armUndo("Thread cleared.", () => {
        void (async () => {
          for (const snapshot of snapshots) {
            await saveHighlight({ urlHash, highlight: snapshot });
          }
          invalidate();
        })();
      });
    },
    [armUndo, invalidate, patchMemberNotes, urlHash],
  );

  const handleEditComment = useCallback(
    (comment: ThreadCommentView, body: string) => {
      // Same timestamp id, fresh edited marker — the pair IS the identity.
      setLastMutationAt(Date.now());
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
      setLastMutationAt(Date.now());
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

  const handleDraftChange = useCallback(
    (value: string, caret: number) => {
      setReplyDraft(value);
      syncTagState(value, caret);
    },
    [syncTagState],
  );

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

  const hoverTagIndex = useCallback((index: number) => {
    setTagState((prev) => (prev ? { ...prev, activeIndex: index } : prev));
  }, []);

  const sendReply = useCallback(async () => {
    const entry = activeEntry;
    if (!entry || sending) return;
    const text = replyDraft.trim();
    if (!text) return;
    const representative = entry.members[0];
    const note = `${text}<!--timestamp:${Date.now()}-->`;
    setSending(true);
    setLastMutationAt(Date.now());
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

  const undoStateRef = useRef(undoState);
  undoStateRef.current = undoState;
  const confirmUndo = useCallback(() => {
    const current = undoStateRef.current;
    disarmUndo();
    current?.undo();
  }, [disarmUndo]);

  return {
    entries,
    activeKey,
    activeEntry,
    activate,
    deactivate,
    lastMutationAt,
    replyRef,
    replyDraft,
    sending,
    tagState,
    matches,
    undoState,
    dismissUndo: disarmUndo,
    confirmUndo,
    handleRecolor,
    handleDeleteThread,
    handleClearThread,
    handleEditComment,
    handleDeleteComment,
    handleDraftChange,
    handleReplyKeyDown,
    sendReply,
    surroundSelection,
    insertLink,
    prefixBullet,
    pickTag,
    hoverTagIndex,
  };
}
