import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { IDLE_SYNC_STATUS, type SyncStatus } from "../hooks/useSyncStatus";
import SyncStatusBar, { syncStatusView } from "./SyncStatusBar";

vi.mock("../hooks/useSyncStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/useSyncStatus")>()),
  useSyncStatus: vi.fn(() => IDLE_SYNC_STATUS),
}));

const useSyncStatusMock = vi.mocked(
  (await import("../hooks/useSyncStatus")).useSyncStatus,
);

function status(overrides: Partial<SyncStatus>): SyncStatus {
  return { ...IDLE_SYNC_STATUS, ...overrides };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

function renderChip() {
  return render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes>
        <Route path="/home" element={<SyncStatusBar />} />
        <Route path="/settings" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("syncStatusView", () => {
  test("idle shows relative last-synced time", () => {
    const view = syncStatusView(status({ lastSynced: Date.now() - 5 * 60_000 }));
    expect(view.label).toBe("Synced 5m ago");
    expect(view.tone).toBe("idle");
  });

  test("never-synced falls back to a ready label", () => {
    expect(syncStatusView(IDLE_SYNC_STATUS).label).toBe("Sync ready");
  });

  test("running shows done/total and the current page title", () => {
    const view = syncStatusView(
      status({
        phase: "reconciling",
        done: 3,
        total: 9,
        title: "A very long lecture title that should get truncated away",
      }),
    );
    expect(view.label).toBe("3/9");
    expect(view.detail).toMatch(/…$/);
    expect(view.tone).toBe("running");
  });

  test("error tone carries the message as tooltip", () => {
    const view = syncStatusView(status({ error: "Drive unreachable" }));
    expect(view.tone).toBe("error");
    expect(view.tooltip).toBe("Drive unreachable");
  });

  test("pending beats idle for the offline-queued state", () => {
    const view = syncStatusView(status({ pending: 2, lastSynced: Date.now() }));
    expect(view.label).toBe("2 changes queued");
    expect(view.tone).toBe("queued");
  });

  test("running outranks error and pending", () => {
    const view = syncStatusView(
      status({ phase: "pushing", done: 0, total: 1, error: "x", pending: 4 }),
    );
    expect(view.tone).toBe("running");
  });
});

describe("SyncStatusBar", () => {
  beforeEach(() => {
    useSyncStatusMock.mockReturnValue(IDLE_SYNC_STATUS);
  });

  test("renders each state into the chip's data attribute", () => {
    const cases: Array<[SyncStatus, string]> = [
      [IDLE_SYNC_STATUS, "idle"],
      [status({ phase: "discovering", done: 0, total: 1 }), "running"],
      [status({ error: "boom" }), "error"],
      [status({ pending: 1 }), "queued"],
    ];
    cases.forEach(([state, tone]) => {
      useSyncStatusMock.mockReturnValue(state);
      const { unmount } = renderChip();
      expect(screen.getByTestId("sync-status").dataset.tone).toBe(tone);
      unmount();
    });
  });

  test("exposes the tooltip text for assistive tech", () => {
    useSyncStatusMock.mockReturnValue(status({ error: "offline" }));
    renderChip();
    expect(screen.getByTestId("sync-status")).toHaveAttribute(
      "title",
      "offline",
    );
  });

  test("clicking the chip navigates to settings", async () => {
    renderChip();
    await screen.findByTestId("sync-status");
    fireEvent.click(screen.getByRole("button", { name: /sync status/i }));
    expect(screen.getByTestId("probe").textContent).toBe("/settings");
  });
});
