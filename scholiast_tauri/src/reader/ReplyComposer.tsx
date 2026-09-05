/*
 * Inline reply composer shared by the reader annotation surfaces
 * (specs/tauri-margin-comments, task 01).
 *
 * Presentational extraction of ThreadPanel's bottom composer: same textarea,
 * formatting row, send button and tag autocomplete. Rendered at the panel
 * bottom and inside the expanded margin card.
 */

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import TagAutocomplete, { type TagMatch } from "../components/TagAutocomplete";

export interface ReplyComposerProps {
  draft: string;
  sending: boolean;
  matches: TagMatch[];
  tagActiveIndex: number;
  textareaRef?: { current: HTMLTextAreaElement | null };
  /** Quote-context strip above the box (panel only; margin cards show it). */
  context?: ReactNode;
  onDraftChange: (value: string, caret: number) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onBold: () => void;
  onItalic: () => void;
  onLink: () => void;
  onBullet: () => void;
  onPickTag: (tag: string) => void;
  onHoverTagIndex: (index: number) => void;
}

export default function ReplyComposer({
  draft,
  sending,
  matches,
  tagActiveIndex,
  textareaRef,
  context,
  onDraftChange,
  onKeyDown,
  onSend,
  onBold,
  onItalic,
  onLink,
  onBullet,
  onPickTag,
  onHoverTagIndex,
}: ReplyComposerProps) {
  const formatButtons = [
    { label: "B", title: "Bold (**text**)", className: "font-bold", action: onBold },
    { label: "I", title: "Italic (*text*)", className: "italic", action: onItalic },
    { label: "Link", title: "Link ([text](url))", className: "underline", action: onLink },
    { label: "• List", title: "Bullet list (- item)", className: "", action: onBullet },
  ];

  return (
    <div data-testid="reply-composer">
      {context}
      <textarea
        ref={textareaRef}
        rows={1}
        value={draft}
        disabled={sending}
        aria-label="Reply"
        placeholder="Reply… **bold** · *italic* · #tag"
        onChange={(e) => {
          onDraftChange(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) =>
          onDraftChange(e.currentTarget.value, e.currentTarget.selectionStart)
        }
        onKeyDown={onKeyDown}
        className="w-full resize-y rounded-md border border-hairline bg-surface px-2 py-1 text-sm leading-snug text-text outline-none placeholder:text-text-3 focus:border-accent"
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
          disabled={sending || !draft.trim()}
          onClick={onSend}
          className="cursor-pointer rounded-md bg-accent px-3 py-1 text-xs font-medium text-[var(--sc-accent-text)] transition-opacity duration-[var(--sc-dur-fast)] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Saving…" : "Reply"}
        </button>
        <TagAutocomplete
          matches={matches}
          activeIndex={tagActiveIndex}
          onPick={onPickTag}
          onHoverIndex={onHoverTagIndex}
        />
      </div>
    </div>
  );
}
