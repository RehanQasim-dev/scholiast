import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { IDLE_SYNC_STATUS, type SyncStatus } from "../../hooks/useSyncStatus";
import SyncProgressCard from "./SyncProgressCard";

vi.mock("../../hooks/useSyncStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSyncStatus")>()),
  useSyncStatus: vi.fn(() => IDLE_SYNC_STATUS),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const useSyncStatusMock = vi.mocked(
  (await import("../../hooks/useSyncStatus")).useSyncStatus,
);
const invokeMock = vi.mocked(invoke);

function status(overrides: Partial<SyncStatus>): SyncStatus {
  return { ...IDLE_SYNC_STATUS, ...overrides };
}

describe("SyncProgressCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async () => ({ ok: true, data: {} }));
    useSyncStatusMock.mockReturnValue(IDLE_SYNC_STATUS);
  });

  test("idle shows the state line, never-synced hint and a Sync now button", async () => {
    render(<SyncProgressCard />);
    expect(screen.getByTestId("sync-state-line")).toHaveTextContent(
      "Up to date · never synced",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Sync now" }),
    );
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("sync_now", undefined),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("running shows an indeterminate bar during discovery and page counts while reconciling", () => {
    useSyncStatusMock.mockReturnValue(
      status({ phase: "discovering", done: 0, total: 1 }),
    );
    const { unmount: unmountDiscovery } = render(<SyncProgressCard />);
    expect(screen.getByTestId("sync-state-line")).toHaveTextContent(
      "Discovering changes…",
    );
    expect(screen.getByRole("progressbar").firstElementChild).toHaveClass(
      "animate-pulse",
    );
    unmountDiscovery();

    useSyncStatusMock.mockReturnValue(
      status({
        phase: "reconciling",
        done: 4,
        total: 10,
        title: "Lecture",
        url: "https://example.com/page",
      }),
    );
    render(<SyncProgressCard />);
    expect(screen.getByTestId("sync-current-page")).toHaveTextContent(
      "example.com/page (4/10)",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "40",
    );
  });

  test("engine errors render in red with the message; queue size is surfaced", () => {
    useSyncStatusMock.mockReturnValue(
      status({ error: "Drive unreachable", pending: 2 }),
    );
    render(<SyncProgressCard />);
    expect(screen.getByTestId("sync-state-line")).toHaveTextContent(
      /Not Connected|Sync failed/i,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Drive unreachable");
    expect(
      screen.getByText(/2 changes queued/),
    ).toBeInTheDocument();
  });

  test("a failed manual sync surfaces its error without losing the hook state", async () => {
    invokeMock.mockImplementation(async () => ({
      ok: false,
      error: { kind: "oauth_not_configured", message: "No client configured." },
    }));
    render(<SyncProgressCard />);
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "No client configured.",
    );
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
  });
});
