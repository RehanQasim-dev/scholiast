import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import DataSection from "./DataSection";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

function renderDataSection(props?: { fetchStats?: () => Promise<{ videos: number; items: number }> }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DataSection {...props} />
    </QueryClientProvider>,
  );
}

describe("DataSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockReset();
  });

  test("local wipe stays disabled until the word delete is typed", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "data_stats")
        return { ok: true, data: { videos: 4, items: 12 } };
      if (command === "wipe_local_data") return { ok: true, data: true };
      throw new Error(`unexpected command ${command}`);
    });

    renderDataSection();
    fireEvent.click(screen.getByRole("button", { name: "Delete local data…" }));

    const counts = await screen.findByTestId("local-counts");
    expect(counts).toHaveTextContent("4");
    expect(counts).toHaveTextContent("12");

    const confirmButton = screen.getByTestId("wipe-confirm-button");
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByTestId("wipe-confirm-input"), {
      target: { value: "nope" },
    });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByTestId("wipe-confirm-input"), {
      target: { value: "delete" },
    });
    expect(confirmButton).toBeEnabled();

    fireEvent.click(confirmButton);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "wipe_local_data",
        undefined,
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Local data deleted.",
    );
  });

  test("drive wipe reports the deleted file count only afterwards", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "wipe_drive_data") return { ok: true, data: 7 };
      throw new Error(`unexpected command ${command}`);
    });

    renderDataSection();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete all data on Google Drive…" }),
    );

    expect(screen.queryByTestId("local-counts")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("wipe-confirm-input"), {
      target: { value: "delete" },
    });
    fireEvent.click(screen.getByTestId("wipe-confirm-button"));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Deleted 7 files from Google Drive.",
      ),
    );
  });

  test("cancel closes the dialog without invoking any wipe", async () => {
    renderDataSection();
    fireEvent.click(screen.getByRole("button", { name: "Delete local data…" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("wipe_local_data", undefined);
  });
});
