import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import KeyboardButton from "./KeyboardButton";
import TagAutocomplete, { matchTags, type TagMatch } from "./TagAutocomplete";
import { toast } from "./Toast";
import useIsNarrow from "../hooks/useIsNarrow";
import { invokeCommand } from "../lib/ipc";
import { playerBridge } from "../player/playerBridge";
import { formatElapsedMs, useVoiceComment } from "../voice/useVoiceComment";

export interface CommentTarget {
  urlHash: string;
  currentTime: number;
}

export interface CommentDraftMeta {
  id: string;
  text: string;
  videoTime: number;
  attachedTo?: string;
}

/** Minimal shape of an existing item a comment can attach to. */
export type AttachableVideoItem = {
  id: string;
  kind: string;
  videoTime: number;
  notes: string[];
  updatedAt?: number | null;
} & Record<string, unknown>;

interface CommentEditorSheetProps {
  open: boolean;
  target: CommentTarget | null;
  onClose: () => void;
  onSave?: (target: CommentTarget, meta: CommentDraftMeta) => void;
  /** When present, saving appends a note to this item instead of creating one. */
  attachTo?: AttachableVideoItem | null;
  /** Gates the mic slot; the sheet runs the record→transcribe→insert flow itself. */
  onVoiceDraft?: (text: string) => void;
}

const TAG_QUERY_RE = /(^|\s)#([A-Za-z0-9_-]*)$/;
const BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Mirrors crates/core normalize.rs `gen_video_id` (no such Tauri command exists):
 * lowercase-base36 unix millis + 5 random base36 chars.
 */
function genVideoItemId(): string {
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

function formatVideoTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function CommentEditorSheet({
  open,
  target,
  onClose,
  onSave,
  attachTo = null,
  onVoiceDraft,
}: CommentEditorSheetProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [tagState, setTagState] = useState<{
    start: number;
    query: string;
    activeIndex: number;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Kept once on cancel/Esc (confirm-discard): reopened prefill, second close discards.
  const keptDraftRef = useRef<string | null>(null);
  const pendingSelectionRef = useRef<[number, number] | null>(null);
  const voice = useVoiceComment({
    kind: "add",
    enabled: Boolean(onVoiceDraft),
  });
  const isNarrow = useIsNarrow();

  const tagsQuery = useQuery({
    queryKey: ["tags"],
    queryFn: () => invokeCommand<string[]>("list_tags"),
    staleTime: Number.POSITIVE_INFINITY,
    enabled: open,
  });

  useEffect(() => {
    if (open) {
      setDraft(keptDraftRef.current ?? "");
      setTagState(null);
      setSaving(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  useLayoutEffect(() => {
    const sel = pendingSelectionRef.current;
    if (sel && textareaRef.current) {
      textareaRef.current.setSelectionRange(sel[0], sel[1]);
      pendingSelectionRef.current = null;
    }
  }, [draft]);

  const matches: TagMatch[] = useMemo(
    () =>
      tagState && !saving
        ? matchTags(tagsQuery.data ?? [], tagState.query)
        : [],
    [saving, tagState, tagsQuery.data],
  );

  const syncTagState = useCallback((value: string, caret: number) => {
    const upto = value.slice(0, caret);
    const m = TAG_QUERY_RE.exec(upto);
    setTagState(
      m ? { start: caret - m[2].length - 1, query: m[2], activeIndex: 0 } : null,
    );
  }, []);

  const commit = useCallback((next: string, selStart: number, selEnd: number) => {
    pendingSelectionRef.current = [selStart, selEnd];
    setDraft(next);
  }, []);

  const surroundSelection = useCallback(
    (before: string, after: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const s = ta.selectionStart;
      const e = ta.selectionEnd;
      const selected = draft.slice(s, e);
      commit(
        draft.slice(0, s) + before + selected + after + draft.slice(e),
        s + before.length,
        s + before.length + selected.length,
      );
    },
    [draft, commit],
  );

  const insertLink = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const selected = draft.slice(s, e);
    if (/^https?:\/\/\S+$/i.test(selected)) {
      const inserted = `[${selected}](${selected})`;
      commit(
        draft.slice(0, s) + inserted + draft.slice(e),
        s,
        s + inserted.length,
      );
    } else {
      const inserted = `[${selected || "text"}](url)`;
      commit(
        draft.slice(0, s) + inserted + draft.slice(e),
        s + selected.length + 1,
        s + inserted.length - 1,
      );
    }
  }, [draft, commit]);

  const prefixBullet = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const lineStart = draft.lastIndexOf("\n", s - 1) + 1;
    const lineEnd = draft.indexOf("\n", e) === -1 ? draft.length : draft.indexOf("\n", e);
    const block = draft.slice(lineStart, lineEnd);
    const bulleted = block
      .split("\n")
      .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
      .join("\n");
    commit(
      draft.slice(0, lineStart) + bulleted + draft.slice(lineEnd),
      lineStart,
      lineStart + bulleted.length,
    );
  }, [draft, commit]);

  const pickTag = useCallback(
    (tag: string) => {
      if (!tagState) return;
      const ta = textareaRef.current;
      const caret = ta ? ta.selectionEnd : tagState.start + tagState.query.length;
      const next = `${draft.slice(0, tagState.start)}#${tag} ${draft.slice(caret)}`;
      const pos = tagState.start + tag.length + 1;
      setTagState(null);
      commit(next, pos, pos);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [tagState, draft, commit],
  );

  const insertVoiceDraft = useCallback(
    (text: string) => {
      const ta = textareaRef.current;
      const start = ta ? ta.selectionStart : draft.length;
      const end = ta ? ta.selectionEnd : start;
      const inserted = draft.slice(0, start) + text + draft.slice(end);
      commit(inserted, start + text.length, start + text.length);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [draft, commit],
  );

  const finishVoice = useCallback(() => {
    voice
      .stop()
      .then((text) => {
        if (!text) return;
        insertVoiceDraft(text);
        onVoiceDraft?.(text);
      })
      .catch((err: unknown) => {
        toast(`Speech failed: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [voice, insertVoiceDraft, onVoiceDraft]);

  const toggleVoice = useCallback(() => {
    if (voice.state === "recording") {
      finishVoice();
    } else if (voice.state === "idle" || voice.state === "error") {
      voice.start().catch(() => toast("Microphone unavailable."));
    }
  }, [voice, finishVoice]);

  const resetAndClose = useCallback(() => {
    keptDraftRef.current = null;
    setDraft("");
    setTagState(null);
    onClose();
  }, [onClose]);

  const requestClose = useCallback(() => {
    if (!draft.trim()) {
      keptDraftRef.current = null;
      setDraft("");
      setTagState(null);
      onClose();
      return;
    }
    if (keptDraftRef.current === null) {
      keptDraftRef.current = draft;
      setDraft("");
      setTagState(null);
      toast("Draft kept. Cancel again to discard it.");
      onClose();
      return;
    }
    resetAndClose();
  }, [draft, onClose, resetAndClose]);

  const save = useCallback(async () => {
    if (!target || saving) return;
    const text = draft.trim();
    if (!text) {
      resetAndClose();
      return;
    }
    setSaving(true);
    const now = Date.now();
    const note = `${text}<!--timestamp:${now}-->`;
    const item = attachTo
      ? {
          ...attachTo,
          notes: [...attachTo.notes, note],
          updatedAt: now,
        }
      : {
          id: genVideoItemId(),
          kind: "note",
          videoTime: target.currentTime,
          notes: [note],
          updatedAt: now,
        };
    try {
      await invokeCommand("save_video_item", {
        urlHash: target.urlHash,
        item,
      });
      await queryClient.invalidateQueries({
        queryKey: ["videoItems", target.urlHash],
      });
      await queryClient.invalidateQueries({ queryKey: ["videos", "recent"] });
      keptDraftRef.current = null;
      onSave?.(target, {
        id: String(item.id),
        text,
        videoTime: target.currentTime,
        attachedTo: attachTo?.id,
      });
      resetAndClose();
    } catch {
      setSaving(false);
      toast("Couldn't save the note.");
    }
  }, [attachTo, draft, onSave, queryClient, resetAndClose, saving, target]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void save();
        return;
      }
      if (e.key === "Escape" && voice.recording) {
        e.preventDefault();
        e.stopPropagation();
        void voice.cancel();
        return;
      }
      if (matches.length > 0 && tagState) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setTagState({ ...tagState, activeIndex: (tagState.activeIndex + 1) % matches.length });
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
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
      }
    },
    [matches, pickTag, requestClose, save, tagState, voice],
  );

  if (!open || !target) return null;

  const formatButtons = [
    { label: "B", title: "Bold (**text**)", className: "font-bold", action: () => surroundSelection("**", "**") },
    { label: "I", title: "Italic (*text*)", className: "italic", action: () => surroundSelection("*", "*") },
    { label: "Link", title: "Link ([text](url))", className: "underline", action: insertLink },
    { label: "• List", title: "Bullet list (- item)", className: "", action: prefixBullet },
  ];

  return (
    <div
      className={`fixed inset-0 z-40 flex bg-black/60 ${
        isNarrow
          ? "flex-col items-stretch justify-end"
          : "items-center justify-center p-4"
      }`}
      data-testid="sheet-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add note"
        className={`flex flex-col gap-3 border border-hairline bg-elevated p-4 shadow-xl ${
          isNarrow
            ? "max-h-[88dvh] w-full overflow-y-auto rounded-t-xl pb-[calc(1rem+var(--sc-safe-bottom))]"
            : "w-[560px] min-h-[240px] rounded-lg"
        }`}
        data-testid="comment-editor-sheet"
      >
        {isNarrow ? (
          <div
            aria-hidden="true"
            className="-mt-1 mx-auto h-1.5 w-10 shrink-0 rounded-full bg-text-3"
          />
        ) : null}
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            syncTagState(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => syncTagState(e.currentTarget.value, e.currentTarget.selectionStart)}
          onKeyDown={handleKeyDown}
          rows={4}
          aria-label="Comment"
          placeholder="Add a note… **bold** · *italic* · #tag"
          disabled={saving}
          className={`w-full resize-y rounded-md border border-hairline bg-surface px-3 text-sm leading-relaxed text-text outline-none placeholder:text-text-3 focus:border-[color:var(--sc-accent)] ${
            isNarrow ? "min-h-[72px] py-3 text-base" : "py-2"
          }`}
        />

        <div className="relative">
          <div className="flex items-center gap-1">
            {formatButtons.map((btn) => (
              <button
                key={btn.title}
                type="button"
                title={btn.title}
                aria-label={btn.title}
                disabled={saving}
                onMouseDown={(e) => e.preventDefault()}
                onClick={btn.action}
                className={`rounded px-2 py-1 text-xs text-text-2 hover:bg-surface hover:text-text disabled:opacity-40 ${
                  isNarrow ? "min-h-[44px] min-w-[44px] px-2.5 py-2" : ""
                } ${btn.className}`}
              >
                {btn.label}
              </button>
            ))}
          </div>
          <TagAutocomplete
            matches={matches}
            activeIndex={tagState?.activeIndex ?? 0}
            onPick={pickTag}
            onHoverIndex={(index) =>
              setTagState((prev) => (prev ? { ...prev, activeIndex: index } : prev))
            }
          />
        </div>

        <div className="mt-auto flex items-center justify-between gap-2">
          <div className="flex items-end gap-3">
            {onVoiceDraft && (
              <div className="flex h-12 items-center gap-2" data-testid="voice-cluster">
                <button
                  type="button"
                  data-testid="voice-mic"
                  onClick={toggleVoice}
                  disabled={saving || voice.state === "transcribing" || Boolean(voice.disabledReason)}
                  title={voice.disabledReason ?? (voice.recording ? "Stop recording" : "Record a note")}
                  aria-label={voice.disabledReason ?? (voice.recording ? "Stop recording" : "Record a note")}
                  aria-pressed={voice.recording}
                  className="relative flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {voice.state === "transcribing" ? (
                    <span
                      aria-hidden="true"
                      className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"
                    />
                  ) : voice.recording ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 animate-ping rounded-full border-2 border-[var(--sc-danger)]"
                      />
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 rounded-sm bg-[var(--sc-danger)]"
                      />
                    </>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="h-[20px] w-[20px]"
                    >
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <path d="M12 19v3" />
                    </svg>
                  )}
                </button>
                {voice.recording && (
                  <span
                    data-testid="voice-elapsed"
                    className="text-xs tabular-nums text-[var(--sc-danger)]"
                  >
                    {formatElapsedMs(voice.elapsedMs)}
                  </span>
                )}
                {voice.state === "transcribing" && (
                  <span data-testid="voice-busy" role="status" className="text-xs text-text-2">
                    Transcribing…
                  </span>
                )}
                {voice.disabledReason && (
                  <span data-testid="voice-hint" role="note" className="text-xs text-text-3">
                    {voice.disabledReason}
                  </span>
                )}
              </div>
            )}
            <KeyboardButton onClick={() => textareaRef.current?.focus()} />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              title={`Seek to ${formatVideoTime(target.currentTime)}`}
              onClick={() => playerBridge.commands.seekTo(target.currentTime)}
              className="rounded-md border border-hairline bg-surface px-2 py-1 font-mono text-xs tabular-nums text-text-2 hover:text-text"
            >
              {formatVideoTime(target.currentTime)}
            </button>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving}
              className={`rounded-md border border-hairline text-sm text-text-2 hover:text-text disabled:opacity-40 ${
                isNarrow ? "min-h-[48px] px-5 py-2.5" : "px-3 py-1.5"
              }`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={`rounded-md bg-[color:var(--sc-accent)] text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 ${
                isNarrow ? "min-h-[48px] px-6 py-2.5" : "px-3 py-1.5"
              }`}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
