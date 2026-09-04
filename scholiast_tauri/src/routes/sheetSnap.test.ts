import { describe, expect, test } from "vitest";
import { beginSheetDrag, moveSheetDrag, releaseSheetHeight, sheetHeights, snapSheet } from "./sheetSnap";

describe("snapSheet", () => {
  test("tiny heights close", () => {
    expect(snapSheet(0, 800)).toBe("closed");
    expect(snapSheet(90, 800)).toBe("closed");
  });

  test("settles to the nearest snap", () => {
    expect(snapSheet(160, 800)).toBe("peek");
    expect(snapSheet(300, 800)).toBe("half");
    expect(snapSheet(600, 800)).toBe("expanded");
  });

  test("upward fling shifts one step up", () => {
    expect(snapSheet(300, 800, -1)).toBe("expanded");
    expect(snapSheet(160, 800, -2)).toBe("half");
  });

  test("downward fling shifts one step down", () => {
    expect(snapSheet(400, 800, 1)).toBe("peek");
    expect(snapSheet(160, 800, 2)).toBe("closed");
  });

  test("flings clamp at the ends", () => {
    expect(snapSheet(600, 800, -5)).toBe("expanded");
    expect(snapSheet(160, 800, 5)).toBe("closed");
  });

  test("sheetHeights follows viewport shares", () => {
    expect(sheetHeights(1000)).toEqual({ closed: 0, peek: 200, half: 500, expanded: 700 });
  });

  test("drag tracks live height, velocity, and clamps", () => {
    const track = beginSheetDrag(700, 0);
    expect(track.moved).toBe(false);
    expect(moveSheetDrag(track, 500, 800, 100)).toBe(300);
    expect(track.moved).toBe(true);
    expect(track.velocityY).toBeCloseTo(-2, 5);
    expect(moveSheetDrag(track, 100, 800, 200)).toBe(600);
    expect(moveSheetDrag(track, 900, 800, 300)).toBe(0);
    expect(releaseSheetHeight(400, 800)).toBe(400);
  });
});
