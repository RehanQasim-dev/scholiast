import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CommentEditorSheet, {
  type AttachableVideoItem,
} from "../components/CommentEditorSheet";
import SwatchPopup, { type HighlightColor } from "../components/SwatchPopup";
import TimestampChip from "../components/TimestampChip";
import {
  deleteVideoItem,
  getVideoItems,
  invokeCommand,
  upsertVideo,
  type VideoItem,
} from "../lib/ipc";
import { parseNoteMarkdown, renderNoteNodes } from "../lib/noteMarkdown";
import {
  useTranscript,
  type TranscriptCue,
  type TranscriptParagraph,
} from "../lib/useTranscript";
import { getPlayerSnapshot, playerBridge, usePlayerSnapshot } from "./playerBridge";

const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Same id scheme as CommentEditorSheet / crates/core gen_video_id. */
function genTranscriptItemId(): string {
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

function colorToken(color: string): string {
  if (color === "red") return "var(--sc-hl-red)";
  if (color === "green") return "var(--sc-hl-green)";
  return "var(--sc-hl-yellow)";
}

/** Char offset of `node`/`offset` within `el`'s text content, else -1. */
function textOffsetWithin(el: HTMLElement, node: Node, offset: number): number {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let total = 0;
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current === node) return total + offset;
    total += current.textContent?.length ?? 0;
  }
  return -1;
}

/**
 * Paragraph-text offsets → cue-relative anchor. Cue i occupies
 * `[cum, cum + len)` in paragraph text where cues are joined by single
 * spaces (crates/core cue.rs build_paragraph).
 */
export function anchorFromOffsets(
  paragraph: TranscriptParagraph,
  cues: TranscriptCue[],
  startOff: number,
  endOff: number,
): NonNullable<VideoItem["anchor"]> | null {
  const [firstCue, lastCue] = paragraph.cueRange;
  let cum = 0;
  let startCue = firstCue;
  let startOffset = 0;
  let endCue = lastCue;
  let endOffset = 0;
  let startSet = false;
  let endSet = false;
  for (let i = firstCue; i <= lastCue && i < cues.length; i += 1) {
    const len = cues[i]?.text.length ?? 0;
    if (!startSet && startOff <= cum + len) {
      startCue = i;
      startOffset = Math.max(0, startOff - cum);
      startSet = true;
    }
    if (!endSet && endOff <= cum + len) {
      endCue = i;
      endOffset = Math.max(0, Math.min(len, endOff - cum));
      endSet = true;
    }
    cum += len + 1;
  }
  if (!startSet || !endSet) return null;
  return { startCue, startOffset, endCue, endOffset };
}

/** Inverse of {@link anchorFromOffsets}: anchor → [start, end) in paragraph text. */
export function offsetsFromAnchor(
  paragraph: TranscriptParagraph,
  cues: TranscriptCue[],
  anchor: NonNullable<VideoItem["anchor"]>,
): [number, number] | null {
  const [first, last] = paragraph.cueRange;
  if (anchor.startCue < first || anchor.endCue > last) return null;
  const spans: { start: number; len: number }[] = [];
  let cum = 0;
  for (let i = first; i <= last && i < cues.length; i += 1) {
    const len = cues[i]?.text.length ?? 0;
    spans.push({ start: cum, len });
    cum += len + 1;
  }
  const s = spans[anchor.startCue - first];
  const e = spans[anchor.endCue - first];
  if (!s || !e) return null;
  const start = s.start + Math.max(0, Math.min(s.len, anchor.startOffset));
  const end = e.start + Math.max(0, Math.min(e.len, anchor.endOffset));
  return end > start ? [start, end] : null;
}

interface HighlightSegment {
  text: string;
  item?: VideoItem;
}

/** Merge a paragraph's highlight ranges into renderable segments. */
export function segmentParagraph(
  paragraph: TranscriptParagraph,
  cues: TranscriptCue[],
  items: VideoItem[],
): HighlightSegment[] {
  const ranges: { start: number; end: number; item: VideoItem }[] = [];
  for (const item of items) {
    if (!item.anchor) continue;
    const range = offsetsFromAnchor(paragraph, cues, item.anchor);
    if (range) ranges.push({ start: range[0], end: range[1], item });
  }
  ranges.sort((a, b) => a.start - b.start);
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start < cursor) continue;
    if (r.start > cursor)
      segments.push({ text: paragraph.text.slice(cursor, r.start) });
    segments.push({ text: paragraph.text.slice(r.start, r.end), item: r.item });
    cursor = r.end;
  }
  if (cursor < paragraph.text.length)
    segments.push({ text: paragraph.text.slice(cursor) });
  return segments;
}

interface SwatchState {
  top: number;
  left: number;
  paraIndex: number;
  startOff: number;
  endOff: number;
}

interface ThreadPopover {
  item: AttachableVideoItem;
  top: number;
  left: number;
}

interface TranscriptPanelProps {
  url: string;
  videoId: string | null;
}

export default function TranscriptPanel({ url, videoId }: TranscriptPanelProps) {
  const queryClient = useQueryClient();
  const { time } = usePlayerSnapshot();
  const transcript = useTranscript(videoId);

  const videoQuery = useQuery({
    queryKey: ["video", url],
    queryFn: () => upsertVideo({ url }),
    enabled: Boolean(url),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const urlHash = videoQuery.data?.urlHash;

  const itemsQuery = useQuery({
    queryKey: ["videoItems", urlHash],
    queryFn: async () => getVideoItems({ urlHash: urlHash! }),
    enabled: Boolean(urlHash),
  });

  const highlights = useMemo(
    () =>
      (itemsQuery.data ?? []).filter(
        (item) => item.kind === "transcript" && item.anchor,
      ),
    [itemsQuery.data],
  );

  // --- search -----------------------------------------------------------------
  const [searchText, setSearchText] = useState("");
  const needle = searchText.trim().toLowerCase();
  const filteredIndexes = useMemo(() => {
    const paragraphs = transcript.data?.paragraphs;
    if (!paragraphs) return [];
    if (!needle) return paragraphs.map((_, i) => i);
    return paragraphs
      .map((p, i) => (p.text.toLowerCase().includes(needle) ? i : -1))
      .filter((i) => i >= 0);
  }, [needle, transcript.data]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const paraRefs = useRef<(HTMLDivElement | null)[]>([]);

  // --- active cue / karaoke -----------------------------------------------------
  const activeParaIndex = useMemo(() => {
    const cues = transcript.data?.cues;
    if (!cues || cues.length === 0) return -1;
    for (let i = 0; i < cues.length; i += 1) {
      const cue = cues[i];
      if (cue && time >= cue.start && time < cue.end) {
        const paragraphs = transcript.data?.paragraphs ?? [];
        return paragraphs.findIndex(
          (p) => i >= p.cueRange[0] && i <= p.cueRange[1],
        );
      }
    }
    return -1;
  }, [time, transcript.data]);

  // Smooth-follow ONLY when the active cue moves into a different paragraph:
  // keep it ~30% from the top of the scroll container via manual math.
  const lastFollowedParaRef = useRef(-1);
  useEffect(() => {
    if (activeParaIndex < 0) return;
    if (lastFollowedParaRef.current === activeParaIndex) return;
    lastFollowedParaRef.current = activeParaIndex;
    const raf = requestAnimationFrame(() => {
      const container = scrollRef.current;
      const el = paraRefs.current[activeParaIndex];
      if (!container || !el) return;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const target = Math.max(
        0,
        container.scrollTop +
          (eRect.top - cRect.top) -
          container.clientHeight * 0.3,
      );
      const reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      container.scrollTo({
        top: target,
        behavior: reduced ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeParaIndex]);

  // --- selection → swatch ---------------------------------------------------------
  const [swatch, setSwatch] = useState<SwatchState | null>(null);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const startContainer = range.startContainer;
    const startEl =
      startContainer.nodeType === Node.TEXT_NODE
        ? startContainer.parentElement
        : (startContainer as HTMLElement);
    const paraEl = startEl?.closest("[data-para-index]");
    if (!(paraEl instanceof HTMLElement)) return;
    // Offsets must be measured against the paragraph TEXT only — the seek pill
    // lives in the same card and would otherwise shift every offset.
    const textEl =
      paraEl.querySelector<HTMLElement>("[data-para-text]") ?? paraEl;
    const paraIndex = Number(paraEl.dataset.paraIndex);
    const paragraph = transcript.data?.paragraphs[paraIndex];
    if (!paragraph) return;

    const startOff = textOffsetWithin(textEl, startContainer, range.startOffset);
    let endOff = paragraph.text.length;
    if (
      range.endContainer === startContainer ||
      textEl.contains(range.endContainer)
    ) {
      endOff = textOffsetWithin(textEl, range.endContainer, range.endOffset);
    }
    if (startOff < 0 || endOff < 0 || endOff <= startOff) return;

    const rect = range.getBoundingClientRect();
    setSwatch({
      top: rect.top - 6,
      left: rect.left + rect.width / 2,
      paraIndex,
      startOff,
      endOff,
    });
  }, [transcript.data]);

  const clearSelectionUi = useCallback(() => {
    setSwatch(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const buildHighlightItem = useCallback(
    (color: HighlightColor): VideoItem | null => {
      if (!swatch || !transcript.data) return null;
      const paragraph = transcript.data.paragraphs[swatch.paraIndex];
      if (!paragraph) return null;
      const anchor = anchorFromOffsets(
        paragraph,
        transcript.data.cues,
        swatch.startOff,
        swatch.endOff,
      );
      if (!anchor) return null;
      const quote = paragraph.text.slice(swatch.startOff, swatch.endOff).trim();
      const firstCue = transcript.data.cues[anchor.startCue];
      const lastCue = transcript.data.cues[anchor.endCue];
      if (!firstCue || !lastCue || !quote) return null;
      return {
        id: genTranscriptItemId(),
        kind: "transcript",
        videoTime: firstCue.start,
        notes: [],
        updatedAt: Date.now(),
        timeEnd: lastCue.end,
        quote,
        color,
        anchor,
      };
    },
    [swatch, transcript.data],
  );

  const saveHighlight = useCallback(
    async (color: HighlightColor): Promise<VideoItem | null> => {
      const item = buildHighlightItem(color);
      clearSelectionUi();
      if (!item || !urlHash) return null;
      try {
        await invokeCommand("save_video_item", { urlHash, item });
        await queryClient.invalidateQueries({
          queryKey: ["videoItems", urlHash],
        });
        return item;
      } catch {
        return null;
      }
    },
    [buildHighlightItem, clearSelectionUi, queryClient, urlHash],
  );

  // --- thread popover + comment sheet -----------------------------------------------
  const [thread, setThread] = useState<ThreadPopover | null>(null);
  const [sheetItem, setSheetItem] = useState<AttachableVideoItem | null>(null);

  useEffect(() => {
    if (!thread) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setThread(null);
    };
    const onMouseDown = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-testid="transcript-thread"]')) {
        setThread(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [thread]);

  const removeHighlight = useCallback(
    async (itemId: string) => {
      setThread(null);
      if (!urlHash) return;
      try {
        await deleteVideoItem({ urlHash, itemId });
      } catch {
        /* offline-safe: next reconcile re-surfaces the item */
      }
      void queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
    },
    [queryClient, urlHash],
  );

  // --- render -----------------------------------------------------------------------
  if (!url || videoQuery.isError) {
    return (
      <p className="p-4 text-sm text-text-2">Couldn't load the transcript.</p>
    );
  }

  if (!videoId) {
    return (
      <p className="p-4 text-sm text-text-2">
        Transcripts need a YouTube video URL.
      </p>
    );
  }

  if (transcript.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    );
  }

  if (transcript.errorKind === "no-captions") {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
        <p className="text-sm font-medium text-text">
          No captions for this video.
        </p>
        <p className="text-xs text-text-3">
          YouTube doesn't provide a caption track to annotate.
        </p>
      </div>
    );
  }

  if (transcript.errorKind === "other" || !transcript.data) {
    return (
      <p className="p-4 text-sm text-text-2">
        Couldn't load the transcript
        {transcript.errorMessage ? `: ${transcript.errorMessage}` : ""}.
      </p>
    );
  }

  const { data } = transcript;
  const visibleParagraphs = filteredIndexes
    .map((i) => data.paragraphs[i])
    .filter((p): p is TranscriptParagraph => Boolean(p));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const index = filteredIndexes[0];
            if (index === undefined) return;
            const paragraph = data.paragraphs[index];
            if (!paragraph) return;
            playerBridge.commands.seekTo(paragraph.start);
            playerBridge.commands.pause();
          }}
          placeholder="Search transcript…"
          aria-label="Search transcript"
          data-testid="transcript-search"
          className="min-w-0 flex-1 rounded-md border border-hairline bg-surface px-2 py-1 text-sm text-text outline-none placeholder:text-text-3 focus:border-[color:var(--sc-accent)]"
        />
        <span
          className="shrink-0 rounded-sm bg-elevated px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-text-3"
          title="Caption language"
        >
          {data.lang}
        </span>
      </div>

      <div
        ref={scrollRef}
        data-testid="transcript-scroll"
        onMouseUp={handleMouseUp}
        className="min-h-0 flex-1 overflow-y-auto p-3"
      >
        {visibleParagraphs.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-text-3">
            No transcript lines match “{searchText}”.
          </p>
        ) : (
          visibleParagraphs.map((paragraph) => {
            const isActive = paragraph.index === activeParaIndex;
            const segments = segmentParagraph(paragraph, data.cues, highlights);
            return (
              <div
                key={paragraph.index}
                ref={(el) => {
                  paraRefs.current[paragraph.index] = el;
                }}
                data-para-index={paragraph.index}
                data-active={isActive ? "true" : "false"}
                className={`flex gap-2 rounded-lg px-2 py-2 transition-colors duration-[var(--sc-dur-slow)] ease-out ${
                  isActive ? "bg-elevated" : ""
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  <TimestampChip seconds={paragraph.start} />
                </div>
                <p
                  data-para-text=""
                  className={`min-w-0 flex-1 text-sm leading-relaxed transition-colors duration-[var(--sc-dur-slow)] ease-out ${
                    isActive
                      ? "font-semibold text-white"
                      : "text-[color:var(--sc-text-2)]"
                  }`}
                >
                  {segments.map((seg, segIndex) =>
                    seg.item ? (
                      <mark
                        key={segIndex}
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setThread({
                            item: seg.item as AttachableVideoItem,
                            top: rect.bottom + 6,
                            left: Math.min(
                              rect.left,
                              window.innerWidth - 336,
                            ),
                          });
                        }}
                        style={
                          {
                            "--hl": colorToken(seg.item.color ?? "yellow"),
                          } as CSSProperties
                        }
                        data-item-id={seg.item.id}
                        title={`Highlighted ${seg.item.videoTime.toFixed(0)}s`}
                        className="cursor-pointer rounded-[3px] bg-[color-mix(in_srgb,var(--hl)_32%,transparent)] text-inherit transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-[color-mix(in_srgb,var(--hl)_50%,transparent)]"
                      >
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={segIndex}>{seg.text}</span>
                    ),
                  )}
                </p>
              </div>
            );
          })
        )}
      </div>

      {swatch && (
        <SwatchPopup
          anchor={{ top: swatch.top, left: swatch.left }}
          onPickColor={(color) => void saveHighlight(color)}
          onComment={() => {
            void saveHighlight("yellow").then((item) => {
              if (item) setSheetItem(item as AttachableVideoItem);
            });
          }}
          onClose={clearSelectionUi}
        />
      )}

      {thread && (
        <div
          data-testid="transcript-thread"
          className="fixed z-40 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-hairline bg-elevated p-3 shadow-xl"
          style={{ top: thread.top, left: thread.left }}
        >
          {thread.item.quote != null && thread.item.quote !== "" && (
            <blockquote className="mb-2 border-l-2 border-hairline pl-2 text-xs italic text-text-2">
              {String(thread.item.quote)}
            </blockquote>
          )}
          <div className="flex flex-col gap-2">
            {(thread.item.notes ?? []).length === 0 ? (
              <p className="text-xs text-text-3">No comments yet.</p>
            ) : (
              (thread.item.notes ?? []).map((note, noteIndex) => (
                <p
                  key={noteIndex}
                  className="text-sm leading-relaxed text-text [&>span]:text-inherit"
                >
                  {renderNoteNodes(parseNoteMarkdown(note))}
                </p>
              ))
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setSheetItem(thread.item)}
              className="rounded-md bg-[color:var(--sc-accent)] px-2 py-1 text-xs font-medium text-white hover:opacity-90"
            >
              Reply
            </button>
            <button
              type="button"
              onClick={() => void removeHighlight(String(thread.item.id))}
              className="rounded-md border border-hairline px-2 py-1 text-xs text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-[color:var(--sc-danger)]"
            >
              Delete highlight
            </button>
          </div>
        </div>
      )}

      <CommentEditorSheet
        open={Boolean(sheetItem)}
        target={
          urlHash ? { urlHash, currentTime: getPlayerSnapshot().time } : null
        }
        attachTo={sheetItem}
        onClose={() => setSheetItem(null)}
      />
    </div>
  );
}
