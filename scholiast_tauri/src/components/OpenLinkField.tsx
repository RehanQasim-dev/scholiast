import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { upsertVideo } from "../lib/ipc";
import { extractVideoId } from "../routes/Player";
import { toast } from "./Toast";

export function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function openPlayerPath(url: string): string {
  return `/player?url=${encodeURIComponent(url)}`;
}

export default function OpenLinkField() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();

  const open = () => {
    const videoId = extractVideoId(value);
    if (!videoId) {
      toast("That link isn't a YouTube video URL");
      return;
    }
    const url = canonicalWatchUrl(videoId);
    void upsertVideo({ url, videoId }).catch(() => {});
    navigate(openPlayerPath(url));
  };

  const pasteFromClipboard = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) {
        toast("Clipboard is empty");
        return;
      }
      setValue(text);
    } catch {
      toast("Clipboard unavailable — paste into the field instead");
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    open();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 rounded-lg border border-hairline bg-surface p-2 transition-colors duration-[var(--sc-dur-fast)] ease-out focus-within:border-accent"
    >
      <input
        aria-label="YouTube link"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Paste a YouTube link"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent px-3 py-3 text-lg text-text outline-none placeholder:text-text-3"
      />
      <button
        type="button"
        onClick={() => void pasteFromClipboard()}
        className="rounded-md px-4 py-3 text-sm font-medium text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-elevated hover:text-text"
      >
        Paste
      </button>
      <button
        type="submit"
        className="rounded-md bg-accent px-5 py-3 text-sm font-semibold text-white transition-opacity duration-[var(--sc-dur-fast)] ease-out hover:opacity-90"
      >
        Open
      </button>
    </form>
  );
}
