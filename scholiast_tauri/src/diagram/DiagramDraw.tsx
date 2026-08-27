import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  Diamond,
  Eraser,
  Minus,
  MousePointer,
  Pencil,
  Redo2,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import {
  Excalidraw,
  exportToBlob,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { toast } from "../components/Toast";
import { getDiagramItem, saveDiagramItem } from "../lib/readerIpc";
import { getPref, PREF_KEYS } from "../lib/store";

type ExcalidrawOnChange = NonNullable<
  React.ComponentProps<typeof Excalidraw>["onChange"]
>;
type SceneElements = Parameters<ExcalidrawOnChange>[0];
type SceneAppState = Parameters<ExcalidrawOnChange>[1];

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export default function DiagramDraw() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const urlHash = (location.state?.urlHash as string) || params.get("h") || undefined;
  const highlightId = (location.state?.highlightId as string) || params.get("hl") || undefined;
  const diagramId = (location.state?.diagramId as string) || params.get("d") || undefined;

  const [saving, setSaving] = useState(false);
  const [mathModalOpen, setMathModalOpen] = useState(false);
  const [mathFormula, setMathFormula] = useState("");
  const [activeTool, setActiveTool] = useState<string>("freedraw");

  // Excalidraw API ref
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const excalidrawApiRef = useRef<any>(null);
  const elementsRef = useRef<SceneElements>([]);
  const appStateRef = useRef<SceneAppState | null>(null);
  const filesRef = useRef<BinaryFiles>({});

  const [initialData, setInitialData] = useState<{
    elements?: SceneElements;
    appState?: Partial<SceneAppState>;
    files?: BinaryFiles;
  } | null>(null);

  // Load existing diagram if diagramId provided
  useEffect(() => {
    if (!diagramId) return;
    void getDiagramItem({ id: diagramId }).then((res) => {
      if (!res?.sceneJson) return;
      try {
        const scene = JSON.parse(res.sceneJson);
        setInitialData(scene);
      } catch {
        /* ignore */
      }
    });
  }, [diagramId]);

  // Load roughness / grid preferences from settings
  useEffect(() => {
    void Promise.all([
      getPref<number>(PREF_KEYS.excalidrawRoughness, 1),
      getPref<string>(PREF_KEYS.excalidrawGrid, "dots"),
    ]).then(([roughness, grid]) => {
      if (excalidrawApiRef.current) {
        excalidrawApiRef.current.updateScene({
          appState: {
            roughness,
            gridSize: grid === "none" ? null : 20,
          },
        });
      }
    });
  }, []);

  const handleChange: ExcalidrawOnChange = (elements, appState, files) => {
    elementsRef.current = elements;
    appStateRef.current = appState;
    filesRef.current = files;
  };

  const handleSave = useCallback(async () => {
    if (elementsRef.current.length === 0) {
      toast("Canvas is empty — draw or add shapes first.");
      return;
    }
    setSaving(true);
    try {
      const blob = await exportToBlob({
        elements: elementsRef.current,
        appState: appStateRef.current as never,
        files: filesRef.current,
        mimeType: "image/png",
      });
      const pngBase64 = await blobToBase64(blob);
      const sceneJson = serializeAsJSON(
        elementsRef.current,
        appStateRef.current as never,
        filesRef.current,
        "local",
      );

      await saveDiagramItem({
        id: diagramId,
        pageUrlHash: urlHash,
        highlightId,
        sceneJson,
        pngBase64,
      });

      toast("Diagram saved successfully");
      navigate(-1);
    } catch {
      toast("Couldn't save diagram.");
    } finally {
      setSaving(false);
    }
  }, [diagramId, highlightId, navigate, urlHash]);

  const selectTool = (toolName: string) => {
    setActiveTool(toolName);
    if (!excalidrawApiRef.current) return;
    excalidrawApiRef.current.setActiveTool({ type: toolName });
  };

  const insertMathFormula = () => {
    if (!mathFormula.trim() || !excalidrawApiRef.current) return;
    // Add text element with formula
    const newElement = {
      type: "text",
      text: mathFormula,
      fontSize: 24,
      fontFamily: 3, // Monospace / Math
      textAlign: "center",
      verticalAlign: "middle",
      x: 200,
      y: 200,
      width: mathFormula.length * 15,
      height: 40,
      strokeColor: "#2f9e62",
    };
    excalidrawApiRef.current.updateScene({
      elements: [...elementsRef.current, newElement],
    });
    setMathModalOpen(false);
    setMathFormula("");
    toast("Math formula inserted");
  };

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#070d0a]">
      {/* Top Header Bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-hairline bg-surface px-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-2 hover:bg-elevated hover:text-text"
          >
            <ArrowLeft size={18} strokeWidth={2} />
          </button>
          <span className="text-xs font-semibold uppercase tracking-wider text-text">
            Visual Diagram
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Undo"
            onClick={() => excalidrawApiRef.current?.history?.undo()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-2 hover:bg-elevated hover:text-text"
          >
            <Undo2 size={16} strokeWidth={2} />
          </button>
          <button
            type="button"
            aria-label="Redo"
            onClick={() => excalidrawApiRef.current?.history?.redo()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-text-2 hover:bg-elevated hover:text-text"
          >
            <Redo2 size={16} strokeWidth={2} />
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-8 items-center gap-1.5 rounded-full bg-accent px-3.5 text-xs font-semibold text-[var(--sc-accent-text)] shadow-md transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check size={14} strokeWidth={2.5} />
            <span>{saving ? "Saving…" : "Save Diagram"}</span>
          </button>
        </div>
      </header>

      {/* Main Excalidraw Canvas */}
      <div className="relative flex-1 overflow-hidden">
        <Excalidraw
          excalidrawAPI={(api) => {
            excalidrawApiRef.current = api;
          }}
          initialData={initialData ?? {
            appState: {
              viewBackgroundColor: "#070d0a",
              theme: "dark",
            },
          }}
          onChange={handleChange}
          theme="dark"
        />

        {/* Mobile Zen Mode Floating Bottom Thumb Dock */}
        <div className="pointer-events-none absolute bottom-4 left-0 right-0 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-hairline bg-surface/90 p-1.5 shadow-2xl backdrop-blur-lg">
            {[
              { id: "selection", icon: MousePointer, title: "Select" },
              { id: "rectangle", icon: Square, title: "Rectangle" },
              { id: "diamond", icon: Diamond, title: "Diamond" },
              { id: "ellipse", icon: Circle, title: "Circle" },
              { id: "arrow", icon: ArrowRight, title: "Arrow" },
              { id: "line", icon: Minus, title: "Line" },
              { id: "freedraw", icon: Pencil, title: "Pen / Stylus" },
              { id: "text", icon: Type, title: "Text" },
              { id: "eraser", icon: Eraser, title: "Eraser" },
            ].map((tool) => {
              const Icon = tool.icon;
              const active = activeTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  title={tool.title}
                  onClick={() => selectTool(tool.id)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                    active
                      ? "bg-accent text-[var(--sc-accent-text)] shadow-sm"
                      : "text-text-2 hover:bg-elevated hover:text-text"
                  }`}
                >
                  <Icon size={16} strokeWidth={2} />
                </button>
              );
            })}

            {/* MathJax / Formula Input Button */}
            <button
              type="button"
              title="Insert Math/LaTeX Formula"
              onClick={() => setMathModalOpen(true)}
              className="flex h-9 items-center rounded-full px-2.5 font-serif text-sm font-semibold text-text-2 transition-colors hover:bg-elevated hover:text-text"
            >
              $\sum$
            </button>
          </div>
        </div>
      </div>

      {/* Math/LaTeX Formula Modal */}
      {mathModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-hairline bg-surface p-5 shadow-2xl">
            <h2 className="text-sm font-semibold text-text">Insert Math / LaTeX Formula</h2>
            <p className="mt-1 text-xs text-text-2">
              Type standard LaTeX equation or click symbols to build.
            </p>

            <textarea
              autoFocus
              value={mathFormula}
              onChange={(e) => setMathFormula(e.target.value)}
              placeholder="e.g. \int_{0}^{\infty} e^{-x^2} dx = \frac{\sqrt{\pi}}{2}"
              rows={3}
              className="mt-3 w-full rounded-md border border-hairline bg-base p-2.5 font-mono text-xs text-text placeholder-text-3 focus:border-accent focus:outline-none"
            />

            {/* Quick Math Symbols */}
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {[
                { label: "α", val: "\\alpha " },
                { label: "β", val: "\\beta " },
                { label: "θ", val: "\\theta " },
                { label: "π", val: "\\pi " },
                { label: "∑", val: "\\sum_{i=1}^{n} " },
                { label: "∫", val: "\\int_{a}^{b} " },
                { label: "a/b", val: "\\frac{a}{b} " },
                { label: "√x", val: "\\sqrt{x} " },
                { label: "x²", val: "x^2 " },
                { label: "≠", val: "\\neq " },
                { label: "≤", val: "\\le " },
                { label: "≥", val: "\\ge " },
              ].map((sym) => (
                <button
                  key={sym.label}
                  type="button"
                  onClick={() => setMathFormula((prev) => prev + sym.val)}
                  className="rounded border border-hairline bg-base px-2 py-1 text-xs text-text-2 hover:bg-elevated hover:text-text"
                >
                  {sym.label}
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setMathModalOpen(false);
                  setMathFormula("");
                }}
                className="rounded-md border border-hairline px-3 py-1.5 text-xs font-medium text-text-2 hover:bg-elevated hover:text-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={insertMathFormula}
                disabled={!mathFormula.trim()}
                className="rounded-md bg-accent px-4 py-1.5 text-xs font-semibold text-[var(--sc-accent-text)] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Insert on Canvas
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
