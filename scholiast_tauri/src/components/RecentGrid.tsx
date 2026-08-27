import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { BookOpen, Play, Globe } from "lucide-react";
import type { VideoSummary } from "../lib/ipc";
import { getVideoItems, listRecentVideos } from "../lib/ipc";
import { listArticles, type ArticleSummary } from "../lib/readerIpc";
import { resolveChannelForVideo, getDomainFromUrl } from "../lib/channelStore";

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

type UnifiedRecentItem =
  | { kind: "video"; data: VideoSummary }
  | { kind: "article"; data: ArticleSummary };

function VideoCard({ video }: { video: VideoSummary }) {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<string>("YouTube");
  const hasResume = video.resumeAt > 0;

  useEffect(() => {
    if (video.videoId) {
      void resolveChannelForVideo(video.videoId).then(setChannel);
    }
  }, [video.videoId]);

  const openInPlayer = () => {
    navigate(
      `/player?url=${encodeURIComponent(video.url)}${hasResume ? `&resume=${Math.floor(video.resumeAt)}` : ""}`,
    );
  };

  return (
    <button
      type="button"
      onClick={openInPlayer}
      className="group relative flex min-h-[84px] w-full flex-col overflow-hidden rounded-xl border border-hairline bg-surface/80 p-0 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-elevated hover:shadow-lg active:scale-[0.99]"
    >
      <div className="relative w-full overflow-hidden bg-overlay">
        <div className="aspect-video w-full">
          <Thumb videoId={video.videoId} />
        </div>
        <Scrub resumeAt={video.resumeAt} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-text transition-colors group-hover:text-accent">
          {video.title ?? video.url}
        </h3>
        <div className="flex items-center gap-1.5 text-xs tabular-nums text-text-2">
          <Play size={12} strokeWidth={2} className="shrink-0 text-accent" />
          <span className="truncate">
            {channel} • <VideoNoteCountInline urlHash={video.urlHash} /> • {relativeTime(video.updatedAt)}
            {hasResume ? ` • ${formatClock(video.resumeAt)}` : ""}
          </span>
        </div>
      </div>
    </button>
  );
}

function ArticleCard({ article }: { article: ArticleSummary }) {
  const navigate = useNavigate();
  const domain = article.domain || getDomainFromUrl(article.url);

  const openInReader = () => {
    navigate(`/reader?url=${encodeURIComponent(article.url)}&h=${encodeURIComponent(article.urlHash)}`);
  };

  return (
    <button
      type="button"
      onClick={openInReader}
      className="group relative flex min-h-[84px] w-full flex-col overflow-hidden rounded-xl border border-hairline bg-surface/80 p-0 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-elevated hover:shadow-lg active:scale-[0.99]"
    >
      <div className="flex aspect-video w-full items-center justify-center bg-gradient-to-br from-elevated to-overlay text-text-2 border-b border-hairline">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface/80 shadow-sm border border-hairline text-accent">
          <BookOpen size={24} strokeWidth={2} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-text transition-colors group-hover:text-accent">
          {article.title ?? article.url}
        </h3>
        <div className="flex items-center gap-1.5 text-xs tabular-nums text-text-2">
          <Globe size={12} strokeWidth={2} className="shrink-0 text-emerald-400" />
          <span className="truncate">
            {domain} • {relativeTime(article.updatedAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

function VideoNoteCountInline({ urlHash }: { urlHash: string }) {
  const query = useQuery({
    queryKey: ["videoItems", urlHash],
    queryFn: () => getVideoItems({ urlHash }),
    staleTime: 30_000,
  });
  const count = query.data?.length ?? 0;
  return <>{count} {count === 1 ? "note" : "notes"}</>;
}

export default function RecentGrid() {
  const queryClient = useQueryClient();

  const videosQuery = useQuery({
    queryKey: ["videos", "recent"],
    queryFn: listRecentVideos,
  });

  const articlesQuery = useQuery({
    queryKey: ["articles"],
    queryFn: listArticles,
  });

  useEffect(() => {
    let disposeVideos: (() => void) | undefined;
    let disposeArticles: (() => void) | undefined;
    let cancelled = false;

    void listen("db://changed:videos", () => {
      void queryClient.invalidateQueries({ queryKey: ["videos", "recent"] });
    }).then((fn) => {
      if (cancelled) fn();
      else disposeVideos = fn;
    }).catch(() => {});

    void listen("db://changed:articles", () => {
      void queryClient.invalidateQueries({ queryKey: ["articles"] });
    }).then((fn) => {
      if (cancelled) fn();
      else disposeArticles = fn;
    }).catch(() => {});

    return () => {
      cancelled = true;
      disposeVideos?.();
      disposeArticles?.();
    };
  }, [queryClient]);

  const isPending = videosQuery.isPending || articlesQuery.isPending;

  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[220px] animate-pulse rounded-xl bg-elevated/70" />
        ))}
      </div>
    );
  }

  // Combine both and sort chronologically with newest on top
  const items: UnifiedRecentItem[] = [];
  if (videosQuery.data) {
    for (const v of videosQuery.data) {
      if (v.videoId) items.push({ kind: "video", data: v });
    }
  }
  if (articlesQuery.data) {
    for (const a of articlesQuery.data) {
      items.push({ kind: "article", data: a });
    }
  }

  items.sort((a, b) => b.data.updatedAt - a.data.updatedAt);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-hairline bg-surface/50 p-8 text-center backdrop-blur-sm">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-text-3">
          <BookOpen size={22} strokeWidth={2} />
        </div>
        <p className="text-sm font-medium text-text">No notes or articles yet</p>
        <p className="text-xs text-text-3 max-w-sm">
          Paste a YouTube lecture link or web article URL above to begin studying and capturing knowledge.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((item) =>
        item.kind === "video" ? (
          <VideoCard key={`vid-${item.data.urlHash}`} video={item.data} />
        ) : (
          <ArticleCard key={`art-${item.data.urlHash}`} article={item.data} />
        ),
      )}
    </div>
  );
}
