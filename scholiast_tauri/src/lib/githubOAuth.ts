export interface GithubOAuthPayload {
  code: string;
  state: string;
}

const EVENT = "scholiast:github-oauth";

let pending: GithubOAuthPayload | null = null;

/** Deep-link callback URLs (`scholiast://oauth?code=..&state=..`). */
export function parseGithubOAuthCallback(raw: string): GithubOAuthPayload | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "scholiast:") return null;
  if (url.hostname !== "oauth" && !url.pathname.startsWith("/oauth")) return null;
  const code = url.searchParams.get("code") ?? "";
  if (!code) return null;
  return { code, state: url.searchParams.get("state") ?? "" };
}

/** Called by the deep-link handler; wakes any mounted GithubSyncCard. */
export function deliverGithubOAuth(payload: GithubOAuthPayload): void {
  pending = payload;
  window.dispatchEvent(new CustomEvent<GithubOAuthPayload>(EVENT, { detail: payload }));
}

/** Consumes a pending payload (cold-start deep link included), if any. */
export function consumeGithubOAuth(): GithubOAuthPayload | null {
  const next = pending;
  pending = null;
  return next;
}

export function listenGithubOAuth(handler: (payload: GithubOAuthPayload) => void): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<GithubOAuthPayload>).detail);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
