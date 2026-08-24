import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import OpenLinkField from "../components/OpenLinkField";
import RecentGrid from "../components/RecentGrid";
import SyncStatusBar from "../components/SyncStatusBar";
import { ToastHost, toast } from "../components/Toast";
import { addArticle } from "../lib/readerIpc";

const RECENT_KEY = ["videos", "recent"] as const;

function AddArticleField() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const url = value.trim();
    if (!url) return;
    try {
      const added = await addArticle({ url });
      navigate(
        `/reader?url=${encodeURIComponent(url)}&h=${encodeURIComponent(added.urlHash)}`,
      );
    } catch {
      toast("Couldn't add that article");
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex items-center gap-2 rounded-lg border border-hairline bg-surface p-2 transition-colors duration-[var(--sc-dur-fast)] ease-out focus-within:border-accent"
    >
      <input
        aria-label="Article URL"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Paste an article URL to read + annotate"
        spellCheck={false}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent px-3 py-3 text-lg text-text outline-none placeholder:text-text-3"
      />
      <button
        type="submit"
        className="rounded-md border border-hairline px-5 py-3 text-sm font-semibold text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-elevated hover:text-text"
      >
        Add article
      </button>
    </form>
  );
}

export default function Home() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    try {
      void listen("db://changed:videos", () => {
        void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
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
  }, [queryClient]);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-8 py-12">
      <ToastHost />
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-text">Home</h1>
          <p className="text-sm text-text-2">
            Open a lecture and take timestamped notes.
          </p>
        </div>
        <SyncStatusBar />
      </header>
      <OpenLinkField />
      <AddArticleField />
      <section aria-label="Recent videos" className="flex flex-col gap-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-text-3">Recent</h2>
        <RecentGrid />
      </section>
    </section>
  );
}
