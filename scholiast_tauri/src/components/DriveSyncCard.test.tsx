import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import DriveSyncCard from "./DriveSyncCard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const invokeMock = vi.mocked(invoke);

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DriveSyncCard />
    </QueryClientProvider>,
  );
}

describe("DriveSyncCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "drive_status") return { ok: true, data: { connected: false } };
      return { ok: true, data: {} };
    });
  });

  test("renders unified card with Google Drive header and Connect button", async () => {
    renderCard();
    expect(await screen.findByText("Google Drive")).toBeInTheDocument();
    expect(screen.getByTestId("drive-connect-btn")).toHaveTextContent("Connect");
    expect(screen.getByTestId("sync-state-line")).toBeInTheDocument();
  });

  test("renders Connected status and Disconnect button when connected", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "drive_status") return { ok: true, data: { connected: true } };
      return { ok: true, data: {} };
    });

    renderCard();
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByTestId("drive-disconnect-btn")).toHaveTextContent("Disconnect");
    expect(screen.getByTestId("sync-now-btn")).toHaveTextContent("Sync now");

    // Click Sync now triggers sync_now command
    fireEvent.click(screen.getByTestId("sync-now-btn"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("sync_now", undefined));
  });
});
