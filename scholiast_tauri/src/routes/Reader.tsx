import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import ArticleView from "../reader/ArticleView";
import ThreadPanel, {
  type ThreadSelectRequest,
} from "../reader/ThreadPanel";
import LibraryRail, {
  ADD_ARTICLE_INPUT_ID,
} from "../components/reader/LibraryRail";
import ReaderTopBar, {
  COLUMN_WIDTHS,
} from "../components/reader/ReaderTopBar";
import {
  deleteArticle,
  getPage,
  listArticles,
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

function clampFontStep(value: number): number {
  return Math.min(MAX_FONT_STEP, Math.max(MIN_FONT_STEP, Math.round(value)));
}

export default function Reader() {
  const [params, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const urlHash = params.get("h") ?? "";
  const [fontStep, setFontStep] = useState(0);
  const [serif, setSerif] = useState(false);
  const [columnWidth, setColumnWidth] = useState<number>(736);
  const [focusMode, setFocusMode] = useState(false);
  const [addErrorMessage, setAddErrorMessage] = useState<string | null>(null);
  const [selectRequest, setSelectRequest] =
    useState<ThreadSelectRequest | null>(null);
  const isNarrow = useIsNarrow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [threadSheetOpen, setThreadSheetOpen] = useState(false);

  // task-31: a painted-highlight click opens its thread in the panel. Also
  // drops focus mode, which collapses that panel — otherwise the request
  // would land in a w-0 aside and look like nothing happened.
  const handleHighlightClick = useCallback((highlightId: string) => {
    setFocusMode(false);
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
  }, []);

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

  const scrollRef = useRef<HTMLDivElement>(null);
  const [headerHidden, setHeaderHidden] = useState(false);
  const lastScrollTop = useRef(0);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    setHeaderHidden(false);
    lastScrollTop.current = 0;
  }, [urlHash]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const top = el.scrollTop;
      const delta = top - lastScrollTop.current;
      if (Math.abs(delta) < 8) return;
      if (top < 80) {
        setHeaderHidden(false);
      } else if (delta > 0) {
        setHeaderHidden(true);
      } else {
        setHeaderHidden(false);
      }
      lastScrollTop.current = top;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const changeFontStep = useCallback((delta: number) => {
    setFontStep((current) => {
      const clamped = clampFontStep(current + delta);
      void setPref(PREF_KEYS.readerFontStep, clamped).catch(() => {});
      return clamped;
    });
  }, []);

  const toggleSerif = useCallback(() => {
    setSerif((current) => {
      const next = !current;
      void setPref(PREF_KEYS.readerSerif, next).catch(() => {});
      return next;
    });
  }, []);

  const cycleColumnWidth = useCallback(() => {
    setColumnWidth((current) => {
      const index = COLUMN_WIDTHS.indexOf(
        current as (typeof COLUMN_WIDTHS)[number],
      );
      const next = COLUMN_WIDTHS[(index + 1) % COLUMN_WIDTHS.length];
      void setPref(PREF_KEYS.readerColumnWidth, next).catch(() => {});
      return next;
    });
  }, []);

  const selectArticle = useCallback(
    (article: ArticleSummary) => {
      setAddErrorMessage(null);
      setDrawerOpen(false);
      setSearchParams(
        { url: article.url, h: article.urlHash },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const handleDelete = useCallback(async () => {
    if (!urlHash) return;
    const deletedHash = urlHash;
    await deleteArticle({ urlHash: deletedHash });
    await queryClient.invalidateQueries({ queryKey: ARTICLES_KEY });
    const remaining = ((queryClient.getQueryData(ARTICLES_KEY) as
      | ArticleSummary[]
      | undefined) ?? []).filter((a) => a.urlHash !== deletedHash);
    if (remaining[0]) {
      setSearchParams(
        { url: remaining[0].url, h: remaining[0].urlHash },
        { replace: true },
      );
    } else {
      navigate("/reader", { replace: true });
    }
  }, [urlHash, queryClient, navigate, setSearchParams]);

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

  const swipeStartX = useRef<number | null>(null);
  const handleSwipeStart = useCallback((event: React.TouchEvent) => {
    const x = event.touches[0]?.clientX;
    if (x !== undefined && x < 32) swipeStartX.current = x;
    else swipeStartX.current = null;
  }, []);
  const handleSwipeEnd = useCallback(
    (event: React.TouchEvent) => {
      const start = swipeStartX.current;
      swipeStartX.current = null;
      if (start === null) return;
      const end = event.changedTouches[0]?.clientX;
      if (end !== undefined && end - start > 80) navigate("/home");
    },
    [navigate],
  );

  return (
    <section
      className="flex h-full min-h-0 w-full"
      onTouchStart={handleSwipeStart}
      onTouchEnd={handleSwipeEnd}
      data-testid="reader-root"
    >
      {isNarrow ? (
        <>
          {drawerOpen ? (
            <div
              data-testid="rail-scrim"
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setDrawerOpen(false)}
            />
          ) : null}
          <div
            aria-hidden={!drawerOpen}
            data-testid="rail-wrap"
            className={`fixed bottom-0 left-0 top-0 z-40 overflow-hidden pt-[var(--sc-safe-top)] shadow-2xl transition-transform duration-[var(--sc-dur-slow)] ease-out ${
              drawerOpen ? "translate-x-0" : "invisible -translate-x-full"
            }`}
          >
            <LibraryRail
              activeUrlHash={urlHash || null}
              onSelect={selectArticle}
              onAddError={setAddErrorMessage}
            />
          </div>
        </>
      ) : (
        <div
          aria-hidden={focusMode}
          className={`shrink-0 overflow-hidden border-r border-hairline transition-all duration-[var(--sc-dur-fast)] ease-out ${
            focusMode ? "w-0 pointer-events-none opacity-0" : "w-[240px]"
          }`}
          data-testid="rail-wrap"
        >
          <LibraryRail
            activeUrlHash={urlHash || null}
            onSelect={selectArticle}
            onAddError={setAddErrorMessage}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className={`shrink-0 overflow-hidden border-b border-hairline bg-surface transition-all duration-[var(--sc-dur-fast)] ease-out ${
            focusMode || headerHidden
              ? "h-0 pointer-events-none opacity-0"
              : ""
          }`}
          data-testid="topbar-wrap"
        >
          <ReaderTopBar
            title={activeTitle}
            hasArticle={Boolean(urlHash)}
            fontStep={fontStep}
            serif={serif}
            columnWidth={columnWidth}
            onFontStep={changeFontStep}
            onToggleSerif={toggleSerif}
            onCycleColumnWidth={cycleColumnWidth}
            onDelete={handleDelete}
            showLibraryToggle={isNarrow}
            onLibraryToggle={() => setDrawerOpen((v) => !v)}
          />
        </div>

        <div
          ref={scrollRef}
          data-testid="article-scroller"
          className="min-h-0 flex-1 overflow-y-auto px-8 py-10"
          style={{
            paddingBottom: isNarrow ? "calc(5.5rem + var(--sc-safe-bottom) + 24px)" : undefined,
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
                    className="mt-3 rounded-md border border-hairline px-4 py-2 text-sm font-medium text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-elevated hover:text-text"
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
                    className="mt-3 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-base transition-opacity duration-[var(--sc-dur-fast)] ease-out hover:opacity-90"
                  >
                    Add an article
                  </button>
                }
              />
            )
          ) : urlHash === "" ? (
            <EmptyState
              testId="no-selection-state"
              message="Pick an article from the library rail, or add a new one."
              action={
                <button
                  type="button"
                  onClick={() =>
                    document.getElementById(ADD_ARTICLE_INPUT_ID)?.focus()
                  }
                  className="mt-3 rounded-md border border-hairline px-4 py-2 text-sm font-medium text-text-2 transition-colors duration-[var(--sc-dur-fast)] ease-out hover:bg-elevated hover:text-text"
                >
                  Add an article
                </button>
              }
            />
          ) : pageQuery.isPending ? (
            <p className="text-sm text-text-3">Loading…</p>
          ) : pageQuery.isError ? (
            <EmptyState message="Couldn't load this article." />
          ) : page === null ? (
            <EmptyState message="This article isn't in the library yet." />
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
      </div>

      {/* task-31 thread panel: 320px dock, hidden without an open article.
          task-35: narrow viewports get a bottom sheet (70vh cap) instead. */}
      {isNarrow ? (
        <>
          {urlHash && !focusMode && !threadSheetOpen ? (
            <button
              type="button"
              data-testid="thread-sheet-toggle"
              onClick={() => setThreadSheetOpen(true)}
              className="fixed right-3 z-20 flex h-12 cursor-pointer items-center gap-2 rounded-full border border-hairline bg-elevated px-4 text-sm font-medium text-text shadow-lg"
              style={{ bottom: "calc(5rem + var(--sc-safe-bottom))" }}
            >
              Annotations
            </button>
          ) : null}
          {urlHash && !focusMode && threadSheetOpen ? (
            <aside
              data-testid="thread-panel-slot"
              className="fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col rounded-t-xl border-t border-hairline bg-base pb-[var(--sc-safe-bottom)] shadow-2xl"
            >
              <button
                type="button"
                data-testid="thread-sheet-handle"
                aria-label="Close annotations panel"
                onClick={() => setThreadSheetOpen(false)}
                className="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 cursor-pointer rounded-full bg-text-3"
              />
              {urlHash ? (
                <ThreadPanel urlHash={urlHash} selectRequest={selectRequest} />
              ) : null}
            </aside>
          ) : null}
        </>
      ) : (
        <aside
          data-testid="thread-panel-slot"
          className={`shrink-0 overflow-hidden border-l border-hairline transition-all duration-[var(--sc-dur-fast)] ease-out ${
            urlHash && !focusMode ? "w-[320px]" : "w-0 border-l-0"
          }`}
        >
          {urlHash ? (
            <ThreadPanel urlHash={urlHash} selectRequest={selectRequest} />
          ) : null}
        </aside>
      )}
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
