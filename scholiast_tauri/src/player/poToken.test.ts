import { beforeEach, describe, expect, test, vi } from "vitest";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { getPoToken, resetPoTokenForTests } from "./poToken";

vi.mock("bgutils-js/botguard", () => ({
  getChallenge: vi.fn(),
  BotGuardClient: { create: vi.fn() },
}));

vi.mock("bgutils-js/webpo", () => ({
  WebPoMinter: { create: vi.fn() },
}));

vi.mock("bgutils-js/utils", () => ({
  GOOG_API_KEY: "test-key",
  buildURL: (endpoint: string) => `https://jnn-pa.googleapis.com/${endpoint}`,
  getHeaders: () => ({}),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

const getChallengeMock = vi.mocked(getChallenge);
const createClientMock = vi.mocked(BotGuardClient.create);
const createMinterMock = vi.mocked(WebPoMinter.create);
const tauriFetchMock = vi.mocked(tauriFetch);

function attestedWorld() {
  getChallengeMock.mockResolvedValue({
    program: "program-js",
    globalName: "global-name",
    interpreterHash: "hash-1",
    interpreterJavascript: {
      privateDoNotAccessOrElseSafeScriptWrappedValue: "void 0;",
    },
  } as never);
  createClientMock.mockResolvedValue({
    snapshot: async () => "botguard-response",
  } as never);
  tauriFetchMock.mockResolvedValue({
    ok: true,
    json: async () => ["integrity-token", 3600, 0, null],
  } as never);
  createMinterMock.mockResolvedValue({
    mintAsWebsafeString: async (id: string) => `po-${id}`,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPoTokenForTests();
});

describe("poToken attestation", () => {
  test("mints a content-bound token per video, attesting once", async () => {
    attestedWorld();

    await expect(getPoToken("vid-1")).resolves.toBe("po-vid-1");
    await expect(getPoToken("vid-2")).resolves.toBe("po-vid-2");

    expect(getChallengeMock).toHaveBeenCalledTimes(1);
    expect(tauriFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("GenerateIT"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("challenge failure degrades to null (unattested playback)", async () => {
    getChallengeMock.mockRejectedValue(new Error("rotated key?"));

    await expect(getPoToken("vid-1")).resolves.toBeNull();
    expect(createMinterMock).not.toHaveBeenCalled();
  });

  test("fallback-only GenerateIT answer is rejected, not used", async () => {
    attestedWorld();
    tauriFetchMock.mockResolvedValue({
      ok: true,
      json: async () => [null, 0, 0, "websafe-fallback"],
    } as never);

    await expect(getPoToken("vid-1")).resolves.toBeNull();
    expect(createMinterMock).not.toHaveBeenCalled();
  });
});
