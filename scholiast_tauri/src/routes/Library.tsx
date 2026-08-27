import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Play, Globe, Search, ArrowRight, FolderKanban } from "lucide-react";
import { listRecentVideos } from "../lib/ipc";
import { listArticles, type ArticleSummary } from "../lib/readerIpc";
import { getCachedChannels, resolveChannelForVideo, getDomainFromUrl } from "../lib/channelStore";
import type { VideoSummary } from "../lib/ipc";

interface ChannelGroup {
  name: string;
  videos: VideoSummary[];
}

interface DomainGroup {
  domain: string;
  articles: ArticleSummary[];
}

export default function Library() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("");
  const [channelsMap, setChannelsMap] = useState<Record<string, string>>(() => getCachedChannels());

  const videosQuery = useQuery({
    queryKey: ["videos", "recent"],
    queryFn: listRecentVideos,
  });

  const articlesQuery = useQuery({
    queryKey: ["articles"],
    queryFn: listArticles,
  });

  // Resolve channels for all videos in background
  useEffect(() => {
    if (!videosQuery.data) return;
    let cancelled = false;
    for (const v of videosQuery.data) {
      if (v.videoId && !channelsMap[v.videoId]) {
        void resolveChannelForVideo(v.videoId).then((author) => {
          if (!cancelled && author) {
            setChannelsMap((prev) => ({ ...prev, [v.videoId!]: author }));
          }
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [videosQuery.data, channelsMap]);

  // Group videos by channel
  const channelGroups = useMemo<ChannelGroup[]>(() => {
    if (!videosQuery.data) return [];
    const groups: Record<string, VideoSummary[]> = {};
    for (const v of videosQuery.data) {
      if (!v.videoId) continue;
      const ch = channelsMap[v.videoId] || "YouTube";
      if (!groups[ch]) groups[ch] = [];
      groups[ch].push(v);
    }
    return Object.entries(groups)
      .map(([name, videos]) => ({ name, videos }))
      .sort((a, b) => b.videos.length - a.videos.length);
  }, [videosQuery.data, channelsMap]);

  // Group articles by domain
  const domainGroups = useMemo<DomainGroup[]>(() => {
    if (!articlesQuery.data) return [];
    const groups: Record<string, ArticleSummary[]> = {};
    for (const a of articlesQuery.data) {
      const domain = a.domain || getDomainFromUrl(a.url);
      if (!groups[domain]) groups[domain] = [];
      groups[domain].push(a);
    }
    return Object.entries(groups)
      .map(([domain, articles]) => ({ domain, articles }))
      .sort((a, b) => b.articles.length - a.articles.length);
  }, [articlesQuery.data]);

  const searchNormalized = filter.trim().toLowerCase();

  const filteredChannels = useMemo(() => {
    if (!searchNormalized) return channelGroups;
    return channelGroups.filter((g) => g.name.toLowerCase().includes(searchNormalized));
  }, [channelGroups, searchNormalized]);

  const filteredDomains = useMemo(() => {
    if (!searchNormalized) return domainGroups;
    return domainGroups.filter((g) => g.domain.toLowerCase().includes(searchNormalized));
  }, [domainGroups, searchNormalized]);

  const isPending = videosQuery.isPending || articlesQuery.isPending;

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 pt-7 sm:pt-9 pb-24">
      {/* Header & Filter Bar */}
      <header className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent border border-accent/20">
              <FolderKanban size={20} strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-text">Library</h1>
              <p className="text-xs text-text-3">Your knowledge base grouped by channels and domains</p>
            </div>
          </div>
        </div>

        <div className="relative w-full">
          <Search
            size={16}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none"
          />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search channels or websites…"
            className="h-10 w-full rounded-xl border border-hairline bg-surface/80 pl-10 pr-4 text-sm text-text placeholder:text-text-3/60 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent backdrop-blur-sm"
          />
        </div>
      </header>

      {isPending ? (
        <div className="flex flex-col gap-8 animate-pulse">
          <div className="h-32 rounded-2xl bg-elevated/60" />
          <div className="h-32 rounded-2xl bg-elevated/60" />
        </div>
      ) : (
        <>
          {/* Section 1: YouTube Channels */}
          <section aria-label="YouTube Channels" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-text-2">
                  YouTube Channels
                </h2>
                <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-semibold text-text-3 border border-hairline">
                  {filteredChannels.length}
                </span>
              </div>
            </div>

            {filteredChannels.length === 0 ? (
              <div className="rounded-xl border border-dashed border-hairline bg-surface/40 p-6 text-center text-xs text-text-3">
                {searchNormalized ? "No matching channels found" : "No videos studied yet"}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredChannels.map((group) => (
                  <button
                    key={group.name}
                    type="button"
                    onClick={() => navigate(`/library/channel/${encodeURIComponent(group.name)}`)}
                    className="group flex items-center justify-between rounded-xl border border-hairline bg-surface/80 p-3.5 text-left backdrop-blur-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-elevated active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 font-bold text-sm">
                        <Play size={16} strokeWidth={2.2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-text group-hover:text-accent transition-colors">
                          {group.name}
                        </h3>
                        <p className="text-xs text-text-3">
                          {group.videos.length} {group.videos.length === 1 ? "video" : "videos"}
                        </p>
                      </div>
                    </div>
                    <ArrowRight
                      size={16}
                      className="text-text-3 opacity-50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent group-hover:opacity-100 shrink-0"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Section 2: Websites / Domains */}
          <section aria-label="Websites" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-text-2">
                  Websites
                </h2>
                <span className="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-semibold text-text-3 border border-hairline">
                  {filteredDomains.length}
                </span>
              </div>
            </div>

            {filteredDomains.length === 0 ? (
              <div className="rounded-xl border border-dashed border-hairline bg-surface/40 p-6 text-center text-xs text-text-3">
                {searchNormalized ? "No matching websites found" : "No articles saved yet"}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredDomains.map((group) => (
                  <button
                    key={group.domain}
                    type="button"
                    onClick={() => navigate(`/library/domain/${encodeURIComponent(group.domain)}`)}
                    className="group flex items-center justify-between rounded-xl border border-hairline bg-surface/80 p-3.5 text-left backdrop-blur-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:bg-elevated active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold text-sm">
                        <Globe size={16} strokeWidth={2} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-text group-hover:text-accent transition-colors">
                          {group.domain}
                        </h3>
                        <p className="text-xs text-text-3">
                          {group.articles.length} {group.articles.length === 1 ? "article" : "articles"}
                        </p>
                      </div>
                    </div>
                    <ArrowRight
                      size={16}
                      className="text-text-3 opacity-50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-accent group-hover:opacity-100 shrink-0"
                    />
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
