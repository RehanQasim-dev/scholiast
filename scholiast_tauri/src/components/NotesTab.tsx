import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { deleteVideoItem, getVideoItems, upsertVideo, invokeCommand } from "../lib/ipc";
import NoteCard, { type TimelineItem } from "./NoteCard";

export function orderItems(items: TimelineItem[]): TimelineItem[] {
  return [...items].sort((a, b) => {
    if (a.videoTime !== b.videoTime) return a.videoTime - b.videoTime;
    return (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
  });
}

interface NotesTabProps {
  url: string;
  deleteGraceMs?: number;
}

interface PendingDelete {
  item: TimelineItem;
  snapshot: TimelineItem[];
}

export default function NotesTab({ url, deleteGraceMs = 5000 }: NotesTabProps) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const pendingRef = useRef<PendingDelete | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoQuery = useQuery({
    queryKey: ["video", url],
    queryFn: () => upsertVideo({ url }),
    enabled: Boolean(url),
    staleTime: Infinity,
  });
  const urlHash = videoQuery.data?.urlHash;

  const itemsQuery = useQuery({
    queryKey: ["videoItems", urlHash],
    queryFn: async () => orderItems(await getVideoItems({ urlHash: urlHash! })),
    enabled: Boolean(urlHash),
  });

  useEffect(() => {
    if (!urlHash) return;
    let dispose: (() => void) | undefined;
    let cancelled = false;
    try {
      void listen("db://changed:video_items", () => {
        void queryClient.invalidateQueries({
          queryKey: ["videoItems", urlHash],
        });
      })
        .then((fn) => {
          if (cancelled) fn();
          else dispose = fn;
        })
        .catch(() => {
          /* tauri event API unavailable (e.g. mocked test env) */
        });
    } catch {
      /* tauri event API unavailable (e.g. mocked test env) */
    }
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [queryClient, urlHash]);

  useEffect(
    () => () => {
      // Leaving the panel with an un-undone delete: commit it.
      if (timerRef.current) clearTimeout(timerRef.current);
      const candidate = pendingRef.current;
      if (candidate && urlHash) {
        void deleteVideoItem({ urlHash, itemId: candidate.item.id }).catch(
          () => {
            /* offline-safe: next reconcile re-surfaces the item */
          },
        );
      }
    },
    [urlHash],
  );

  const finalize = async (candidate: PendingDelete) => {
    if (pendingRef.current === candidate) {
      pendingRef.current = null;
      setPending(null);
    }
    try {
      await deleteVideoItem({ urlHash: urlHash!, itemId: candidate.item.id });
    } catch {
      /* offline-safe: next reconcile re-surfaces the item */
    }
    void queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
  };

  const startDelete = (item: TimelineItem) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const snapshot = [...(itemsQuery.data ?? [])];
    const filtered = snapshot.filter((i) => i.id !== item.id);
    queryClient.setQueryData(["videoItems", urlHash], filtered);
    const candidate = { item, snapshot };
    pendingRef.current = candidate;
    setPending(candidate);
    timerRef.current = setTimeout(() => {
      void finalize(candidate);
    }, deleteGraceMs);
  };

  const undoDelete = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const candidate = pendingRef.current;
    if (candidate) {
      pendingRef.current = null;
      setPending(null);
      queryClient.setQueryData(["videoItems", urlHash], candidate.snapshot);
    }
  };

  const handleEdit = async (item: TimelineItem, body: string) => {
    if (!urlHash) return;
    const note = `${body}<!--timestamp:${Date.now()}-->`;
    const nextNotes = item.notes.length > 0 ? item.notes.map((_, i) => (i === 0 ? note : item.notes[i]!)) : [note];
    const updated: TimelineItem = { ...item, notes: nextNotes, updatedAt: Date.now() };
    queryClient.setQueryData<TimelineItem[]>(["videoItems", urlHash], (prev) =>
      prev ? prev.map((i) => (i.id === item.id ? updated : i)) : prev,
    );
    try {
      await invokeCommand("save_video_item", { urlHash, item: updated });
      await queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["videoItems", urlHash] });
    }
  };

  if (!url || videoQuery.isError) {
    return (
      <p className="p-4 text-sm text-text-2">
        Couldn't load this video's notes.
      </p>
    );
  }

  if (videoQuery.isPending || (urlHash && itemsQuery.isPending)) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    );
  }

  if (itemsQuery.isError) {
    return (
      <p className="p-4 text-sm text-text-2">
        Couldn't load notes for this video.
      </p>
    );
  }

  const items = itemsQuery.data ?? [];

  return (
    <div
      className="relative flex min-h-[320px] flex-col gap-2 p-3"
      style={{ paddingBottom: "calc(5.5rem + var(--sc-safe-bottom) + 24px)" }}
    >
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-hairline px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">No notes yet.</p>
          <p className="text-xs text-text-3">
            Capture a frame or add a note while watching — they'll show up here
            in video order.
          </p>
        </div>
      ) : (
        items.map((item) => (
          <NoteCard key={item.id} item={item} onDelete={startDelete} onEdit={handleEdit} />
        ))
      )}
      {pending && (
        <div
          role="status"
          className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t border-hairline bg-elevated px-3 py-2 text-sm text-text"
        >
          <span>Note deleted.</span>
          <button
            type="button"
            onClick={undoDelete}
            className="rounded px-2 py-0.5 font-medium text-accent transition-opacity duration-[var(--sc-dur-fast)] ease-out hover:opacity-80"
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
