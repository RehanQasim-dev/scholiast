import { useEffect, useRef, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReaderTheme } from "../components/reader/ReaderTopBar";
import SwatchPopup, { type HighlightColor } from "../components/SwatchPopup";
import { getAuthenticHtml, saveHighlight } from "../lib/readerIpc";
import { getDarkReaderScript } from "../lib/darkReaderScript";
import { toast } from "../components/Toast";

export interface AuthenticViewProps {
  url: string;
  theme: ReaderTheme;
  urlHash?: string;
  onHighlightClick?: (highlightId: string) => void;
  onHighlightCreated?: (highlightId: string) => void;
}

interface SelectionState {
  text: string;
  x: number;
  y: number;
}

export default function AuthenticView({
  url,
  theme,
  urlHash,
  onHighlightCreated,
}: AuthenticViewProps) {
  const navigate = useNavigate();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [createdHighlightId, setCreatedHighlightId] = useState<string | null>(null);

  const { data: rawHtml, isLoading, error } = useQuery({
    queryKey: ["authentic-html", url],
    queryFn: () => getAuthenticHtml({ url }),
    enabled: Boolean(url),
    staleTime: 1000 * 60 * 30, // 30 mins
  });

  // Prepare full HTML with Dark Reader script injected
  const processedHtml = useMemo(() => {
    if (!rawHtml) return "";
    const script = getDarkReaderScript(theme);
    if (rawHtml.includes("</body>")) {
      return rawHtml.replace("</body>", `${script}</body>`);
    }
    return rawHtml + script;
  }, [rawHtml, theme]);

  // Update theme dynamically when theme prop changes without iframe reload
  useEffect(() => {
    if (!iframeRef.current?.contentWindow) return;
    try {
      iframeRef.current.contentWindow.postMessage({ type: "SET_THEME", theme }, "*");
    } catch {
      /* ignore cross-frame errors if any */
    }
  }, [theme]);

  // Listen for selection messages from inside the iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data) return;

      if (e.data.type === "SELECTION_CLEARED") {
        setSelection(null);
      } else if (e.data.type === "TEXT_SELECTED") {
        const { text, rect } = e.data;
        if (!text || !rect || !containerRef.current) {
          setSelection(null);
          return;
        }

        const containerRect = containerRef.current.getBoundingClientRect();
        // Calculate coordinate in viewport
        const x = containerRect.left + rect.left + rect.width / 2;
        const y = containerRect.top + rect.top;
        setSelection({ text, x, y: Math.max(10, y) });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleApplyColor = async (color: HighlightColor) => {
    if (!selection || !urlHash) return;
    const highlightId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      await saveHighlight({
        urlHash,
        highlight: {
          id: highlightId,
          type: "text",
          content: selection.text,
          color,
          updatedAt: Date.now(),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["highlights", urlHash] });
      setCreatedHighlightId(highlightId);
      onHighlightCreated?.(highlightId);
      setSelection(null);
    } catch {
      toast("Failed to save highlight");
    }
  };

  const handleComment = () => {
    if (!selection || !urlHash) return;
    void handleApplyColor("yellow");
  };

  if (isLoading) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-text-2">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        <span className="text-sm font-medium">Loading authentic webpage with uBlock & Dark Reader…</span>
      </div>
    );
  }

  if (error || !rawHtml) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8 text-center text-text-2">
        <p className="text-sm">Unable to load authentic webpage for this article.</p>
        <button
          type="button"
          onClick={() => void queryClient.invalidateQueries({ queryKey: ["authentic-html", url] })}
          className="rounded-md border border-hairline px-4 py-2 text-xs font-semibold text-text hover:bg-elevated"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-base">
      <iframe
        ref={iframeRef}
        srcDoc={processedHtml}
        title="Authentic Webview"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        className="h-full w-full border-0"
      />

      {/* Floating Selection Swatch */}
      {selection && (
        <SwatchPopup
          anchor={{ top: selection.y, left: selection.x }}
          onPickColor={handleApplyColor}
          onComment={handleComment}
          onClose={() => setSelection(null)}
          onOpenDiagram={() => {
            if (createdHighlightId) {
              onHighlightCreated?.(createdHighlightId);
              navigate("/diagram", { state: { urlHash, highlightId: createdHighlightId } });
            } else if (urlHash) {
              void handleApplyColor("yellow").then(() => {
                navigate("/diagram", { state: { urlHash } });
              });
            }
            setSelection(null);
          }}
        />
      )}
    </div>
  );
}
