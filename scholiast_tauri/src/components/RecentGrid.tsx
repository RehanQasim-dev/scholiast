import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { VideoSummary } from "../lib/ipc";
import { listRecentVideos } from "../lib/ipc";

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
        className="flex aspect-video items-center justify-center bg-elevated text-3xl text-text-3"
      >
        ▶
      </div>
    );
  }

  return (
    <img
      src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
      onError={() => setFailed(true)}
      alt=""
      loading="lazy"
      className="aspect-video w-full bg-elevated object-cover"
    />
  );
}

function RecentCard({ video }: { video: VideoSummary }) {
  const navigate = useNavigate();
  const hasResume = video.resumeAt > 0;

  const openInPlayer = () => {
    navigate(
      `/player?url=${encodeURIComponent(video.url)}${
        hasResume ? `&resume=${Math.floor(video.resumeAt)}` : ""
      }`,
    );
  };

  return (
    <button
      type="button"
      onClick={openInPlayer}
      className="overflow-hidden rounded-lg border border-hairline bg-surface text-left transition-colors duration-[var(--sc-dur-fast)] ease-out hover:border-accent/60"
    >
      <Thumb videoId={video.videoId} />
      <div className="flex flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm font-medium text-text">
          {video.title ?? video.url}
        </h3>
        <div className="flex items-center gap-2 text-xs tabular-nums text-text-2">
          <span>{relativeTime(video.updatedAt)}</span>
          {hasResume && (
            <span className="rounded-sm bg-elevated px-1.5 py-0.5 text-accent">
              Resume at {formatClock(video.resumeAt)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

const GRID_CLASS = "grid gap-4 sm:grid-cols-2";

export default function RecentGrid() {
  const query = useQuery({
    queryKey: ["videos", "recent"],
    queryFn: listRecentVideos,
  });

  if (query.isPending) {
    return (
      <div className={GRID_CLASS} aria-hidden="true">
        {[0, 1].map((i) => (
          <div key={i} className="aspect-video animate-pulse rounded-lg bg-surface" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-lg border border-hairline px-6 py-10 text-center text-sm text-text-2">
        Couldn't load recent videos.
      </div>
    );
  }

  const videos = query.data;

  if (!videos || videos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-hairline px-6 py-16 text-center">
        <p className="text-sm font-medium text-text">
          Paste a YouTube link to start taking notes.
        </p>
        <p className="text-xs text-text-3">Your recent videos will appear here.</p>
      </div>
    );
  }

  return (
    <div className={GRID_CLASS}>
      {videos.map((video) => (
        <RecentCard key={video.urlHash} video={video} />
      ))}
    </div>
  );
}
