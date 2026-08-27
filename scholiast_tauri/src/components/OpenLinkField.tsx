import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Clipboard, Search } from "lucide-react";
import { upsertVideo } from "../lib/ipc";
import { addArticle } from "../lib/readerIpc";
import { extractVideoId } from "../routes/Player";
import { toast } from "./Toast";

function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function openPlayerPath(url: string): string {
  return `/player?url=${encodeURIComponent(url)}`;
}

function isYouTubeInput(input: string): boolean {
  const v = input.trim();
  if (!v) return false;
  if (extractVideoId(v)) return true;
  return /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(v);
}

const RECENT_KEY = ["videos", "recent"] as const;

export default function OpenLinkField() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setValue(text.trim());
    } catch {
      toast("Clipboard unavailable");
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      toast("Paste a link to add");
      return;
    }
    const isVideo = isYouTubeInput(trimmed);
    if (isVideo) {
      const videoId = extractVideoId(trimmed);
      if (!videoId) {
        toast("That link isn't a YouTube video URL");
        return;
      }
      const url = canonicalWatchUrl(videoId);
      try {
        await upsertVideo({ url, videoId });
      } catch {
        /* best-effort; navigation still shows player */
      }
      await queryClient.invalidateQueries({ queryKey: RECENT_KEY });
      navigate(openPlayerPath(url));
    } else {
      if (!/^https?:\/\//i.test(trimmed)) {
        toast("Couldn't add that article");
        return;
      }
      try {
        const added = await addArticle({ url: trimmed });
        await queryClient.invalidateQueries({ queryKey: RECENT_KEY });
        navigate(`/reader?url=${encodeURIComponent(trimmed)}&h=${encodeURIComponent(added.urlHash)}`);
      } catch {
        toast("Couldn't add that article");
      }
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      aria-label="Open link"
      className="flex h-12 max-h-12 items-center gap-0 overflow-hidden rounded-md border border-hairline bg-elevated focus-within:border-accent"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center text-text-3" aria-hidden="true">
        <Search size={24} strokeWidth={2} style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties} />
      </span>
      <input
        aria-label="Paste YouTube or URL..."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Paste YouTube or URL..."
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent py-3 text-[15px] leading-none text-text outline-none placeholder:text-text-3"
      />
      <button
        type="button"
        aria-label="Paste from clipboard"
        onClick={() => void handlePasteFromClipboard()}
        className="flex h-12 w-12 shrink-0 items-center justify-center text-text-2 transition-colors hover:text-text focus-visible:outline-none"
      >
        <Clipboard size={24} strokeWidth={2} style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties} />
      </button>
      <button
        type="submit"
        aria-label="Open"
        className="mr-1 flex h-10 shrink-0 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        Open
      </button>
    </form>
  );
}
