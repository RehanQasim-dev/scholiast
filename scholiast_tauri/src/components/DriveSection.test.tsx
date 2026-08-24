import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { openUrl } from "@tauri-apps/plugin-opener";
import DriveSection from "./DriveSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => {}) }));

const invokeMock = vi.mocked(invoke);
const openUrlMock = vi.mocked(openUrl);

function renderDriveSection(props?: {
  pollIntervalMs?: number;
  pollBudgetMs?: number;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DriveSection {...props} />
    </QueryClientProvider>,
  );
}

describe("DriveSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async () => ({
      ok: true,
      data: { connected: false },
    }));
  });

  test("renders the status line and Connect while disconnected", async () => {
    renderDriveSection();
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Connect" }),
    ).toBeInTheDocument();
  });

  test("connect opens the consent URL in the browser and polls until connected", async () => {
    let connected = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "drive_connect")
        return {
          ok: true,
          data: { url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", port: 54321 },
        };
      if (command === "drive_status") return { ok: true, data: { connected } };
      throw new Error(`unexpected command ${command}`);
    });

    renderDriveSection({ pollIntervalMs: 5, pollBudgetMs: 2_000 });
    await screen.findByText("Not connected");

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(invokeMock).toHaveBeenCalledWith("drive_connect", undefined);
    await waitFor(() =>
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?x=1",
      ),
    );

    // The Rust listener resolves server-side; the first poll still sees
    // "connecting", a later one sees the stored token.
    connected = true;
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
  });

  test("a missing OAuth client shows the DISTRIBUTION.md hint instead of a generic error", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "drive_status") return { ok: true, data: { connected: false } };
      if (command === "drive_connect")
        return {
          ok: false,
          error: {
            kind: "oauth_not_configured",
            message: "No Google OAuth client configured.",
          },
        };
      throw new Error(`unexpected command ${command}`);
    });

    renderDriveSection({ pollIntervalMs: 5, pollBudgetMs: 500 });
    await screen.findByText("Not connected");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByText(/DISTRIBUTION\.md/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Connecting/ })).toBeNull();
  });

  test("connect reports failure when the flow never completes within the budget", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "drive_status") return { ok: true, data: { connected: false } };
      if (command === "drive_connect")
        return { ok: true, data: { url: "https://accounts.google.com", port: 1 } };
      throw new Error(`unexpected command ${command}`);
    });

    renderDriveSection({ pollIntervalMs: 10, pollBudgetMs: 60 });
    await screen.findByText("Not connected");
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    expect(
      await screen.findByText(/did not complete within 60 s/i),
    ).toBeInTheDocument();
  });

  test("disconnect requires confirmation, then clears the connection", async () => {
    let connected = true;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "drive_status") return { ok: true, data: { connected } };
      if (command === "drive_disconnect") {
        connected = false;
        return { ok: true, data: true };
      }
      throw new Error(`unexpected command ${command}`);
    });

    renderDriveSection();
    await screen.findByText("Connected");

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(invokeMock).not.toHaveBeenCalledWith("drive_disconnect");
    const confirm = screen.getByRole("button", { name: "Confirm disconnect?" });
    fireEvent.click(confirm);

    await screen.findByText("Not connected");
    expect(invokeMock).toHaveBeenCalledWith("drive_disconnect", undefined);
  });
});
