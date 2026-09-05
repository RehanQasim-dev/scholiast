import { describe, expect, test } from "vitest";
import { choosePlayback, composeMime } from "./adaptiveEngine";
import type { StreamFormatView, StreamManifestView } from "../lib/readerIpc";

function stream(over: Partial<StreamFormatView> & { itag: number }): StreamFormatView {
  return {
    kind: "progressive",
    mime: "video/mp4",
    codecs: 'codecs="avc1"',
    url: "https://example.com/v",
    ...over,
  };
}

function manifest(streams: StreamFormatView[]): StreamManifestView {
  return { videoId: "v", streams, captions: [] };
}

describe("adaptiveEngine", () => {
  test("720p+ progressive plays directly", () => {
    const plan = choosePlayback(
      manifest([stream({ itag: 22, kind: "progressive", height: 720 })]),
    );
    expect(plan?.mode).toBe("progressive");
    expect(plan?.progressive?.itag).toBe(22);
  });

  test("adaptive-only picks ≤1080p video plus best audio", () => {
    const plan = choosePlayback(
      manifest([
        stream({ itag: 401, kind: "videoOnly", height: 2160, width: 3840, mime: "video/mp4", codecs: 'codecs="av01"' }),
        stream({ itag: 137, kind: "videoOnly", height: 1080, width: 1920 }),
        stream({ itag: 140, kind: "audio", mime: "audio/mp4", codecs: 'codecs="mp4a"', bitrate: 130000 }),
        stream({ itag: 249, kind: "audio", mime: "audio/webm", codecs: 'codecs="opus"', bitrate: 50000 }),
      ]),
    );
    expect(plan?.mode).toBe("adaptive");
    expect(plan?.video?.itag).toBe(137);
    expect(plan?.audio?.itag).toBe(140);
  });

  test("sub-720p progressive is the last resort; nothing is null", () => {
    const plan = choosePlayback(
      manifest([stream({ itag: 18, kind: "progressive", height: 360 })]),
    );
    expect(plan?.mode).toBe("progressive");
    expect(choosePlayback(manifest([]))).toBeNull();
  });

  test("composeMime builds the SourceBuffer recipe", () => {
    expect(composeMime(stream({ itag: 1 }))).toBe('video/mp4; codecs="avc1"');
  });
});
