import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Play, BookOpen, Clock, FileText } from "lucide-react";
import { listRecentVideos, getVideoItems, type VideoSummary } from "../lib/ipc";
import { listArticles, type ArticleSummary } from "../lib/readerIpc";
import {
  getCachedChannels,
  getCachedTitles,
  resolveVideoMeta,
  getDomainFromUrl,
} from "../lib/channelStore";

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

function VideoNotesBadge({ urlHash }: { urlHash: string }) {
  const query = useQuery({
    queryKey: ["videoItems", urlHash],
    queryFn: () => getVideoItems({ urlHash }),
    staleTime: 30_000,
  });
  const count = query.data?.length ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent border border-accent/30">
      <FileText size={12} strokeWidth={2} />
      <span>{count} {count === 1 ? "note" : "notes"}</span>
    </span>
  );
}

export default function CollectionDetail() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const decodedId = decodeURIComponent(id ?? "");

  const [channelsMap, setChannelsMap] = useState<Record<string, string>>(() => getCachedChannels());
  const [videoTitles, setVideoTitles] = useState<Record<string, string>>(() => getCachedTitles());

  const videosQuery = useQuery({
    queryKey: ["videos", "recent"],
    queryFn: listRecentVideos,
    enabled: type === "channel",
  });

  const articlesQuery = useQuery({
    queryKey: ["articles"],
    queryFn: listArticles,
    enabled: type === "domain",
  });

  // Resolve channels and titles if channel view
  useEffect(() => {
    if (type !== "channel" || !videosQuery.data) return;
    let cancelled = false;
    for (const v of videosQuery.data) {
      if (v.videoId && (!channelsMap[v.videoId] || (!v.title && !videoTitles[v.videoId]))) {
        void resolveVideoMeta(v.videoId).then((meta) => {
          if (!cancelled) {
            if (meta.author) {
              setChannelsMap((prev) => ({ ...prev, [v.videoId!]: meta.author }));
            }
            if (meta.title) {
              setVideoTitles((prev) => ({ ...prev, [v.videoId!]: meta.title! }));
            }
          }
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [type, videosQuery.data, channelsMap, videoTitles]);

  const channelVideos = useMemo<VideoSummary[]>(() => {
    if (type !== "channel" || !videosQuery.data) return [];
    return videosQuery.data.filter((v) => {
      if (!v.videoId) return false;
      const ch = channelsMap[v.videoId] || "YouTube";
      return ch.toLowerCase() === decodedId.toLowerCase();
    });
  }, [type, videosQuery.data, channelsMap, decodedId]);

  const domainArticles = useMemo<ArticleSummary[]>(() => {
    if (type !== "domain" || !articlesQuery.data) return [];
    return articlesQuery.data.filter((a) => {
      const d = a.domain || getDomainFromUrl(a.url);
      return d.toLowerCase() === decodedId.toLowerCase();
    });
  }, [type, articlesQuery.data, decodedId]);

  const isChannel = type === "channel";
  const count = isChannel ? channelVideos.length : domainArticles.length;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 pt-7 sm:pt-9 pb-24">
      {/* Header */}
      <header className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => navigate("/library")}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium text-text-2 hover:bg-elevated hover:text-text transition-colors"
        >
          <ArrowLeft size={14} /> Back to Library
        </button>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-sm font-bold shadow-sm ${
                isChannel
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
              }`}
            >
              {isChannel ? <Play size={20} strokeWidth={2.2} /> : <BookOpen size={20} strokeWidth={2.2} />}
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text">{decodedId}</h1>
              <p className="text-xs text-text-3">
                {count} {isChannel ? (count === 1 ? "video" : "videos") : count === 1 ? "article" : "articles"}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Item List */}
      {isChannel ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {channelVideos.map((v) => (
            <button
              key={v.urlHash}
              type="button"
              onClick={() =>
                navigate(
                  `/player?url=${encodeURIComponent(v.url)}${v.resumeAt > 0 ? `&resume=${Math.floor(v.resumeAt)}` : ""}`,
                )
              }
              className="group flex flex-col overflow-hidden rounded-xl border border-hairline bg-surface/80 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-elevated hover:shadow-lg active:scale-[0.99]"
            >
              <div className="relative aspect-video w-full overflow-hidden bg-overlay">
                <img
                  src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {v.resumeAt > 0 && (
                  <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-mono text-white backdrop-blur-xs">
                    <Clock size={10} /> {formatClock(v.resumeAt)}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3.5">
                <h3 className="line-clamp-2 text-sm font-semibold text-text group-hover:text-accent transition-colors">
                  {(v.videoId ? videoTitles[v.videoId] : null) ?? v.title ?? (v.videoId ? "YouTube Video" : v.url)}
                </h3>
                <div className="mt-auto flex items-center justify-between text-xs text-text-2">
                  <VideoNotesBadge urlHash={v.urlHash} />
                  <span className="text-[11px] text-text-3">{relativeTime(v.updatedAt)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {domainArticles.map((a) => (
            <button
              key={a.urlHash}
              type="button"
              onClick={() =>
                navigate(`/reader?url=${encodeURIComponent(a.url)}&h=${encodeURIComponent(a.urlHash)}`)
              }
              className="group flex flex-col overflow-hidden rounded-xl border border-hairline bg-surface/80 text-left backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-elevated hover:shadow-lg active:scale-[0.99]"
            >
              <div className="flex aspect-[21/9] w-full items-center justify-center bg-gradient-to-br from-elevated to-overlay border-b border-hairline text-accent">
                <BookOpen size={24} strokeWidth={2} />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3.5">
                <h3 className="line-clamp-2 text-sm font-semibold text-text group-hover:text-accent transition-colors">
                  {a.title ?? a.url}
                </h3>
                <div className="mt-auto flex items-center justify-between text-xs text-text-2">
                  <span className="text-xs text-text-3">{relativeTime(a.updatedAt)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
