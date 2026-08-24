import { invoke } from "@tauri-apps/api/core";

export interface IpcError {
  kind: string;
  message: string;
}

export class IpcCommandError extends Error {
  readonly kind: string;

  constructor(error: IpcError) {
    super(error.message);
    this.name = "IpcCommandError";
    this.kind = error.kind;
  }
}

/**
 * Invokes a Rust command and unwraps the `{ ok, data | error }` envelope.
 * Raw (non-enveloped) payloads pass through untouched.
 */
export async function invokeCommand<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const raw = await invoke<unknown>(command, args);
  if (
    raw !== null &&
    typeof raw === "object" &&
    "ok" in raw &&
    typeof (raw as { ok: unknown }).ok === "boolean"
  ) {
    const envelope = raw as { ok: boolean; data?: T; error?: IpcError };
    if (!envelope.ok) {
      throw new IpcCommandError(
        envelope.error ?? { kind: "unknown", message: "Command failed" },
      );
    }
    return envelope.data as T;
  }
  return raw as T;
}

export interface VideoSummary {
  urlHash: string;
  url: string;
  videoId: string | null;
  title: string | null;
  resumeAt: number;
  updatedAt: number;
}

export function listRecentVideos(): Promise<VideoSummary[]> {
  return invokeCommand<VideoSummary[]>("list_recent_videos");
}

export function upsertVideo(args: {
  url: string;
  title?: string;
  videoId?: string;
}): Promise<VideoSummary> {
  return invokeCommand<VideoSummary>("upsert_video", args);
}

export interface VideoItem {
  id: string;
  kind: "frame" | "note" | "transcript";
  /** Seconds into the video; range START for transcript items. */
  videoTime: number;
  frame?: {
    dataUrl?: string;
    driveId?: string;
    w: number;
    h: number;
  };
  markup?: unknown;
  notes: string[];
  updatedAt?: number;
  timeEnd?: number;
  quote?: string;
  color?: string;
  anchor?: {
    startCue: number;
    startOffset: number;
    endCue: number;
    endOffset: number;
  };
}

export function getVideoItems(args: { urlHash: string }): Promise<VideoItem[]> {
  return invokeCommand<VideoItem[]>("get_video_items", args);
}

export function deleteVideoItem(args: {
  urlHash: string;
  itemId: string;
}): Promise<boolean> {
  return invokeCommand<boolean>("delete_video_item", args);
}
