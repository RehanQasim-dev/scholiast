import { describe, expect, test } from "vitest";
import { routeForSharedText } from "./deepLink";

describe("routeForSharedText", () => {
  test("routes shared YouTube video to Player", () => {
    const res = routeForSharedText("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(res).toBe("/player?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ");
  });

  test("routes youtu.be shortlinks to Player", () => {
    const res = routeForSharedText("Check this lecture: https://youtu.be/dQw4w9WgXcQ");
    expect(res).toBe("/player?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ");
  });

  test("routes non-YouTube web articles/blogs to Reader", () => {
    const res = routeForSharedText("https://paulgraham.com/greatwork.html");
    expect(res).toBe("/reader?url=https%3A%2F%2Fpaulgraham.com%2Fgreatwork.html");
  });

  test("routes scholiast://share deep-link intent to Reader", () => {
    const res = routeForSharedText("scholiast://share?url=https%3A%2F%2Fblog.samaltman.com%2Fidea");
    expect(res).toBe("/reader?url=https%3A%2F%2Fblog.samaltman.com%2Fidea");
  });

  test("returns null for text with no URL", () => {
    const res = routeForSharedText("just some text without any url");
    expect(res).toBeNull();
  });
});
