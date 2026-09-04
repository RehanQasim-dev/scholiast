import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronUp, FileText } from "lucide-react";
import ArticleView from "../reader/ArticleView";
import AuthenticView from "../reader/AuthenticView";
import MarginColumn from "../reader/MarginColumn";
import { useMarginAnchors } from "../reader/useMarginAnchors";
import { useThreadModel } from "../reader/useThreadModel";
import {
  MARGIN_WIDTH_DEFAULT,
  clampMarginWidth,
} from "../reader/marginLayout";
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
import TabletVerticalDock from "../components/reader/TabletVerticalDock";
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
import {
  beginSheetDrag,
  moveSheetDrag,
  releaseSheetHeight,
  snapSheet,
  type SheetDrag,
} from "./sheetSnap";
import useIsNarrow from "../hooks/useIsNarrow";

const MIN_FONT_STEP = -2;
const MAX_FONT_STEP = 4;
const ARTICLES_KEY = ["articles"] as const;
/** Gap between the article column and the margin cards. */
const MARGIN_GUTTER = 24;

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
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const urlHash = params.get("h") ?? "";
  const rawUrl = params.get("url");
  const [fontStep, setFontStep] = useState(0);
  const [serif, setSerif] = useState(false);
  const [columnWidth, setColumnWidth] = useState<number>(736);
  const [marginWidth, setMarginWidth] = useState<number>(MARGIN_WIDTH_DEFAULT);
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
  /** "Swipe" mode: finger drags select text without long-press (narrow + dock). */
  const [swipeMode, setSwipeMode] = useState(false);
  type SheetState = "closed" | "peek" | "half" | "expanded";
  const [sheetState, setSheetState] = useState<SheetState>("closed");
  /** Live sheet height (px) while a thumb drag is in flight; null when settled. */
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [dockAppearanceOpen, setDockAppearanceOpen] = useState(false);
  const dockPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dockAppearanceOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && dockPopoverRef.current && !dockPopoverRef.current.contains(target)) {
        setDockAppearanceOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [dockAppearanceOpen]);

  // When a highlight is clicked or created, open the notes panel/sheet
  const handleHighlightClick = useCallback((highlightId: string) => {
    setFocusMode(false);
    setAnnotationsOpen(true);
    setSheetState((prev) => (prev === "closed" ? "half" : prev));
    setSelectRequest({ id: highlightId, nonce: Date.now() });
  }, []);

  // Bottom edge swipe: quick swipe opens the sheet at half height; a longer
  // press-drag follows the thumb live and snaps on release.
  const edgeDrag = useRef<SheetDrag | null>(null);
  useEffect(() => {
    if (!isNarrow || sheetState !== "closed" || swipeMode) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      // Listen in safe zone above Android OS navigation bar (bottom 0-44px).
      // Kept to a slim ~45px strip at the very bottom edge so casual
      // article swipes never open the sheet by accident.
      if (
        touch &&
        touch.clientY >= window.innerHeight - 90 &&
        touch.clientY <= window.innerHeight - 45
      ) {
        edgeDrag.current = beginSheetDrag(touch.clientY);
      } else {
        edgeDrag.current = null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const track = edgeDrag.current;
      const touch = e.touches[0];
      if (!track || !touch) return;
      // Engage only once the thumb clearly moves upward; downward moves are
      // article scrolls, not sheet drags.
      if (!track.moved && touch.clientY > track.startY - 12) return;
      setDragHeight(moveSheetDrag(track, touch.clientY, window.innerHeight));
    };

    const onTouchEnd = (e: TouchEvent) => {
      const track = edgeDrag.current;
      edgeDrag.current = null;
      if (!track) return;
      if (!track.moved) {
        const touch = e.changedTouches[0];
        if (touch && touch.clientY - track.startY < -30) {
          setSheetState("half");
        }
        return;
      }
      const releaseY = e.changedTouches[0]?.clientY ?? track.prevY;
      const vh = window.innerHeight;
      setSheetState(
        snapSheet(releaseSheetHeight(releaseY, vh), vh, track.velocityY),
      );
      setDragHeight(null);
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [isNarrow, sheetState, swipeMode]);

  // Handle gestures on the sheet handle/header: the sheet follows the thumb
  // live and snaps on release; a tap (no move) toggles half/expanded.
  const handleDrag = useRef<SheetDrag | null>(null);

  const handleSheetTouchStart = (e: React.TouchEvent) => {
    handleDrag.current = beginSheetDrag(e.touches[0].clientY);
  };

  const handleSheetTouchMove = (e: React.TouchEvent) => {
    const track = handleDrag.current;
    const touch = e.touches[0];
    if (!track || !touch) return;
    // The handle is touch-none (no scroll to fight), so follow both
    // directions live — down to shrink/dismiss, up to grow.
    setDragHeight(moveSheetDrag(track, touch.clientY, window.innerHeight));
  };

  const handleSheetTouchEnd = (e: React.TouchEvent) => {
    const track = handleDrag.current;
    handleDrag.current = null;
    if (!track || !track.moved) return;
    const releaseY = e.changedTouches[0]?.clientY ?? track.prevY;
    const vh = window.innerHeight;
    setSheetState(
      snapSheet(releaseSheetHeight(releaseY, vh), vh, track.velocityY),
    );
    setDragHeight(null);
  };

  const handleSheetHandleClick = () => {
    if (sheetState === "peek" || sheetState === "half") {
      setSheetState("expanded");
    } else if (sheetState === "expanded") {
      setSheetState("half");
    }
  };

  // Double tap / double click on article canvas closes comments sheet
  const lastArticleTapRef = useRef<number>(0);

  const handleArticleTouchEnd = () => {
    const now = Date.now();
    if (now - lastArticleTapRef.current < 320) {
      if (sheetState !== "closed") {
        setSheetState("closed");
      }
    }
    lastArticleTapRef.current = now;
  };

  const handleArticleDoubleClick = () => {
    if (sheetState !== "closed") {
      setSheetState("closed");
    }
  };

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
    void getPref<number>(PREF_KEYS.readerMarginWidth, MARGIN_WIDTH_DEFAULT)
      .then((v) =>
        setMarginWidth(
          clampMarginWidth(Number(v) || MARGIN_WIDTH_DEFAULT, window.innerWidth),
        ),
      )
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
  const stackRef = useRef<HTMLDivElement | null>(null);
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
      if (delta > 20 && top > 60) setHeaderHidden(true);
      else if (delta < -15 || top <= 20) setHeaderHidden(false);
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

  const handleSetColumnWidth = useCallback((next: number) => {
    setColumnWidth(next);
    void setPref(PREF_KEYS.readerColumnWidth, next).catch(() => {});
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

  // Margin-column model (task 01): shares the thread state/select effects
  // with ThreadPanel; only the margin branch below mounts its surface.
  const marginModel = useThreadModel(urlHash, selectRequest);
  const marginSources = useMemo(
    () =>
      marginModel.entries.map((entry) => ({
        key: entry.key,
        highlightIds: entry.members.map((m) => m.id),
      })),
    [marginModel.entries],
  );
  const marginAnchors = useMarginAnchors(
    stackRef,
    marginSources,
    `${urlHash}|${fontStep}|${serif}|${columnWidth}|${theme}|${page?.body?.length ?? 0}`,
  );
  const persistMarginWidth = useCallback((next: number) => {
    setMarginWidth(next);
    void setPref(PREF_KEYS.readerMarginWidth, next).catch(() => {});
  }, []);
  const marginMode =
    !isNarrow && !isAuthentic && Boolean(urlHash) && annotationsOpen;

  const scrollerClassName = isAuthentic
    ? "h-full min-h-0 flex-1 overflow-hidden bg-base"
    : `h-full min-h-0 flex-1 overflow-y-auto px-6 py-8 md:px-12 transition-colors duration-200 ${THEME_CLASSES[theme]}`;

  const articleBodyNode = (
    <>
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
          onOpenDiagram={(highlightId) => {
            navigate("/diagram", { state: { urlHash, highlightId } });
          }}
          swipeSelect={swipeMode}
        />
      )}
    </>
  );

  const articleContentNode = (
    <div
      ref={scrollRef}
      data-testid="article-scroller"
      onDoubleClick={handleArticleDoubleClick}
      onTouchEnd={handleArticleTouchEnd}
      className={scrollerClassName}
      style={{
        paddingBottom: isNarrow ? "calc(1.5rem + var(--sc-safe-bottom))" : undefined,
      }}
    >
      {articleBodyNode}
    </div>
  );

  const marginNode = (
    <div
      ref={scrollRef}
      data-testid="article-scroller"
      onDoubleClick={handleArticleDoubleClick}
      onTouchEnd={handleArticleTouchEnd}
      className={`relative ${scrollerClassName}`}
    >
      <div
        ref={stackRef}
        data-testid="margin-stack"
        className="mx-auto flex min-h-full items-stretch justify-center gap-6"
        style={{ maxWidth: columnWidth + MARGIN_GUTTER + marginWidth }}
      >
        <div
          className="min-w-0 shrink"
          style={{ width: columnWidth, maxWidth: "100%" }}
        >
          {articleBodyNode}
        </div>
        <div className="relative flex-none" style={{ width: marginWidth }}>
          <MarginColumn
            model={marginModel}
            anchors={marginAnchors}
            width={marginWidth}
            defaultWidth={MARGIN_WIDTH_DEFAULT}
            onWidthChange={setMarginWidth}
            onWidthCommit={persistMarginWidth}
          />
        </div>
      </div>
      {marginModel.undoState ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
          <div
            data-testid="margin-undo-bar"
            role="status"
            className="pointer-events-auto flex items-center justify-between gap-2 rounded-md border border-hairline bg-elevated px-3 py-2 shadow-xl"
          >
            <span className="truncate text-xs text-text-2">
              {marginModel.undoState.message}
            </span>
            <button
              type="button"
              data-testid="margin-undo-button"
              onClick={marginModel.confirmUndo}
              className="cursor-pointer rounded px-2 py-0.5 text-xs font-medium text-accent hover:bg-surface"
            >
              Undo
            </button>
          </div>
        </div>
      ) : null}
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
            className="relative z-50 h-full w-[264px] max-w-[85vw] border-r border-hairline bg-surface shadow-2xl"
          >
            <LibraryRail
              activeUrlHash={urlHash || null}
              onSelect={selectArticle}
              onAddError={setAddErrorMessage}
            />
          </div>
        </div>
      )}

      {/* TopBar: auto-hides on scroll (mobile/tablet/desktop), re-appears on scroll-up */}
      <div
        className={`shrink-0 overflow-visible transition-all duration-200 ease-out ${
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
          onSetColumnWidth={handleSetColumnWidth}
          onDelete={handleDelete}
          annotationsCount={annotationsCount}
          annotationsOpen={isNarrow ? sheetState !== "closed" : annotationsOpen}
          onToggleAnnotations={() => {
            if (isNarrow) setSheetState((v) => (v === "closed" ? "half" : "closed"));
            else setAnnotationsOpen((v) => !v);
          }}
          hideAppearanceOnTablet={!isNarrow}
          hideViewModeOnTablet={!isNarrow}
          hideAnnotationsOnTablet={!isNarrow}
          swipeMode={swipeMode}
          onToggleSwipe={() => setSwipeMode((v) => !v)}
          showSwipeToggle={isNarrow}
        />
      </div>

      {/* Main Content Area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!isNarrow && Boolean(urlHash) && (
          <div className="relative">
            <TabletVerticalDock
              hasArticle={Boolean(urlHash)}
              viewMode={viewMode}
              onToggleViewMode={toggleViewMode}
              onLibraryToggle={() => setDrawerOpen((v) => !v)}
              annotationsCount={annotationsCount}
              annotationsOpen={annotationsOpen}
              onToggleAnnotations={() => setAnnotationsOpen((v) => !v)}
              onOpenAppearance={() => setDockAppearanceOpen((v) => !v)}
              swipeMode={swipeMode}
              onToggleSwipe={() => setSwipeMode((v) => !v)}
            />
            {dockAppearanceOpen && (
              <div
                ref={dockPopoverRef}
                role="dialog"
                aria-label="Reading settings"
                className="absolute left-[64px] top-12 z-40 w-72 rounded-lg border border-hairline bg-surface p-3 shadow-xl backdrop-blur-md"
              >
                <div className="space-y-3">
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">Text Size</span>
                    <div className="mt-1 flex items-center justify-between rounded-md border border-hairline bg-base p-1">
                      <button type="button" onClick={() => changeFontStep(-1)} disabled={fontStep <= -2} className="h-8 w-10 rounded text-xs font-semibold text-text-2 hover:bg-elevated hover:text-text disabled:opacity-30">A−</button>
                      <span className="font-mono text-xs tabular-nums text-text">{16 + fontStep}px</span>
                      <button type="button" onClick={() => changeFontStep(1)} disabled={fontStep >= 4} className="h-8 w-10 rounded text-xs font-semibold text-text-2 hover:bg-elevated hover:text-text disabled:opacity-30">A+</button>
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">Theme</span>
                    <div className="mt-1 flex items-center gap-1.5 rounded-md border border-hairline bg-base p-1.5">
                      {[
                        { id: "oled", label: "OLED", bg: "#000000", border: "#27272a" },
                        { id: "sepia", label: "Sepia", bg: "#1c1815", border: "#443428" },
                        { id: "slate", label: "Slate", bg: "#0f172a", border: "#334155" },
                        { id: "light", label: "Light", bg: "#fbfbfa", border: "#d4d4d8" },
                      ].map((t) => (
                        <button key={t.id} type="button" title={t.label} onClick={() => handleThemeChange(t.id as ReaderTheme)} className={`flex-1 flex flex-col items-center gap-1 rounded py-1 transition-all cursor-pointer ${theme === t.id ? "ring-1 ring-accent/30" : "opacity-60 hover:opacity-100"}`}>
                          <span className="h-4 w-full rounded border shadow-sm" style={{ backgroundColor: t.bg, borderColor: t.border }} />
                          <span className="text-[10px] font-medium text-text-2">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">Typeface</span>
                    <div className="mt-1 flex rounded-md border border-hairline bg-base p-1">
                      <button type="button" onClick={() => serif && toggleSerif()} className={`flex-1 rounded py-1 text-xs font-medium transition-colors border ${!serif ? "bg-[rgba(58,166,125,0.14)] border-accent/20 text-[color:var(--sc-note-text)]" : "border-transparent text-text-2 hover:text-text"}`}>Sans</button>
                      <button type="button" onClick={() => !serif && toggleSerif()} className={`flex-1 rounded py-1 font-serif text-xs font-medium transition-colors border ${serif ? "bg-[rgba(58,166,125,0.14)] border-accent/20 text-[color:var(--sc-note-text)]" : "border-transparent text-text-2 hover:text-text"}`}>Serif</button>
                    </div>
                  </div>
                  <div>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-text-3">Column Width</span>
                    <div className="mt-1 flex rounded-md border border-hairline bg-base p-1">
                      {COLUMN_WIDTHS.map((w) => (
                        <button key={w} type="button" onClick={() => handleSetColumnWidth(w)} className={`flex-1 rounded py-1 text-xs font-medium transition-colors border ${columnWidth === w ? "bg-[rgba(58,166,125,0.14)] border-accent/20 text-[color:var(--sc-note-text)]" : "border-transparent text-text-2 hover:text-text"}`}>{w === 700 ? "Narrow" : w === 736 ? "Default" : w === 800 ? "Wide" : "Extra"}</button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-hairline pt-2">
                    <button type="button" onClick={() => { setDockAppearanceOpen(false); void handleDelete(); }} className="flex w-full items-center justify-between rounded px-2 py-1.5 text-xs text-[color:var(--sc-danger)] hover:bg-elevated">Delete Article</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="min-h-0 flex flex-1 overflow-hidden">
          {!urlHash ? (
            articleContentNode
          ) : isNarrow ? (
            <div className="relative h-full w-full overflow-hidden">
              {articleContentNode}
              {sheetState === "closed" && (
                <button
                  type="button"
                  data-testid="reader-comments-pill"
                  onClick={() => setSheetState("half")}
                  aria-label="Open annotations sheet"
                  className="fixed bottom-[calc(14px+var(--sc-safe-bottom))] left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full border border-hairline-strong bg-surface/95 px-3.5 py-1.5 text-xs font-medium text-text-2 shadow-lg shadow-black/40 backdrop-blur-md transition-all duration-150 active:scale-95 hover:text-text hover:border-accent/50"
                >
                  <FileText size={13} strokeWidth={2} className="text-accent" />
                  <span>Annotations {annotationsCount > 0 ? `(${annotationsCount})` : ""}</span>
                  <ChevronUp size={13} strokeWidth={2} className="text-text-3" />
                </button>
              )}
              {sheetState === "expanded" && (
                <div
                  data-testid="thread-sheet-scrim"
                  className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] transition-opacity duration-200"
                  onClick={() => setSheetState("closed")}
                />
              )}
              <aside
                data-testid="thread-panel-slot"
                data-state={sheetState}
                style={dragHeight !== null ? { height: dragHeight } : undefined}
                className={`fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border-t border-hairline bg-surface shadow-2xl pb-[var(--sc-safe-bottom)] ease-out ${
                  // Live drag renders every frame: no transition while the
                  // thumb is down, otherwise animate between snap points.
                  dragHeight !== null ? "transition-none" : "transition-all duration-300"
                } ${
                  sheetState === "closed" && dragHeight === null
                    ? "pointer-events-none translate-y-full opacity-0 h-0"
                    : sheetState === "peek" && dragHeight === null
                    ? "h-[20vh] min-h-[140px] max-h-[25vh] translate-y-0 opacity-100"
                    : sheetState === "half" && dragHeight === null
                    ? "h-[50vh] min-h-[240px] max-h-[55vh] translate-y-0 opacity-100"
                    : dragHeight === null
                    ? "h-[70vh] max-h-[75vh] translate-y-0 opacity-100"
                    : "translate-y-0 opacity-100"
                }`}
              >
                <div
                  data-testid="thread-sheet-handle"
                  className="flex w-full shrink-0 flex-col items-center pt-2.5 pb-1.5 cursor-pointer touch-none select-none"
                  onTouchStart={handleSheetTouchStart}
                  onTouchMove={handleSheetTouchMove}
                  onTouchEnd={handleSheetTouchEnd}
                  onClick={handleSheetHandleClick}
                >
                  <div className="h-1.5 w-12 rounded-full bg-text-3/40" />
                  <div className="flex w-full items-center justify-between px-4 pt-1">
                    <span className="text-xs font-semibold text-text-2">
                      Annotations {annotationsCount > 0 ? `(${annotationsCount})` : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-text-3">
                        {sheetState === "peek"
                          ? "Swipe up to expand"
                          : sheetState === "half"
                          ? "Drag handle to resize · swipe down to close"
                          : "Swipe down to close"}
                      </span>
                      <button
                        type="button"
                        data-testid="close-thread-sheet"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSheetState("closed");
                        }}
                        className="rounded p-1 text-text-3 hover:text-text"
                        aria-label="Close annotations"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <ThreadPanel urlHash={urlHash} selectRequest={selectRequest} />
                </div>
              </aside>
            </div>
          ) : marginMode ? (
            marginNode
          ) : annotationsOpen && threadPanelNode ? (
            <SplitterPane left={articleContentNode} right={threadPanelNode} storageKey="layout.reader_split_ratio" defaultRatio={0.65} minRatio={0.4} maxRatio={0.8} />
          ) : (
            <div className="h-full w-full overflow-hidden">{articleContentNode}</div>
          )}
        </div>
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
