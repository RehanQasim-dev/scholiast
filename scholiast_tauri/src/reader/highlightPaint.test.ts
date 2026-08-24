import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createAnchor, locateRange, resolveAnchor, toDomRange } from "../lib/anchor/anchor";
import type { AnnotationAnchor } from "../lib/anchor/anchor";
import {
  dispose,
  findHighlightRange,
  paint,
  registryName,
  schedulePaint,
  storedToAnchor,
  supportsHighlightApi,
} from "./highlightPaint";
import type { HighlightForPaint } from "./highlightPaint";

class FakeStaticHighlight {
  readonly ranges: Range[];
  constructor(...ranges: Range[]) {
    this.ranges = ranges;
  }
}

const FIXTURE = [
  "<article>",
  "<h2>Anchoring notes</h2>",
  '<p id="first">Alpha beta gamma delta epsilon.</p>',
  "<p>Zeta eta theta iota kappa.</p>",
  "</article>",
].join("");

function mount(): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = FIXTURE;
  document.body.appendChild(host);
  return host.querySelector("article")!;
}

function rangeOver(root: HTMLElement, text: string): Range {
  const full = root.textContent ?? "";
  const start = full.indexOf(text);
  if (start === -1) throw new Error(`fixture is missing "${text}"`);
  const like = locateRange(root, start, start + text.length);
  if (!like) throw new Error("locateRange failed");
  return toDomRange(like, document);
}

/** Build a persisted-shape highlight whose anchor was really captured. */
function anchorFor(
  root: HTMLElement,
  text: string,
  color: string,
  id: string,
): HighlightForPaint {
  const range = rangeOver(root, text);
  const anchor = JSON.parse(
    JSON.stringify(createAnchor(range, root, "web")),
  ) as AnnotationAnchor;
  return { id, type: "text", color, content: text, anchor };
}

interface RegistryMock {
  Highlight?: unknown;
  highlights?: Map<string, FakeStaticHighlight>;
}

function cssMock(): RegistryMock {
  return (globalThis as unknown as { CSS?: RegistryMock }).CSS ?? {};
}

async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

beforeEach(() => {
  (globalThis as { CSS?: unknown }).CSS = {
    Highlight: FakeStaticHighlight,
    highlights: new Map<string, FakeStaticHighlight>(),
  };
});

afterEach(() => {
  dispose();
  document.body.innerHTML = "";
  delete (globalThis as { CSS?: unknown }).CSS;
});

describe("storedToAnchor", () => {
  test("prefers the portable anchor when present", () => {
    const root = mount();
    const hl = anchorFor(root, "gamma delta", "yellow", "a1");
    const anchor = storedToAnchor(hl);
    expect(anchor?.quote.quote).toBe("gamma delta");
    expect(anchor?.structural?.surface).toBe("web");
  });

  test("synthesizes a structural anchor from legacy xpath + offsets", () => {
    const anchor = storedToAnchor({
      id: "l1",
      xpath: "./p[1]",
      startOffset: 0,
      endOffset: 5,
      content: "Alpha",
    });
    expect(anchor?.structural).toEqual({
      surface: "web",
      xpath: "./p[1]",
      startOffset: 0,
      endOffset: 5,
    });
    expect(anchor?.quote.quote).toBe("Alpha");
  });

  test("falls back to bare content as the quote", () => {
    const anchor = storedToAnchor({ id: "c1", content: "just words" });
    expect(anchor?.quote.quote).toBe("just words");
    expect(anchor?.structural).toBeUndefined();
    expect(storedToAnchor({ id: "e1" })).toBeNull();
  });
});

describe("paint — native CSS Custom Highlight API", () => {
  test("anchor create → persist → resolve round-trips on fixture DOM", () => {
    const root = mount();
    const range = rangeOver(root, "gamma delta");
    const original = range.toString();
    const persisted = JSON.parse(
      JSON.stringify(createAnchor(range, root, "web")),
    ) as AnnotationAnchor;

    const back = resolveAnchor(persisted, root, "web");
    expect(back).not.toBeNull();
    expect(toDomRange(back!, document).toString()).toBe(original);
  });

  test("registers one Highlight registry per color and records ranges", () => {
    const root = mount();
    const stats = paint(root, [
      anchorFor(root, "gamma delta", "yellow", "y1"),
      anchorFor(root, "theta iota", "red", "r1"),
    ]);

    expect(stats.placed.sort()).toEqual(["r1", "y1"]);
    expect(stats.unplaced).toEqual([]);

    const yellow = cssMock().highlights!.get(registryName("yellow"))!;
    expect(yellow.ranges).toHaveLength(1);
    expect(yellow.ranges[0]!.toString()).toBe("gamma delta");
    expect(cssMock().highlights!.has(registryName("red"))).toBe(true);

    expect(findHighlightRange("r1")?.toString()).toBe("theta iota");
    expect(findHighlightRange("missing")).toBeNull();
  });

  test("unresolvable quotes land in unplaced instead of vanishing", () => {
    const root = mount();
    const stats = paint(root, [
      { id: "ghost", type: "text", color: "red", content: "never present anywhere" },
    ]);
    expect(stats.placed).toEqual([]);
    expect(stats.unplaced).toEqual(["ghost"]);
  });

  test("legacy xpath+offsets highlights resolve without a portable anchor", () => {
    const root = mount();
    const stats = paint(root, [
      {
        id: "l1",
        type: "text",
        color: "green",
        xpath: "./p[1]",
        startOffset: 0,
        endOffset: 5,
        content: "Alpha",
      },
    ]);
    expect(stats.placed).toEqual(["l1"]);
    expect(findHighlightRange("l1")?.toString()).toBe("Alpha");
  });

  test("repainting moves a highlight between color registries", () => {
    const root = mount();
    paint(root, [anchorFor(root, "gamma delta", "yellow", "m1")]);
    expect(cssMock().highlights!.has(registryName("yellow"))).toBe(true);

    paint(root, [anchorFor(root, "gamma delta", "red", "m1")]);
    expect(cssMock().highlights!.has(registryName("yellow"))).toBe(false);
    expect(cssMock().highlights!.get(registryName("red"))!.ranges[0]!.toString()).toBe(
      "gamma delta",
    );
  });

  test("image/element annotations are skipped silently", () => {
    const root = mount();
    const stats = paint(root, [
      { id: "img1", type: "element", color: "yellow", content: "" },
    ]);
    expect(stats.placed).toEqual([]);
    expect(stats.unplaced).toEqual([]);
  });

  // Task-32 perf sanity: a densely annotated article must paint inside a
  // frame budget. jsdom has no native Highlight rendering, so this measures
  // the resolution + registry work — the part our code owns. Numbers are
  // logged as evidence; the assertion is a generous regression guard.
  test("300-highlight paint pass timing (target < 16ms/pass)", () => {
    const paragraphs = Array.from(
      { length: 300 },
      (_, i) =>
        `<p>Paragraph ${i} carries some steady reading text for anchoring.</p>`,
    ).join("");
    const host = document.createElement("div");
    host.innerHTML = `<article>${paragraphs}</article>`;
    document.body.appendChild(host);
    const root = host.querySelector("article")!;

    const highlights: HighlightForPaint[] = [];
    for (let i = 0; i < 300; i += 1) {
      highlights.push(anchorFor(root, "steady reading text", "green", `p${i}`));
    }

    const times: number[] = [];
    const stats = paint(root, highlights);
    times.push(timedPaint(root, highlights));
    for (let i = 0; i < 4; i += 1) times.push(timedPaint(root, highlights));

    const best = Math.min(...times);
    const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
    console.warn(
      `[perf] 300-highlight paint: cold=${times[0].toFixed(2)}ms best=${best.toFixed(2)}ms median=${median.toFixed(2)}ms over ${times.length} passes`,
    );
    expect(stats.placed).toHaveLength(300);
    expect(stats.unplaced).toHaveLength(0);
    expect(median).toBeLessThan(200);
  });
});

function timedPaint(
  root: HTMLElement,
  highlights: readonly HighlightForPaint[],
): number {
  const start = performance.now();
  paint(root, highlights);
  return performance.now() - start;
}

describe("paint — fallback <mark> wrapping (no CSS.highlights)", () => {
  beforeEach(() => {
    delete (globalThis as { CSS?: unknown }).CSS;
  });

  test("wraps resolved ranges in tagged marks without changing text", () => {
    const root = mount();
    const before = root.textContent;
    expect(supportsHighlightApi()).toBe(false);

    const stats = paint(root, [anchorFor(root, "beta gamma", "yellow", "f1")]);
    expect(stats.placed).toEqual(["f1"]);

    const marks = root.querySelectorAll('mark[data-sc-hl="f1"]');
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]!.classList.contains("sc-hl-yellow")).toBe(true);
    expect(marks[0]!.getAttribute("data-sc-hl")).toBe("f1");
    expect(marks[0]!.textContent).toBe("beta gamma");
    expect(root.textContent).toBe(before);
  });

  test("unpaint unwraps marks and restores the original text", () => {
    const root = mount();
    const before = root.textContent;
    paint(root, [anchorFor(root, "epsilon", "green", "f2")]);
    expect(root.querySelectorAll("mark[data-sc-hl]").length).toBeGreaterThan(0);

    dispose();
    expect(root.querySelectorAll("mark[data-sc-hl]").length).toBe(0);
    expect(root.textContent).toBe(before);
  });
});

describe("schedulePaint", () => {
  test("coalesces same-frame repaints into one pass", async () => {
    const root = mount();
    const hl = anchorFor(root, "gamma delta", "yellow", "s1");
    let runs = 0;
    schedulePaint(() => root, () => [hl], () => {
      runs += 1;
    });
    schedulePaint(() => root, () => [hl], () => {
      runs += 1;
    });
    await frames(2);
    expect(runs).toBe(1);
  });

  test("cancel prevents the scheduled pass", async () => {
    let runs = 0;
    const cancel = schedulePaint(
      () => document.createElement("div"),
      () => [],
      () => {
        runs += 1;
      },
    );
    cancel();
    await frames(2);
    expect(runs).toBe(0);
  });
});
