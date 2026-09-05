/*
 * BotGuard PO-token attestation (BgUtils v4) for native playback.
 *
 * YouTube's stream protection increasingly demands a Proof-of-Origin
 * token: resolveManifest sends it as serviceIntegrityDimensions.poToken
 * and the deciphered segment URLs carry it as `pot`. Both are minted
 * here, inside our real WebView — the exact runtime BotGuard attests —
 * over the Rust-side fetch (no CORS, residential IP, like everything
 * else YouTube-bound).
 *
 * Flow — one attestation per integrity-token TTL, minter reused across
 * videos, per-video mint is local and instant:
 *   getChallenge → inject interpreter <script> → BotGuardClient.snapshot
 *   → POST GenerateIT → integrity token → WebPoMinter
 *   → mintAsWebsafeString(videoId) per video.
 *
 * Every failure degrades to null (unattested playback, the old behavior):
 * attestation must never break watching. In particular a fallback-only
 * GenerateIT answer means Google distrusts this runtime — those tokens
 * die downstream, so they are rejected here, not used.
 */

import { BotGuardClient, getChallenge } from "bgutils-js/botguard";
import { WebPoMinter, createColdStartToken } from "bgutils-js/webpo";
import { GOOG_API_KEY, buildURL, getHeaders } from "bgutils-js/utils";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * BotGuard request key, baked into YouTube's player. Rotates occasionally;
 * when it does, attestation fails closed (null) and playback proceeds
 * unattested until the key is refreshed — bump from a current BgUtils
 * example or player build.
 */
const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
/** Attestation must never hang video opens. */
const ATTEST_TIMEOUT_MS = 15_000;
/** Re-attest this far before the integrity token's stated TTL. */
const REFRESH_MARGIN_MS = 5 * 60_000;

interface MinterCache {
  minter: WebPoMinter;
  expiresAt: number;
}

let minterCache: MinterCache | null = null;
let attestInFlight: Promise<WebPoMinter | null> | null = null;

/** Test seam: drop caches (mirrors store.ts / voice patterns). */
export function resetPoTokenForTests(): void {
  minterCache = null;
  attestInFlight = null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("attestation timed out")), ms);
  });
  return Promise.race([work.finally(() => clearTimeout(timer)), timeout]);
}

async function attestInner(): Promise<WebPoMinter> {
  const challenge = await getChallenge({
    requestKey: REQUEST_KEY,
    fetchFunction: tauriFetch as typeof fetch,
  });
  const interpreterJavascript =
    challenge.interpreterJavascript
      ?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (
    !interpreterJavascript ||
    !challenge.program ||
    !challenge.globalName
  ) {
    throw new Error("challenge missing interpreter");
  }
  // Real <script>, not new Function: the VM registers itself on window
  // under globalName and expects document scope. Keyed by interpreter
  // hash so a post-rotation re-attest loads the fresh VM.
  const scriptId = `bg-interpreter-${challenge.interpreterHash ?? "default"}`;
  if (typeof document !== "undefined" && !document.getElementById(scriptId)) {
    const script = document.createElement("script");
    script.id = scriptId;
    script.type = "text/javascript";
    script.textContent = interpreterJavascript;
    document.head.appendChild(script);
  }
  const botguard = await BotGuardClient.create({
    program: challenge.program,
    globalName: challenge.globalName,
    globalObject: window,
  });
  const webPoSignalOutput: WebPoSignalOutput = [];
  const botguardResponse = await botguard.snapshot({ webPoSignalOutput });
  const integrityRes = await tauriFetch(buildURL("GenerateIT"), {
    method: "POST",
    headers: {
      ...getHeaders(),
      "content-type": "application/json+protobuf",
      "x-goog-api-key": GOOG_API_KEY,
      "x-user-agent": "grpc-web-javascript/0.1",
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
  });
  if (!integrityRes.ok) {
    throw new Error(`GenerateIT HTTP ${integrityRes.status}`);
  }
  const [integrityToken, estimatedTtlSecs] = (await integrityRes.json()) as [
    string?,
    number?,
    number?,
    string?,
  ];
  if (!integrityToken) {
    throw new Error("no integrity token (runtime distrusted?)");
  }
  const minter = await WebPoMinter.create(
    { integrityToken },
    webPoSignalOutput,
  );
  const ttlMs = (estimatedTtlSecs ?? 6 * 3600) * 1000;
  minterCache = {
    minter,
    expiresAt: Date.now() + Math.max(ttlMs - REFRESH_MARGIN_MS, 0),
  };
  return minter;
}

async function attest(): Promise<WebPoMinter | null> {
  try {
    return await withTimeout(attestInner(), ATTEST_TIMEOUT_MS);
  } catch {
    return null;
  }
}

async function minter(): Promise<WebPoMinter | null> {
  if (minterCache && Date.now() < minterCache.expiresAt) {
    return minterCache.minter;
  }
  minterCache = null;
  if (!attestInFlight) {
    attestInFlight = attest().finally(() => {
      attestInFlight = null;
    });
  }
  return attestInFlight;
}

/**
 * Content-bound token for one video (mints locally once attested).
 * Null when attestation is unavailable — callers proceed unattested.
 */
export async function getPoToken(videoId: string): Promise<string | null> {
  try {
    const active = await minter();
    if (!active) return null;
    return await active.mintAsWebsafeString(videoId);
  } catch {
    return null;
  }
}

/**
 * Instant pure-local token (XOR placeholder, no network): unlocks sps≤2
 * playback while attestation warms and floors every request when
 * attestation fails. Kira mints one at every playback start for free —
 * same here, it's the token floor under the real one above.
 */
export function coldStartPoToken(videoId: string): string {
  return createColdStartToken(videoId);
}
