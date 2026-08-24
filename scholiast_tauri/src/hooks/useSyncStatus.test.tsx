import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  foldSyncEvent,
  IDLE_SYNC_STATUS,
  useSyncStatus,
  type SyncEvent,
} from "./useSyncStatus";

type Handler = (event: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: Handler) => {
    handlers.set(name, handler);
    return Promise.resolve(unlisten);
  }),
}));

function emit(name: string, payload: unknown) {
  handlers.get(name)?.({ payload });
}

function Probe() {
  const status = useSyncStatus();
  return (
    <div
      data-testid="probe"
      data-phase={status.phase}
      data-pending={status.pending}
      data-error={status.error}
    >
      {status.lastSynced ?? "none"}
    </div>
  );
}

describe("foldSyncEvent", () => {
  test("progress events carry the running phase through", () => {
    const event: SyncEvent = {
      kind: "progress",
      phase: "reconciling",
      done: 2,
      total: 5,
      title: "Lecture",
      url: "https://example.com",
    };
    const next = foldSyncEvent(IDLE_SYNC_STATUS, event);
    expect(next).toMatchObject({
      phase: "reconciling",
      done: 2,
      total: 5,
      title: "Lecture",
      url: "https://example.com",
      lastSynced: null,
      pending: 0,
    });
  });

  test("a successful state event returns the hook to idle and records lastSynced", () => {
    let status = foldSyncEvent(IDLE_SYNC_STATUS, {
      kind: "progress",
      phase: "pushing",
      done: 0,
      total: 1,
      title: "h",
      url: "u",
    });
    status = foldSyncEvent(status, {
      kind: "state",
      lastSynced: 1724500000000,
      pending: 0,
      error: null,
    });
    expect(status.phase).toBeNull();
    expect(status.title).toBeNull();
    expect(status.lastSynced).toBe(1724500000000);
    expect(status.error).toBeNull();
  });

  test("an error state clears the phase and keeps the message", () => {
    const next = foldSyncEvent(
      foldSyncEvent(IDLE_SYNC_STATUS, {
        kind: "progress",
        phase: "discovering",
        done: 0,
        total: 1,
        title: "",
        url: "",
      }),
      { kind: "state", lastSynced: null, pending: 3, error: "offline" },
    );
    expect(next).toMatchObject({
      phase: null,
      error: "offline",
      pending: 3,
      lastSynced: null,
    });
  });
});

describe("useSyncStatus", () => {
  beforeEach(() => {
    handlers.clear();
    unlisten.mockClear();
  });

  test("folds live sync:// events into state and unsubscribes on unmount", async () => {
    const { unmount } = render(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(handlers.has("sync://progress")).toBe(true);

    act(() => {
      emit("sync://progress", {
        phase: "reconciling",
        done: 1,
        total: 2,
        title: "Lecture",
        url: "https://example.com",
      });
    });
    expect(screen.getByTestId("probe").dataset.phase).toBe("reconciling");

    act(() => {
      emit("sync://state", { lastSynced: 555, pending: 2, error: null });
    });
    expect(screen.getByTestId("probe").dataset.pending).toBe("2");
    expect(screen.getByText("555")).toBeInTheDocument();

    unmount();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  test("stays at defaults when no events arrive", async () => {
    render(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });
    const probe = screen.getByTestId("probe");
    expect(probe.dataset.phase).toBeUndefined();
    expect(probe.textContent).toBe("none");
  });
});
