import { describe, expect, test } from "vitest";
import { getDarkReaderScript, SWIPE_SELECT_MESSAGE } from "./darkReaderScript";

describe("getDarkReaderScript iframe contract", () => {
  test("swipe-select handshake, touch engine and native bridge stay in sync", () => {
    const script = getDarkReaderScript("oled");
    expect(script).toContain(`'${SWIPE_SELECT_MESSAGE}'`);
    expect(script).toContain("touchstart");
    expect(script).toContain("setBaseAndExtent");
    expect(script).toContain("AndroidSelection");
    expect(script).toContain("TEXT_SELECTED");
  });
});
