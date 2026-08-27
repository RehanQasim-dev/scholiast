import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import ArticleView from "../reader/ArticleView";
import AuthenticView from "../reader/AuthenticView";
import ThreadPanel, {
  type ThreadSelectRequest,
} from "../reader/ThreadPanel";
import LibraryRail, {
  ADD_ARTICLE_INPUT_ID,
} from "../components/reader/LibraryRail";
import ReaderTopBar, {
  COLUMN_WIDTHS,
  type ReaderTheme,
  type ReaderViewMode,
} from "../components/reader/ReaderTopBar";
import SplitterPane from "../components/SplitterPane";
import {
  addArticle,
  deleteArticle,
  getPage,
  listArticles,
  listHighlights,
  type ArticleSummary,
} from "../lib/readerIpc";
import {
  getPref,
  PREF_KEYS,
  setPref,
} from "../lib/store";
import { useReaderKeyboard } from "../lib/useReaderKeyboard";
import useIsNarrow from "../hooks/useIsNarrow";

const MIN_FONT_STEP = -2;
const MAX_FONT_STEP = 4;
const ARTICLES_KEY = ["articles"] as const;

const THEME_CLASSES: Record<ReaderTheme, string> = {
  oled: "bg-black text-[#e4e4e7]",
  sepia: "bg-[#1c1815] text-[#e6dfd5]",
  slate: "bg-[#0f172a] text-[#cbd5e1]",
  light: "bg-[#fbfbfa] text-[#18181b]",
};

function clampFontStep(value: number): number {
  return Math.min(MAX_FONT_STEP, Math.max(MIN_FONT_STEP, Math.round(value)));
}

export default function Reader() {
  const [params, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const urlHash = params.get("h") ?? "";
  const rawUrl = params.get("url");
  const [fontStep, setFontStep] = useState(0);
  const [serif, setSerif] = useState(false);
  const [columnWidth, setColumnWidth] = useState<number>(736);
  const [theme, setTheme] = useState<ReaderTheme>("oled");
  const [viewMode, setViewMode] = useState<ReaderViewMode>("web");
  const [focusMode, setFocusMode] = useState(false);
  const [addErrorMessage, setAddErrorMessage] = useState<string | null>(null);
  const [selectRequest, setSelectRequest] = useState<ThreadSelectRequest | null>(null);
  const isNarrow = useIsNarrow();

  useEffect(() => {
    if (rawUrl && !urlHash) {
      void addArticle({ url: rawUrl })
        .then((res) => {
          setSearchParams({ url: rawUrl, h: res.urlHash }, { replace: true });
        })
        .catch((err) => {
          setAddErrorMessage(err instanceof Error ? err.message : String(err));
        });
    }
  }, [rawUrl, urlHash, setSearchParams]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [annotationsOpen, setAnnotationsOpen] = useState(false);
  const [threadSheetOpen, setThreadSheetOpen] = useState(false);

  // When a highlight is clicked or created, open the notes panel/sheet
  const handleHighlightClick = useCallback((highlightId: string) => {
    setFocusMode(false);
    setAnnotationsOpen(true);
    setThreadSheetOpen(true);
    setSelectRequest({ id: highlightId, nonce: Date.now() });
  }, []);

  useEffect(() => {
    void getPref<number>(PREF_KEYS.readerFontStep, 0)
      .then((v) => setFontStep(clampFontStep(Number(v) || 0)))
      .catch(() => {});
    void getPref<boolean>(PREF_KEYS.readerSerif, false)
      .then((v) => setSerif(Boolean(v)))
      .catch(() => {});
    void getPref<number>(PREF_KEYS.readerColumnWidth, 736)
      .then((v) => setColumnWidth(Number(v) || 736))
      .catch(() => {});
    void getPref<ReaderTheme>(PREF_KEYS.readerTheme, "oled")
      .then((v) => setTheme((v as ReaderTheme) || "oled"))
      .catch(() => {});
    void getPref<ReaderViewMode>(PREF_KEYS.readerMode, "web")
      .then((v) => setViewMode((v as ReaderViewMode) || "web"))
      .catch(() => {});
  }, []);

  const handleThemeChange = (next: ReaderTheme) => {
    setTheme(next);
    void setPref(PREF_KEYS.readerTheme, next);
  };

  const articlesQuery = useQuery({
    queryKey: ARTICLES_KEY,
    queryFn: listArticles,
  });
  const articles: ArticleSummary[] = articlesQuery.data ?? [];

  const pageQuery = useQuery({
    queryKey: ["page", urlHash],
    queryFn: () => getPage({ urlHash }),
    enabled: urlHash !== "",
  });

  const highlightsQuery = useQuery({
    queryKey: ["highlights", urlHash],
    queryFn: () => listHighlights({ urlHash }),
    enabled: Boolean(urlHash),
  });
  const annotationsCount = (highlightsQuery.data ?? []).length;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollTop = useRef(0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setHeaderHidden(false);
    lastScrollTop.current = 0;
  }, [urlHash]);

  // Auto-hide header on downward scroll; restore on upward scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const top = el.scrollTop;
      const delta = top - lastScrollTop.current;
      if (delta > 20 && top > 60) {
        setHeaderHidden(true);
      } else if (delta < -15 || top <= 20) {
        setHeaderHidden(false);
      }
      lastScrollTop.current = top;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [urlHash]);

  const selectArticle = useCallback(
    (article: ArticleSummary) => {
      setSearchParams(article.urlHash ? { h: article.urlHash } : {});
      setDrawerOpen(false);
    },
    [setSearchParams],
  );

  const changeFontStep = useCallback((delta: number) => {
    setFontStep((prev) => {
      const next = clampFontStep(prev + delta);
      void setPref(PREF_KEYS.readerFontStep, next).catch(() => {});
      return next;
    });
  }, []);

  const toggleSerif = useCallback(() => {
    setSerif((prev) => {
      const next = !prev;
      void setPref(PREF_KEYS.readerSerif, next).catch(() => {});
      return next;
    });
  }, []);

  const cycleColumnWidth = useCallback(() => {
    setColumnWidth((prev) => {
      const idx = COLUMN_WIDTHS.indexOf(prev as (typeof COLUMN_WIDTHS)[number]);
      const next = COLUMN_WIDTHS[(idx + 1) % COLUMN_WIDTHS.length] ?? 736;
      void setPref(PREF_KEYS.readerColumnWidth, next).catch(() => {});
      return next;
    });
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === "web" ? "reader" : "web";
      void setPref(PREF_KEYS.readerMode, next).catch(() => {});
      return next;
    });
  }, []);

  const handleDelete = useCallback(async () => {
    if (!urlHash) return;
    try {
      await deleteArticle({ urlHash });
      await queryClient.invalidateQueries({ queryKey: ARTICLES_KEY });
      queryClient.removeQueries({ queryKey: ["page", urlHash] });
      queryClient.removeQueries({ queryKey: ["highlights", urlHash] });
      setSearchParams({});
    } catch {
      /* ignore */
    }
  }, [urlHash, queryClient, setSearchParams]);

  useReaderKeyboard({
    onFocusModeToggle: () => setFocusMode((v) => !v),
    onScrollTop: () => scrollRef.current?.scrollTo({ top: 0 }),
  });

  const page = urlHash ? (pageQuery.data ?? null) : null;
  const activeTitle =
    page?.title ??
    articles.find((a) => a.urlHash === urlHash)?.title ??
    (urlHash ? "Untitled" : null);
  const libraryEmpty = !articlesQuery.isPending && articles.length === 0;

  // Render article reading canvas
  const isAuthentic = viewMode === "web" && Boolean(page?.url);

  const articleContentNode = (
    <div
      ref={scrollRef}
      data-testid="article-scroller"
      className={
        isAuthentic
          ? "h-full min-h-0 flex-1 overflow-hidden bg-base"
          : `h-full min-h-0 flex-1 overflow-y-auto px-6 py-8 md:px-12 transition-colors duration-200 ${THEME_CLASSES[theme]}`
      }
      style={{
        paddingBottom: isNarrow ? "calc(4rem + var(--sc-safe-bottom))" : undefined,
      }}
    >
      {libraryEmpty && !urlHash ? (
        addErrorMessage ? (
          <EmptyState
            testId="extraction-failed-state"
            message={`Couldn't capture that page — ${addErrorMessage}.`}
            action={
              <button
                type="button"
                autoFocus
                onClick={() =>
                  document.getElementById(ADD_ARTICLE_INPUT_ID)?.focus()
                }
                className="mt-3 rounded-md border border-hairline px-4 py-2 text-sm font-medium text-text-2 transition-colors hover:bg-elevated hover:text-text"
              >
                Try another URL
              </button>
            }
          />
        ) : (
          <EmptyState
            testId="empty-library-state"
            message="Your library is empty. Add an article to start reading and annotating."
            action={
              <button
                type="button"
                autoFocus
                data-testid="empty-library-add"
                onClick={() =>
                  document.getElementById(ADD_ARTICLE_INPUT_ID)?.focus()
                }
                className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-[var(--sc-accent-text)] transition-opacity hover:opacity-90"
              >
                Add an article
              </button>
            }
          />
        )
      ) : urlHash === "" ? (
        <div className="mx-auto max-w-xl py-6">
          <LibraryRail
            activeUrlHash={null}
            onSelect={selectArticle}
            onAddError={setAddErrorMessage}
          />
        </div>
      ) : pageQuery.isPending ? (
        <div className="mx-auto max-w-2xl space-y-4 py-8">
          <div className="h-8 w-3/4 animate-pulse rounded bg-surface" />
          <div className="h-4 w-full animate-pulse rounded bg-surface" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-surface" />
        </div>
      ) : pageQuery.isError ? (
        <EmptyState message="Couldn't load this article." />
      ) : page === null ? (
        <EmptyState message="This article isn't in the library yet." />
      ) : isAuthentic ? (
        <AuthenticView
          url={page.url}
          theme={theme}
          urlHash={urlHash}
          onHighlightClick={handleHighlightClick}
          onHighlightCreated={handleHighlightClick}
        />
      ) : (
        <ArticleView
          title={page.title}
          body={page.body}
          notReadable={false}
          fontStep={fontStep}
          serif={serif}
          columnWidth={columnWidth}
          urlHash={urlHash}
          onHighlightClick={handleHighlightClick}
          onHighlightCreated={handleHighlightClick}
        />
      )}
    </div>
  );

  const threadPanelNode = urlHash ? (
    <div className="h-full min-h-0 flex-1 overflow-hidden bg-surface">
      <ThreadPanel urlHash={urlHash} selectRequest={selectRequest} />
    </div>
  ) : null;

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-base overflow-hidden" data-testid="reader-root">
      {/* Slide-out Library drawer (when requested) */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div
            data-testid="rail-scrim"
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            data-testid="rail-wrap"
            className="relative z-50 h-full w-72 max-w-[85vw] border-r border-hairline bg-surface shadow-2xl"
          >
            <LibraryRail
              activeUrlHash={urlHash || null}
              onSelect={selectArticle}
              onAddError={setAddErrorMessage}
            />
          </div>
        </div>
      )}

      {/* Auto-hiding Minimalist TopBar */}
      <div
        className={`shrink-0 overflow-hidden transition-all duration-200 ease-out ${
          focusMode || headerHidden ? "-mt-[50px] opacity-0 pointer-events-none" : "mt-0 opacity-100"
        }`}
        data-testid="topbar-wrap"
      >
        <ReaderTopBar
          title={activeTitle}
          hasArticle={Boolean(urlHash)}
          viewMode={viewMode}
          onToggleViewMode={toggleViewMode}
          fontStep={fontStep}
          serif={serif}
          columnWidth={columnWidth}
          theme={theme}
          onThemeChange={handleThemeChange}
          onFontStep={changeFontStep}
          onToggleSerif={toggleSerif}
          onCycleColumnWidth={cycleColumnWidth}
          onDelete={handleDelete}
          showLibraryToggle={Boolean(urlHash)}
          onLibraryToggle={() => setDrawerOpen((v) => !v)}
          annotationsCount={annotationsCount}
          annotationsOpen={isNarrow ? threadSheetOpen : annotationsOpen}
          onToggleAnnotations={() => {
            if (isNarrow) setThreadSheetOpen((v) => !v);
            else setAnnotationsOpen((v) => !v);
          }}
        />
      </div>

      {/* Main Content Area */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {!urlHash ? (
          /* No article selected: Show clean Library View */
          articleContentNode
        ) : isNarrow ? (
          /* Mobile Narrow View */
          <div className="relative h-full w-full overflow-hidden">
            {articleContentNode}

            {/* Mobile Bottom Sheet for Past Comments / Annotations */}
            {threadSheetOpen && (
              <div className="fixed inset-0 z-40 flex flex-col justify-end">
                <div
                  className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
                  onClick={() => setThreadSheetOpen(false)}
                />
                <aside
                  data-testid="thread-panel-slot"
                  className="relative z-10 flex max-h-[45vh] h-[40vh] flex-col rounded-t-2xl border-t border-hairline bg-surface shadow-2xl pb-[var(--sc-safe-bottom)]"
                >
                  <div className="mx-auto my-2 h-1 w-12 rounded-full bg-text-3/40" />
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <ThreadPanel urlHash={urlHash} selectRequest={selectRequest} />
                  </div>
                </aside>
              </div>
            )}
          </div>
        ) : (
          /* Tablet & Desktop: Resizable 2-Panel Splitter when Annotations Open */
          annotationsOpen && threadPanelNode ? (
            <SplitterPane
              left={articleContentNode}
              right={threadPanelNode}
              storageKey="layout.reader_split_ratio"
              defaultRatio={0.65}
              minRatio={0.4}
              maxRatio={0.8}
            />
          ) : (
            /* Full Width Reading Canvas when Annotations Closed */
            <div className="h-full w-full overflow-hidden">
              {articleContentNode}
            </div>
          )
        )}
      </div>
    </section>
  );
}

function EmptyState({
  message,
  action,
  testId,
}: {
  message: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="mx-auto mt-16 max-w-md rounded-lg border border-dashed border-hairline bg-surface px-6 py-12 text-center"
    >
      <p className="text-sm text-text-2">{message}</p>
      {action}
    </div>
  );
}
