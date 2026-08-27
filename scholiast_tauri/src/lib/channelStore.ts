const CHANNELS_KEY = "scholiast.video_channels";

export function getCachedChannels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function setCachedChannel(videoId: string, author: string): void {
  if (!videoId || !author) return;
  try {
    const map = getCachedChannels();
    map[videoId] = author;
    localStorage.setItem(CHANNELS_KEY, JSON.stringify(map));
  } catch {
    /* ignore storage quota/parse errors */
  }
}

export async function resolveChannelForVideo(videoId: string): Promise<string> {
  if (!videoId) return "YouTube";
  const cached = getCachedChannels()[videoId];
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { author_name?: string };
      if (data.author_name) {
        setCachedChannel(videoId, data.author_name);
        return data.author_name;
      }
    }
  } catch {
    /* fallback to official oembed */
  }

  try {
    const res2 = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`,
    );
    if (res2.ok) {
      const data2 = (await res2.json()) as { author_name?: string };
      if (data2.author_name) {
        setCachedChannel(videoId, data2.author_name);
        return data2.author_name;
      }
    }
  } catch {
    /* network error / offline */
  }

  return "YouTube";
}

export function getDomainFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "Web";
  }
}
