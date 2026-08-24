import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, PNG_BYTES, SCENE_JSON } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  PNG_BYTES: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3],
  SCENE_JSON: JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "scholiast",
    elements: [],
    appState: {},
    files: {},
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`,
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/mock/appdata",
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

vi.mock("@excalidraw/excalidraw", async () => {
  const React = await import("react");
  const Stub = (props: {
    onChange?: (elements: unknown[], appState: unknown, files: unknown) => void;
    excalidrawAPI?: (api: { getFiles: () => unknown }) => void;
  }) => {
    React.useEffect(() => {
      props.excalidrawAPI?.({ getFiles: () => ({}) });
      props.onChange?.([{ id: "stroke-1" }], {}, {});
    }, [props]);
    return React.createElement("div", { "data-testid": "excalidraw-stub" });
  };
  return {
    default: Stub,
    Excalidraw: Stub,
    exportToBlob: async () =>
      new Blob([new Uint8Array(PNG_BYTES)], { type: "image/png" }),
    serializeAsJSON: () => SCENE_JSON,
  };
});

vi.mock("../components/CommentEditorSheet", async () => {
  const React = await import("react");
  return {
    default: (props: { open: boolean; attachTo?: { id: string } | null }) =>
      props.open && props.attachTo
        ? React.createElement(
            "div",
            { "data-testid": "comment-sheet-stub" },
            props.attachTo.id,
          )
        : null,
  };
});

import FrameDraw from "./FrameDraw";

function renderFrame(state: Record<string, unknown> = FRESH_STATE) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[
            { pathname: "/home" },
            { pathname: "/frame", state },
          ]}
          initialIndex={1}
          future={{ v7_relativeSplatPath: true }}
        >
        <Routes>
          <Route path="/home" element={<div data-testid="player-back" />} />
          <Route path="/frame" element={<FrameDraw />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FRESH_STATE = {
  urlHash: "hash1",
  url: "https://youtu.be/abcdefghijk",
  tmpPath: "/mock/appdata/tmp/capture-1.jpg",
  w: 640,
  h: 360,
  videoTime: 42,
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (command: string) => {
    switch (command) {
      case "save_frame_item":
        return {
          ok: true,
          data: {
            itemId: "item-1",
            jpgPath: "/mock/appdata/frames/item-1.jpg",
            pngPath: "/mock/appdata/frames/item-1.png",
            w: 640,
            h: 360,
          },
        };
      case "cleanup_capture":
        return true;
      default:
        throw new Error(`unexpected command: ${command}`);
    }
  });
});

afterEach(() => {
  cleanup();
});

describe("FrameDraw", () => {
  it("saves via save_frame_item with a base64 PNG payload, then opens the comment sheet attached to the item", async () => {
    renderFrame(FRESH_STATE);

    expect(await screen.findByTestId("excalidraw-stub")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("frame-save"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "save_frame_item",
        expect.objectContaining({
          url: FRESH_STATE.url,
          videoTime: 42,
          tmpPath: FRESH_STATE.tmpPath,
          sceneJson: SCENE_JSON,
          itemId: undefined,
        }),
      );
    });
    const args = invokeMock.mock.calls.find((c) => c[0] === "save_frame_item")?.[1];
    expect(args.pngBase64).toBe(btoa(String.fromCharCode(...PNG_BYTES)));

    const sheet = await screen.findByTestId("comment-sheet-stub");
    expect(sheet).toHaveTextContent("item-1");
  });

  it("cancel cleans up the temp capture and navigates back", async () => {
    renderFrame(FRESH_STATE);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("cleanup_capture", {
        path: FRESH_STATE.tmpPath,
      });
    });
    expect(await screen.findByTestId("player-back")).toBeInTheDocument();
  });
});
