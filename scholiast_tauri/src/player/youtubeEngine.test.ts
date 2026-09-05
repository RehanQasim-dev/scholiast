import { beforeEach, describe, expect, test, vi } from "vitest";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Innertube } from "youtubei.js";
import {
  fetchCaptionVtt,
  resetEngineForTests,
  resolveManifest,
} from "./youtubeEngine";

vi.mock("youtubei.js", () => ({
  Platform: { shim: {} },
  Innertube: { create: vi.fn() },
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

const createMock = vi.mocked(Innertube.create);
const tauriFetchMock = vi.mocked(tauriFetch);

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
});
