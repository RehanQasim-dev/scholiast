const CHANNELS_KEY = "scholiast.video_channels";
const TITLES_KEY = "scholiast.video_titles";

export function getCachedChannels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CHANNELS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function getCachedTitles(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TITLES_KEY);
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

function setCachedTitle(videoId: string, title: string): void {
  if (!videoId || !title) return;
  try {
    const map = getCachedTitles();
    map[videoId] = title;
    localStorage.setItem(TITLES_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export interface VideoMeta {
  author: string;
  title: string | null;
}

export async function resolveVideoMeta(videoId: string): Promise<VideoMeta> {
  if (!videoId) return { author: "YouTube", title: null };
  const cachedAuthor = getCachedChannels()[videoId];
  const cachedTitle = getCachedTitles()[videoId];
  if (cachedAuthor && cachedTitle) {
    return { author: cachedAuthor, title: cachedTitle };
  }

  let resolvedAuthor = cachedAuthor ?? "YouTube";
  let resolvedTitle = cachedTitle ?? null;

  try {
    const res = await fetch(
      `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { author_name?: string; title?: string };
      if (data.author_name) {
        resolvedAuthor = data.author_name;
        setCachedChannel(videoId, data.author_name);
      }
      if (data.title) {
        resolvedTitle = data.title;
        setCachedTitle(videoId, data.title);
      }
      if (data.author_name || data.title) {
        return { author: resolvedAuthor, title: resolvedTitle };
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
      const data2 = (await res2.json()) as { author_name?: string; title?: string };
      if (data2.author_name) {
        resolvedAuthor = data2.author_name;
        setCachedChannel(videoId, data2.author_name);
      }
      if (data2.title) {
        resolvedTitle = data2.title;
        setCachedTitle(videoId, data2.title);
      }
      return { author: resolvedAuthor, title: resolvedTitle };
    }
  } catch {
    /* network error / offline */
  }

  return { author: resolvedAuthor, title: resolvedTitle };
}

export async function resolveChannelForVideo(videoId: string): Promise<string> {
  const meta = await resolveVideoMeta(videoId);
  return meta.author;
}

export function getDomainFromUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "Web";
  }
}
