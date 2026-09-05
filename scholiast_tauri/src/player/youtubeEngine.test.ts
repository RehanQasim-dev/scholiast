import { beforeEach, describe, expect, test, vi } from "vitest";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Innertube } from "youtubei.js";
import { getPoToken } from "./poToken";
import {
  fetchCaptionVtt,
  resetEngineForTests,
  resolveManifest,
} from "./youtubeEngine";

vi.mock("./poToken", () => ({
  getPoToken: vi.fn(async () => null),
  coldStartPoToken: (videoId: string) => `cold-${videoId}`,
}));

vi.mock("youtubei.js", () => ({
  Platform: { shim: {} },
  Innertube: { create: vi.fn() },
  UniversalCache: class {},
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

const createMock = vi.mocked(Innertube.create);
const tauriFetchMock = vi.mocked(tauriFetch);
const getPoTokenMock = vi.mocked(getPoToken);

function sessionWithFormat() {
  return {
    session: { player: {} },
    getBasicInfo: vi.fn(async () => ({
      playability_status: { status: "OK", reason: "" },
      basic_info: { id: "dQw4w9WgXcQ", title: "T", duration: 60 },
      streaming_data: {
        formats: [
          {
            itag: 18,
            mime_type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
            has_audio: true,
            has_video: true,
            url: "https://r1---sn.googlevideo.com/v?x",
            decipher: async () => null,
          },
        ],
        adaptive_formats: [],
      },
      captions: { caption_tracks: [] },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetEngineForTests();
});

describe("youtubeEngine transport", () => {
  test("Innertube sessions run on the Rust-side fetch (WebView CORS bypass)", async () => {
    createMock.mockResolvedValue(sessionWithFormat() as never);

    const manifest = await resolveManifest("dQw4w9WgXcQ");

    expect(manifest.streams).toHaveLength(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ fetch: tauriFetchMock }),
    );
  });

  test("caption downloads ride the same Rust-side fetch", async () => {
    tauriFetchMock.mockResolvedValue({
      ok: true,
      text: async () => "WEBVTT\n\n00:00.000 --> 00:01.000\nhi",
    } as Response);

    const vtt = await fetchCaptionVtt("https://www.youtube.com/api/timedtext?v=x");

    expect(tauriFetchMock).toHaveBeenCalledWith(
      expect.stringContaining("&fmt=vtt"),
    );
    expect(vtt).toContain("WEBVTT");
  });

  test("attested resolves attach po_token to the player request and segments", async () => {
    const session = sessionWithFormat();
    createMock.mockResolvedValue(session as never);
    getPoTokenMock.mockResolvedValue("po-test-token");

    await resolveManifest("dQw4w9WgXcQ");

    expect(getPoTokenMock).toHaveBeenCalledWith("dQw4w9WgXcQ");
    expect(session.getBasicInfo).toHaveBeenCalledWith(
      "dQw4w9WgXcQ",
      expect.objectContaining({ po_token: "po-test-token" }),
    );
    // v18 reads player.po_token at decipher time for the `pot` segment param.
    expect(session.session.player).toMatchObject({ po_token: "po-test-token" });
  });

  test("unattested resolves still carry a cold-start token floor", async () => {
    const session = sessionWithFormat();
    createMock.mockResolvedValue(session as never);
    getPoTokenMock.mockResolvedValue(null);

    await resolveManifest("dQw4w9WgXcQ");

    const calls = vi.mocked(session.getBasicInfo).mock.calls as unknown as Array<
      [string, { client?: string; po_token?: string }]
    >;
    // calls[0] is the bare iOS HLS pre-request; the attested player request
    // follows it.
    const opts = calls.find(([, o]) => o?.client !== "IOS")?.[1];
    expect(opts?.po_token).toBeTruthy();
    expect(session.session.player).toMatchObject({ po_token: opts?.po_token });
  });

  test("resolves the iOS HLS URL for the HD path", async () => {
    const session = sessionWithFormat();
    createMock.mockResolvedValue(session as never);
    getPoTokenMock.mockResolvedValue(null);
    const vision = await (
      vi.mocked(session.getBasicInfo) as unknown as (
        id: string,
      ) => Promise<unknown>
    )("dQw4w9WgXcQ");
    vi.mocked(session.getBasicInfo).mockImplementation((async (
      ...args: unknown[]
    ) => {
      const opts = args[1] as { client?: string } | undefined;
      if (opts?.client === "IOS") {
        return {
          streaming_data: { hls_manifest_url: "https://hls/x.m3u8" },
        };
      }
      return vision;
    }) as never);

    const manifest = await resolveManifest("dQw4w9WgXcQ");

    expect(manifest.iosHlsUrl).toBe("https://hls/x.m3u8");
  });
});
