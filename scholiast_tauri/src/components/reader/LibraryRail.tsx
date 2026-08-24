import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  addArticle,
  listArticles,
  type ArticleSummary,
} from "../../lib/readerIpc";
import { IpcCommandError } from "../../lib/ipc";

const ARTICLES_KEY = ["articles"] as const;
export const ADD_ARTICLE_INPUT_ID = "reader-add-article-input";

/** Maps `add_article` failure kinds to short human copy. */
export function describeAddError(kind: string, fallback: string): string {
  if (kind === "fetchBlocked") return "Site blocked extraction";
  if (kind === "notReadable") return "Not an article";
  if (kind === "network") return "Offline?";
  if (kind === "invalidInput") return "Enter an absolute http(s) URL";
  return fallback;
}

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

export interface LibraryRailProps {
  activeUrlHash: string | null;
  onSelect: (article: ArticleSummary) => void;
  /** Reports the mapped failure copy of the last add attempt (null clears). */
  onAddError?: (message: string | null) => void;
}

export default function LibraryRail({
  activeUrlHash,
  onSelect,
  onAddError,
}: LibraryRailProps) {
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    try {
      void listen("db://changed:pages", () => {
        void queryClient.invalidateQueries({ queryKey: ARTICLES_KEY });
      })
        .then((fn) => {
          if (cancelled) fn();
          else dispose = fn;
        })
        .catch(() => {});
    } catch {
      /* tauri event API unavailable (e.g. mocked test env) */
    }
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [queryClient]);

  const articlesQuery = useQuery({
    queryKey: ARTICLES_KEY,
    queryFn: listArticles,
  });

  const articles = articlesQuery.data ?? [];
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? articles.filter(
        (article) =>
          (article.title ?? "").toLowerCase().includes(needle) ||
          (article.domain ?? "").toLowerCase().includes(needle),
      )
    : articles;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const url = draft.trim();
    if (!url || adding) return;
    setAdding(true);
    setAddError(null);
    onAddError?.(null);
    try {
      const added = await addArticle({ url });
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ARTICLES_KEY });
      navigate(`/reader?url=${encodeURIComponent(url)}&h=${encodeURIComponent(added.urlHash)}`);
    } catch (error) {
      const kind = error instanceof IpcCommandError ? error.kind : "unknown";
      const message =
        error instanceof Error ? error.message : "Couldn't add that article";
      const copy = describeAddError(kind, message);
      setAddError(copy);
      onAddError?.(copy);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      data-testid="library-rail"
      className="flex h-full w-[240px] shrink-0 flex-col bg-surface"
    >
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-2 border-b border-hairline p-3"
      >
        <div className="flex items-center gap-2 rounded-md border border-hairline px-2 py-1 transition-colors duration-[var(--sc-dur-fast)] ease-out focus-within:border-accent">
          <input
            id={ADD_ARTICLE_INPUT_ID}
            data-testid="add-article-input"
            aria-label="Add article URL"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setAddError(null);
            }}
            placeholder="Add article…"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm text-text outline-none placeholder:text-text-3"
          />
          <button
            type="submit"
            disabled={adding || draft.trim() === ""}
            className="rounded-md px-3 py-2 text-sm font-semibold text-accent transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-elevated disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {addError ? (
          <p role="alert" data-testid="add-article-error" className="text-xs text-hl-red">
            {addError}
          </p>
        ) : null}
      </form>

      <div className="border-b border-hairline p-3">
        <input
          type="search"
          aria-label="Filter articles"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Search title or site"
          className="w-full rounded-md border border-hairline bg-transparent px-3 py-2 text-sm text-text outline-none transition-colors duration-[var(--sc-dur-fast)] ease-out placeholder:text-text-3 focus:border-accent"
        />
      </div>

      <nav aria-label="Saved articles" className="min-h-0 flex-1 overflow-y-auto p-2">
        {articlesQuery.isPending ? (
          <p className="px-2 py-3 text-xs text-text-3">Loading…</p>
        ) : visible.length === 0 ? (
          <p data-testid="rail-empty" className="px-2 py-3 text-xs text-text-3">
            {articles.length === 0
              ? "No saved articles yet."
              : "No articles match that search."}
          </p>
        ) : (
          <ul data-testid="article-list" className="flex flex-col gap-1">
            {visible.map((article) => {
              const active = article.urlHash === activeUrlHash;
              return (
                <li key={article.urlHash}>
                  <button
                    type="button"
                    data-testid={`article-item-${article.urlHash}`}
                    aria-current={active ? "true" : undefined}
                    onClick={(event) => {
                      if (event.ctrlKey || event.metaKey) {
                        void openUrl(article.url).catch(() => {});
                        return;
                      }
                      onSelect(article);
                    }}
                    className={`w-full rounded-md px-3 py-2 text-left transition-colors duration-[var(--sc-dur-fast)] ease-out ${
                      active
                        ? "bg-elevated ring-1 ring-accent"
                        : "hover:bg-elevated/60"
                    }`}
                  >
                    <span
                      className={`block truncate text-sm ${
                        active ? "font-medium text-text" : "text-text-2"
                      }`}
                    >
                      {article.title ?? article.domain ?? article.url}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-text-3 tabular-nums">
                      {article.domain ?? "unknown"} · {relativeTime(article.updatedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
