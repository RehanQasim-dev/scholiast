import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeCommand, IpcCommandError } from "./ipc";

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptParagraph {
  index: number;
  text: string;
  start: number;
  end: number;
  cueRange: [number, number];
}

export interface TranscriptData {
  lang: string;
  paragraphs: TranscriptParagraph[];
  cues: TranscriptCue[];
}

export type TranscriptErrorKind = "no-captions" | "other";

export function langPrefKey(videoId: string): string {
  return `transcript.lang.${videoId}`;
}

export function getSessionLangPref(videoId: string): string | null {
  try {
    return sessionStorage.getItem(langPrefKey(videoId));
  } catch {
    return null;
  }
}

export function setSessionLangPref(videoId: string, lang: string): void {
  try {
    sessionStorage.setItem(langPrefKey(videoId), lang);
  } catch {
    /* storage unavailable (private mode) — pref is best-effort */
  }
}

function classifyError(error: unknown): TranscriptErrorKind | null {
  if (error instanceof IpcCommandError) {
    return error.kind === "notFound" ? "no-captions" : "other";
  }
  return error ? "other" : null;
}

/**
 * The Rust side has no request timeout, so a hung innertube connection would
 * leave the query pending forever (panel stuck on the skeleton). Settle it.
 */
const FETCH_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out fetching the transcript")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Fetches the transcript for a video via `fetch_transcript`. The session
 * language preference (`transcript.lang.<videoId>`) is sent as `langPref`;
 * `changeLang` stores it and refetches. Query key stays `['transcript', videoId]`.
 */
export function useTranscript(videoId: string | null) {
  const [langPref, setLangPref] = useState<string | null>(() =>
    videoId ? getSessionLangPref(videoId) : null,
  );

  useEffect(() => {
    setLangPref(videoId ? getSessionLangPref(videoId) : null);
  }, [videoId]);

  const query = useQuery({
    queryKey: ["transcript", videoId],
    queryFn: () =>
      withTimeout(
        invokeCommand<TranscriptData>("fetch_transcript", { videoId, langPref }),
        FETCH_TIMEOUT_MS,
      ),
    enabled: Boolean(videoId),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const changeLang = (lang: string) => {
    if (!videoId || !lang || lang === query.data?.lang) return;
    setSessionLangPref(videoId, lang);
    setLangPref(lang);
    void query.refetch();
  };

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    langPref,
    changeLang,
    refetch: query.refetch,
    errorKind: classifyError(query.error),
    errorMessage: query.error instanceof Error ? query.error.message : null,
  };
}
