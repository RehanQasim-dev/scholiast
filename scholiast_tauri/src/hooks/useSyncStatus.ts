import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface SyncStatus {
  /** Active engine phase ("discovering" | "pushing" | "reconciling"), null when idle. */
  phase: string | null;
  done: number;
  total: number;
  title: string | null;
  url: string | null;
  /** Epoch ms of the last successful run, from `sync://state`. */
  lastSynced: number | null;
  /** Pages waiting in the dirty queue (offline-queued indicator). */
  pending: number;
  error: string | null;
}

export const IDLE_SYNC_STATUS: SyncStatus = {
  phase: null,
  done: 0,
  total: 0,
  title: null,
  url: null,
  lastSynced: null,
  pending: 0,
  error: null,
};

export type SyncEvent =
  | {
      kind: "progress";
      phase: string;
      done: number;
      total: number;
      title: string;
      url: string;
    }
  | { kind: "state"; lastSynced: number | null; pending: number; error?: string | null };

/** Pure fold over sync events so the reducer is unit-testable without Tauri. */
export function foldSyncEvent(prev: SyncStatus, event: SyncEvent): SyncStatus {
  if (event.kind === "progress") {
    return {
      ...prev,
      phase: event.phase,
      done: event.done,
      total: event.total,
      title: event.title,
      url: event.url,
    };
  }
  return {
    ...prev,
    phase: null,
    title: null,
    url: null,
    done: 0,
    total: 0,
    lastSynced: event.lastSynced,
    pending: event.pending,
    error: event.error ?? null,
  };
}

type Dispose = () => void;

function subscribe(onEvent: (event: SyncEvent) => void): Dispose {
  const disposes: Dispose[] = [];
  let mounted = true;
  try {
    void Promise.all([
      listen("sync://progress", (event) => {
        const payload = event.payload as Omit<
          Extract<SyncEvent, { kind: "progress" }>,
          "kind"
        >;
        onEvent({ ...payload, kind: "progress" });
      }),
      listen("sync://state", (event) => {
        const payload = event.payload as Omit<Extract<SyncEvent, { kind: "state" }>, "kind">;
        onEvent({ ...payload, kind: "state" });
      }),
    ])
      .then((fns) => {
        if (!mounted) {
          fns.forEach((fn) => fn());
        } else {
          disposes.push(...fns);
        }
      })
      .catch(() => {
        /* tauri event API unavailable (e.g. mocked test env) */
      });
  } catch {
    /* tauri event API unavailable (e.g. mocked test env) */
  }
  return () => {
    mounted = false;
    disposes.forEach((fn) => fn());
  };
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(IDLE_SYNC_STATUS);

  useEffect(
    () =>
      subscribe((event) =>
        setStatus((prev) => foldSyncEvent(prev, event)),
      ),
    [],
  );

  return status;
}
