/*
 * Reader thread panel (task 31): every annotation on the page as a card,
 * WhatsApp-style reply composer pinned to the panel bottom for the active
 * thread only.
 *
 * State and mutations live in useThreadModel (shared with the margin
 * column); this component is the panel render over that model. Data comes
 * from the same TanStack Query cache task-29 fills (`["highlights",
 * urlHash]` — comments ride on each stored highlight as marker strings).
 */

import { useEffect, useRef } from "react";
import type { HighlightColor } from "../components/SwatchPopup";
import ThreadCard, { COLOR_TOKENS } from "./ThreadCard";
import ReplyComposer from "./ReplyComposer";
import { useThreadModel } from "./useThreadModel";

export interface ThreadSelectRequest {
  /** Highlight id clicked in the article. */
  id: string;
  /** Bumped by the caller so repeated clicks on one id re-trigger. */
  nonce: number;
}

interface ThreadPanelProps {
  urlHash: string;
  selectRequest?: ThreadSelectRequest | null;
  /** Hide the "Annotations N" header — the mobile bottom sheet already
   * carries title + count + close in its own single-line handle bar. */
  showHeader?: boolean;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export default function ThreadPanel({ urlHash, selectRequest, showHeader = true }: ThreadPanelProps) {
  const model = useThreadModel(urlHash, selectRequest);
  const {
    entries,
    activeKey,
    activeEntry,
    activate,
    replyRef,
    replyDraft,
    sending,
    tagState,
    matches,
    undoState,
    confirmUndo,
    handleRecolor,
    handleDeleteThread,
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
  } = model;

  const listRef = useRef<HTMLDivElement | null>(null);

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

  if (urlHash === "") return null;

  return (
    <div
      data-testid="thread-panel"
      className="flex h-full min-h-0 flex-col bg-base"
    >
      {showHeader ? (
        <header className="flex shrink-0 items-center justify-between px-3 py-2.5">
          <h2 className="text-sm font-medium text-text">Annotations</h2>
          <span className="font-mono text-[11px] tabular-nums text-text-3">
            {entries.length}
          </span>
        </header>
      ) : null}

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
              onClick={confirmUndo}
              className="cursor-pointer rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-surface"
            >
              Undo
            </button>
          </div>
        ) : null}

        {activeEntry ? (
          <ReplyComposer
            draft={replyDraft}
            sending={sending}
            matches={matches}
            tagActiveIndex={tagState?.activeIndex ?? 0}
            textareaRef={replyRef}
            context={
              <div
                className="mb-2 flex items-start gap-2 rounded-md border-l-2 bg-surface px-2 py-1.5"
                style={{
                  borderColor:
                    COLOR_TOKENS[
                      (activeEntry.members[0].color ?? "yellow") as HighlightColor
                    ],
                }}
              >
                <p className="line-clamp-1 text-[11px] leading-snug text-text-2">
                  {activeEntry.members[0].content}
                </p>
              </div>
            }
            onDraftChange={handleDraftChange}
            onKeyDown={handleReplyKeyDown}
            onSend={sendReply}
            onBold={() => surroundSelection("**", "**")}
            onItalic={() => surroundSelection("*", "*")}
            onLink={insertLink}
            onBullet={prefixBullet}
            onPickTag={pickTag}
            onHoverTagIndex={hoverTagIndex}
          />
        ) : null}
      </div>
    </div>
  );
}
