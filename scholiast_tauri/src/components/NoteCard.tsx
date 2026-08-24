import { parseNoteMarkdown, renderNoteNodes } from "../lib/noteMarkdown";
import type { VideoItem } from "../lib/ipc";
import TimestampChip from "./TimestampChip";

export type TimelineItem = VideoItem & { ocrText?: string };

const KIND_ICONS: Record<VideoItem["kind"], string> = {
  frame: "🎞",
  note: "📝",
  transcript: "🖍",
};

export function colorRail(color?: string | null): string {
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
}

export function FrameThumb({ frame }: { frame: NonNullable<VideoItem["frame"]> }) {
  return (
    <div
      data-testid="frame-thumb"
      className="flex aspect-video w-full items-center justify-center rounded-md border border-hairline bg-elevated text-xs tabular-nums text-text-3"
    >
      {frame.w}×{frame.h}
    </div>
  );
}

export default function NoteCard({ item, onDelete }: NoteCardProps) {
  const primary = item.ocrText ?? item.quote ?? "";
  const body = item.notes[0];

  return (
    <article className="relative flex gap-3 rounded-lg border border-hairline bg-surface p-3">
      <span
        aria-hidden
        data-testid="color-rail"
        className="absolute inset-y-2 left-0 w-[3px] rounded-full"
        style={{ background: colorRail(item.color) }}
      />
      <div className="min-w-0 flex-1 pl-1">
        <div className="flex items-center gap-2">
          <span aria-hidden>{KIND_ICONS[item.kind]}</span>
          <TimestampChip seconds={item.videoTime} secondsEnd={item.timeEnd} />
          {onDelete && (
            <button
              type="button"
              aria-label="Delete note"
              onClick={() => onDelete(item)}
              className="ml-auto rounded px-1.5 py-0.5 text-xs text-text-3 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-[color:var(--sc-danger)]"
            >
              Delete
            </button>
          )}
        </div>
        {item.frame && (
          <div className="mt-2">
            <FrameThumb frame={item.frame} />
          </div>
        )}
        {!primary && !body && !item.frame && (
          <p className="mt-2 text-sm text-text-3">Empty note.</p>
        )}
        {primary && (
          <p className="mt-2 line-clamp-2 text-sm text-text">{primary}</p>
        )}
        {body && (
          <div className="mt-1.5 line-clamp-2 text-sm text-text-2">
            {renderNoteNodes(parseNoteMarkdown(body))}
          </div>
        )}
      </div>
    </article>
  );
}
