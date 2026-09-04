import { describe, expect, test } from "vitest";
import {
  clampMarginWidth,
  layoutMarginColumn,
  MARGIN_CARD_GAP,
} from "./marginLayout";

describe("layoutMarginColumn", () => {
  test("empty input places nothing", () => {
    expect(layoutMarginColumn([])).toEqual([]);
  });

  test("single card sits on its anchor", () => {
    const [only] = layoutMarginColumn([{ key: "a", anchorTop: 100, height: 80 }]);
    expect(only.top).toBe(100);
  });

  test("overlapping anchors push later cards down with a gap", () => {
    const placed = layoutMarginColumn([
      { key: "a", anchorTop: 100, height: 80 },
      { key: "b", anchorTop: 120, height: 60 },
    ]);
    expect(placed[0]).toMatchObject({ key: "a", top: 100 });
    expect(placed[1]).toMatchObject({ key: "b", top: 100 + 80 + MARGIN_CARD_GAP });
  });

  test("spaced anchors keep document order and position", () => {
    const placed = layoutMarginColumn([
      { key: "b", anchorTop: 500, height: 60 },
      { key: "a", anchorTop: 100, height: 80 },
    ]);
    expect(placed.map((p) => p.key)).toEqual(["a", "b"]);
    expect(placed[1].top).toBe(500);
  });

  test("unplaced anchors stack last in input order", () => {
    const placed = layoutMarginColumn([
      { key: "u1", anchorTop: Number.POSITIVE_INFINITY, height: 50 },
      { key: "a", anchorTop: 100, height: 80 },
      { key: "u2", anchorTop: Number.POSITIVE_INFINITY, height: 50 },
    ]);
    expect(placed.map((p) => p.key)).toEqual(["a", "u1", "u2"]);
    expect(placed[1].top).toBe(100 + 80 + MARGIN_CARD_GAP);
    expect(placed[2].top).toBe(placed[1].top + 50 + MARGIN_CARD_GAP);
  });
});

describe("clampMarginWidth", () => {
  test("clamps to min, viewport share, and rounds", () => {
    expect(clampMarginWidth(100, 1200)).toBe(220);
    expect(clampMarginWidth(900, 1200)).toBe(540);
    expect(clampMarginWidth(333.4, 1200)).toBe(333);
    expect(clampMarginWidth(Number.NaN, 1200)).toBe(340);
  });
});
