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
      invokeCommand<TranscriptData>("fetch_transcript", { videoId, langPref }),
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
    errorKind: classifyError(query.error),
    errorMessage: query.error instanceof Error ? query.error.message : null,
  };
}
