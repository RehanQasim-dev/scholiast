/*
 * Margin-anchored comment layer (specs/tauri-margin-comments, task 01).
 *
 * Absolutely-positioned cards inside the article's scroll container, so one
 * shared scroll carries article and cards together — no nested scrollbar.
 * Collapsed cards reuse ThreadCard (3-line quote clamp); the active card
 * also mounts the inline ReplyComposer. The near-invisible full-height grab
 * line resizes the column page-wide.
 */

import { useEffect, useRef, useState } from "react";
import ThreadCard from "./ThreadCard";
import ReplyComposer from "./ReplyComposer";
import { clampMarginWidth, layoutMarginColumn, MARGIN_CARD_GAP } from "./marginLayout";
import type { ThreadModel } from "./useThreadModel";

const COLLAPSED_ESTIMATE = 110;

interface MarginColumnProps {
  model: ThreadModel;
  anchors: Map<string, number>;
  width: number;
  defaultWidth: number;
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
}

export default function MarginColumn({
  model,
  anchors,
  width,
  defaultWidth,
  onWidthChange,
  onWidthCommit,
}: MarginColumnProps) {
  const {
    entries,
    activeKey,
    activate,
    deactivate,
    replyRef,
    replyDraft,
    sending,
    tagState,
    matches,
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

  const [heights, setHeights] = useState<Record<string, number>>({});
  const [dragging, setDragging] = useState(false);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef(new Map<string, HTMLDivElement>());
  const dragState = useRef({ width });

  useEffect(() => {
    dragState.current.width = width;
  }, [width ]);

  // Measure rendered card heights so the stacker can avoid overlaps.
  useEffect(() => {
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver((records) => {
      setHeights((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const record of records) {
          const key = (record.target as HTMLElement).dataset.marginMeasure;
          if (!key) continue;
          const height = Math.round(record.contentRect.height);
          if (prev[key] !== height) {
            next[key] = height;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    for (const el of nodesRef.current.values()) observer.observe(el);
    return () => observer.disconnect();
  });

  // Clicking the page (or another card's absence) collapses the open card.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-margin-card],[data-margin-splitter]")) return;
      deactivate();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [deactivate]);

  const placements = layoutMarginColumn(
    entries.map((entry) => ({
      key: entry.key,
      anchorTop: anchors.get(entry.key) ?? Number.POSITIVE_INFINITY,
      height: heights[entry.key] ?? COLLAPSED_ESTIMATE,
    })),
    MARGIN_CARD_GAP,
  );
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));

  const clampLive = (raw: number) =>
    clampMarginWidth(raw, window.innerWidth || 1280);

  return (
    <div
      ref={layerRef}
      data-testid="margin-column"
      className="pointer-events-none absolute inset-y-0 right-0"
      style={{ width }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize comment column"
        aria-valuenow={Math.round(width)}
        data-margin-splitter
        data-testid="margin-splitter"
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* fallback if pointer capture fails */
          }
          dragState.current.width = width;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (!dragging || !layerRef.current) return;
          const rect = layerRef.current.getBoundingClientRect();
          const next = clampLive(rect.right - e.clientX);
          dragState.current.width = next;
          onWidthChange(next);
        }}
        onPointerUp={(e) => {
          if (!dragging) return;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          setDragging(false);
          onWidthCommit(dragState.current.width);
        }}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => {
          onWidthChange(defaultWidth);
          onWidthCommit(defaultWidth);
        }}
        className={`group pointer-events-auto absolute bottom-0 left-0 top-0 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center transition-colors pointer-coarse:w-5 ${
          dragging ? "bg-accent/20" : "hover:bg-accent/15"
        }`}
      >
        <div
          className={`min-h-12 w-px transition-colors ${
            dragging ? "bg-accent" : "bg-hairline group-hover:bg-accent/70"
          }`}
        />
      </div>

      {placements.map((placement) => {
        const entry = byKey.get(placement.key);
        if (!entry) return null;
        const active = entry.key === activeKey;
        return (
          <div
            key={placement.key}
            data-margin-card
            data-testid={`margin-card-${entry.members[0].id}`}
            className="pointer-events-auto absolute left-3 right-1"
            style={{ top: placement.top }}
          >
            <div
              data-margin-measure={placement.key}
              ref={(el) => {
                if (el) nodesRef.current.set(placement.key, el);
                else nodesRef.current.delete(placement.key);
              }}
            >
              <ThreadCard
                members={entry.members}
                active={active}
                comments={entry.comments}
                onSelect={() => {
                  if (active) deactivate();
                  else activate(entry, entry.members[0].id);
                }}
                onRecolor={(color) => handleRecolor(entry, color)}
                onDelete={() => handleDeleteThread(entry)}
                onEditComment={handleEditComment}
                onDeleteComment={(comment) =>
                  handleDeleteComment(entry, comment)
                }
              />
              {active ? (
                <div className="mt-1.5 rounded-md border border-hairline bg-surface p-2">
                  <ReplyComposer
                    draft={replyDraft}
                    sending={sending}
                    matches={matches}
                    tagActiveIndex={tagState?.activeIndex ?? 0}
                    textareaRef={replyRef}
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
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
