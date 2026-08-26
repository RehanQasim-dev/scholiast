import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { BookOpen, Play } from "lucide-react";
import type { VideoSummary } from "../lib/ipc";
import { getVideoItems, listRecentVideos } from "../lib/ipc";

function relativeTime(updatedAtMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - updatedAtMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(updatedAtMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatClock(totalSeconds: number): string {
  const s = Math.floor(totalSeconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Thumb({ videoId }: { videoId: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!videoId || failed) {
    return (
      <div
        data-testid="thumb-fallback"
        className="flex aspect-video w-full items-center justify-center bg-overlay text-text-3"
      >
        <Play size={24} strokeWidth={2} style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties} />
      </div>
    );
  }
  return (
    <img
      src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
      onError={() => setFailed(true)}
      alt=""
      loading="lazy"
      className="h-full w-full object-cover"
    />
  );
}

function Scrub({ resumeAt }: { resumeAt: number }) {
  if (resumeAt <= 0) return null;
  const pct = Math.min(100, Math.max(6, (resumeAt % 600) / 6));
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-md bg-hairline">
      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

function RecentCard({ video }: { video: VideoSummary }) {
  const navigate = useNavigate();
  const hasResume = video.resumeAt > 0;
  const openInPlayer = () => {
    if (!video.videoId) {
      navigate(`/reader?url=${encodeURIComponent(video.url)}&h=${encodeURIComponent(video.urlHash)}`);
      return;
    }
    navigate(
      `/player?url=${encodeURIComponent(video.url)}${hasResume ? `&resume=${Math.floor(video.resumeAt)}` : ""}`,
    );
  };
  const isArticle = !video.videoId;
  const sourceLabel = isArticle ? (() => { try { return new URL(video.url).hostname; } catch { return "Article"; } })() : "YouTube";

  return (
    <button
      type="button"
      onClick={openInPlayer}
      className="relative flex min-h-[84px] w-full flex-col overflow-hidden rounded-md border border-hairline bg-elevated text-left transition-colors hover:border-accent/40 hover:bg-overlay"
    >
      <div className="relative w-full overflow-hidden bg-overlay">
        <div className="aspect-video w-full">
          <Thumb videoId={video.videoId} />
        </div>
        <Scrub resumeAt={video.resumeAt} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-[13px] font-medium leading-tight text-text">
          {video.title ?? video.url}
        </h3>
        <div className="flex items-center gap-1.5 text-xs tabular-nums text-text-2">
          {isArticle ? (
            <BookOpen size={12} strokeWidth={2} className="shrink-0" style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties} />
          ) : (
            <Play size={12} strokeWidth={2} className="shrink-0" style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties} />
          )}
          <span className="truncate">
            {sourceLabel} • <NoteCountInline urlHash={video.urlHash} isArticle={isArticle} /> • {relativeTime(video.updatedAt)}
            {hasResume ? ` • ${formatClock(video.resumeAt)}` : ""}
          </span>
        </div>
      </div>
    </button>
  );
}

function NoteCountInline({ urlHash, isArticle }: { urlHash: string; isArticle: boolean }) {
  const query = useQuery({
    queryKey: ["videoItems", urlHash],
    queryFn: () => getVideoItems({ urlHash }),
    staleTime: 30_000,
  });
  const count = query.data?.length ?? 0;
  if (count === 0) return <>{isArticle ? "0 highlights" : "0 notes"}</>;
  return <>{count} {isArticle ? (count === 1 ? "highlight" : "highlights") : (count === 1 ? "note" : "notes")}</>;
}

export default function RecentGrid() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["videos", "recent"],
    queryFn: listRecentVideos,
  });

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    try {
      void listen("db://changed:videos", () => {
        void queryClient.invalidateQueries({ queryKey: ["videos", "recent"] });
      })
        .then((fn) => {
          if (cancelled) fn();
          else dispose = fn;
        })
        .catch(() => {});
    } catch {
      /* tauri event unavailable in tests */
    }
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [queryClient]);

  if (query.isPending) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[220px] animate-pulse rounded-md bg-elevated" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-md border border-hairline bg-elevated px-6 py-8 text-center text-sm text-text-2">
        Couldn't load recent videos.
      </div>
    );
  }

  const videos = query.data;

  if (!videos || videos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-hairline bg-elevated px-6 py-8 text-center">
        <p className="text-sm font-medium text-text">Paste any link to start taking notes.</p>
        <p className="text-xs text-text-3">Your recent videos will appear here.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {videos.map((video) => (
        <RecentCard key={video.urlHash} video={video} />
      ))}
    </div>
  );
}
