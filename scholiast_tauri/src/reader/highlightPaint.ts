/*
 * Paint saved text highlights over the rendered article (task 29, plan §6.9).
 *
 * Resolution order per highlight: stored structural anchor first (xpath +
 * offsets, verified against the quote by `resolveAnchor`), then the portable
 * text-quote anchor (exact → whitespace-insensitive → fuzzy), else "unplaced".
 *
 * Native rendering uses the CSS Custom Highlight API with one registry per
 * color (`sc-hl-yellow|red|green`, styled in highlight-overlays.css). When the
 * API is missing (older WebKitGTK, jsdom), the same ranges are wrapped in
 * `<mark class="sc-hl sc-hl-<color>" data-sc-hl="<id>">` spans behind an
 * identical call surface.
 */

import {
  buildTextMap,
  resolveAnchor,
  toDomRange,
} from "../lib/anchor/anchor";
import type { AnnotationAnchor } from "../lib/anchor/anchor";

export type HighlightColor = "yellow" | "red" | "green";

const COLORS: readonly HighlightColor[] = ["yellow", "red", "green"];

/** The subset of the stored highlight this painter consumes. */
export interface HighlightForPaint {
  id: string;
  type?: string;
  color?: string | null;
  content?: string;
  xpath?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  anchor?: unknown;
}

export interface PaintStats {
  placed: string[];
  unplaced: string[];
}

// ---------------------------------------------------------------------------
// CSS Custom Highlight API feature detection (structural, cast-free)
// ---------------------------------------------------------------------------

interface StaticHighlight {
  new (...ranges: Range[]): unknown;
}
interface HighlightRegistryLike {
  set(name: string, highlight: unknown): unknown;
  delete(name: string): unknown;
}
interface CssWithHighlights {
  Highlight?: StaticHighlight;
  highlights?: HighlightRegistryLike;
}

function nativeHighlight(): { Ctor: StaticHighlight; registry: HighlightRegistryLike } | null {
  const css = (globalThis as { CSS?: CssWithHighlights }).CSS;
  if (css?.highlights && css.Highlight) return { Ctor: css.Highlight, registry: css.highlights };
  return null;
}

export function supportsHighlightApi(): boolean {
  return nativeHighlight() !== null;
}

export function registryName(color: HighlightColor): string {
  return `sc-hl-${color}`;
}

function colorToken(color: string | null | undefined): HighlightColor {
  return COLORS.includes(color as HighlightColor) ? (color as HighlightColor) : "yellow";
}

// ---------------------------------------------------------------------------
// Module state: one active article at a time
// ---------------------------------------------------------------------------

const painted = new Map<string, { range: Range; color: HighlightColor }>();
const activeRegistries = new Set<string>();
let activeRoot: HTMLElement | null = null;
let frame: number | null = null;

export function findHighlightRange(id: string): Range | null {
  return painted.get(id)?.range ?? null;
}

export function paintedHighlightIds(): string[] {
  return Array.from(painted.keys());
}

// ---------------------------------------------------------------------------
// Stored shape → golden anchor
// ---------------------------------------------------------------------------

/**
 * Rebuild a resolvable {@link AnnotationAnchor} from the stored fields:
 * the portable anchor when present, else the legacy top-level xpath+offsets
 * (offsets index into the xpath element's own text), else bare content.
 */
export function storedToAnchor(hl: HighlightForPaint): AnnotationAnchor | null {
  const stored = hl.anchor as AnnotationAnchor | null | undefined;
  if (
    stored &&
    typeof stored.quote?.quote === "string" &&
    stored.quote.quote.length > 0
  ) {
    return stored;
  }
  if (
    typeof hl.xpath === "string" &&
    hl.xpath.length > 0 &&
    typeof hl.startOffset === "number" &&
    typeof hl.endOffset === "number"
  ) {
    return {
      quote: { quote: hl.content ?? "", prefix: "", suffix: "", occurrence: 0 },
      structural: {
        surface: "web",
        xpath: hl.xpath,
        startOffset: hl.startOffset,
        endOffset: hl.endOffset,
      },
    };
  }
  if (hl.content) {
    return { quote: { quote: hl.content, prefix: "", suffix: "", occurrence: 0 } };
  }
  return null;
}

function isImageAnnotation(hl: HighlightForPaint): boolean {
  if (hl.type === "element") return true;
  const anchor = hl.anchor as { image?: { src?: unknown } } | null | undefined;
  return typeof anchor?.image?.src === "string";
}

// ---------------------------------------------------------------------------
// Fallback <mark> wrapping
// ---------------------------------------------------------------------------

function wrapRange(doc: Document, range: Range, id: string, color: HighlightColor): void {
  const ancestor =
    range.commonAncestorContainer.nodeType === 1
      ? (range.commonAncestorContainer as Element)
      : range.commonAncestorContainer.parentNode;
  if (!ancestor) return;
  const walker = doc.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("mark[data-sc-hl]")
        ? NodeFilter.FILTER_REJECT
        : range.intersectsNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);

  for (const node of nodes) {
    let start = 0;
    let end = node.data.length;
    if (node === range.startContainer) start = Math.min(range.startOffset, end);
    if (node === range.endContainer) end = Math.min(range.endOffset, node.data.length);
    if (start >= end) continue;
    // Isolate [start, end): splitText returns the TAIL node, so split the
    // tail off without reassigning (head keeps our range), then split the
    // head open — its remainder is exactly the slice to wrap.
    let target: Text = node;
    if (end < target.data.length) target.splitText(end);
    if (start > 0) target = target.splitText(start);
    const mark = doc.createElement("mark");
    mark.className = `sc-hl sc-hl-${color}`;
    mark.setAttribute("data-sc-hl", id);
    if (target.parentNode) {
      target.parentNode.insertBefore(mark, target);
      mark.appendChild(target);
    }
  }
}

function unwrapMarks(root: HTMLElement): void {
  const marks = root.querySelectorAll("mark[data-sc-hl]");
  if (marks.length === 0) return;
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove();
    parent.normalize();
  });
}

// ---------------------------------------------------------------------------
// Paint / unpaint / dispose
// ---------------------------------------------------------------------------

/**
 * Resolve every highlight against `root` and apply the result. Idempotent:
 * clears any previous paint for this module first. The root's concatenated
 * text is walked once and shared across all quote resolutions.
 */
export function paint(
  root: HTMLElement,
  highlights: readonly HighlightForPaint[],
): PaintStats {
  const doc = root.ownerDocument;
  unpaint(root);
  activeRoot = root;

  const stats: PaintStats = { placed: [], unplaced: [] };
  const rootText = buildTextMap(root).text;
  const byColor = new Map<HighlightColor, Range[]>(COLORS.map((c) => [c, []]));

  for (const hl of highlights) {
    if (!hl || typeof hl.id !== "string") continue;
    if (isImageAnnotation(hl)) continue;
    const anchor = storedToAnchor(hl);
    const resolved = anchor ? resolveAnchor(anchor, root, "web", rootText) : null;
    if (!resolved) {
      stats.unplaced.push(hl.id);
      continue;
    }
    const color = colorToken(hl.color);
    const domRange = toDomRange(resolved, doc);
    painted.set(hl.id, { range: domRange, color });
    byColor.get(color)?.push(domRange);
    stats.placed.push(hl.id);
  }

  const native = nativeHighlight();
  if (native) {
    for (const [color, ranges] of byColor) {
      if (ranges.length === 0) continue;
      const name = registryName(color);
      native.registry.set(name, new native.Ctor(...ranges));
      activeRegistries.add(name);
    }
  } else {
    for (const [id, { range, color }] of painted) {
      try {
        wrapRange(doc, range, id, color);
      } catch {
        // A stale range (content swapped mid-paint) must not break the pass.
      }
    }
  }
  return stats;
}

/** Remove every paint this module applied under `root` and drop registrations. */
function unpaint(root: HTMLElement): void {
  if (supportsHighlightApi()) {
    const registry = nativeHighlight()?.registry;
    for (const name of activeRegistries) registry?.delete(name);
  } else {
    unwrapMarks(root);
  }
  activeRegistries.clear();
  painted.clear();
}

/** Cancel any pending scheduled frame and forget all state. */
export function dispose(): void {
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  if (activeRoot) unpaint(activeRoot);
  activeRoot = null;
}

/**
 * rAF-coalesced repaint pass. Root and highlights are read lazily at frame
 * time so callers can pass refs/getters capturing fresh values. Returns a
 * cancel function; scheduling again replaces the pending frame.
 */
export function schedulePaint(
  getRoot: () => HTMLElement | null,
  getHighlights: () => readonly HighlightForPaint[],
  onDone?: (stats: PaintStats) => void,
): () => void {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = null;
    const root = getRoot();
    if (!root) return;
    const stats = paint(root, getHighlights());
    onDone?.(stats);
  });
  return () => {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  };
}
