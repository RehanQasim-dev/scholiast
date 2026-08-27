import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import {
  Excalidraw,
  exportToBlob,
  serializeAsJSON,
} from "@excalidraw/excalidraw";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import CommentEditorSheet, {
  type AttachableVideoItem,
} from "../components/CommentEditorSheet";
import { toast } from "../components/Toast";
import { invokeCommand } from "../lib/ipc";
import { playerBridge } from "../player/playerBridge";

const FRAME_ELEMENT_ID = "captured-frame";
const FRAME_FILE_ID = "captured-frame-file";

interface FrameRouteState {
  urlHash?: string;
  url?: string;
  tmpPath?: string;
  w?: number;
  h?: number;
  videoTime?: number;
  itemId?: string;
}

interface SaveFrameOut {
  itemId: string;
}

interface FrameItemDetail {
  itemId: string;
  urlHash: string;
  videoTime: number;
  w: number | null;
  h: number | null;
  sceneJson: string | null;
  pngPath: string | null;
}

type ExcalidrawOnChange = NonNullable<
  React.ComponentProps<typeof Excalidraw>["onChange"]
>;
type SceneElements = Parameters<ExcalidrawOnChange>[0];
type SceneAppState = Parameters<ExcalidrawOnChange>[1];

interface ExistingFrame {
  tmpPath: string;
  videoTime: number;
  w: number;
  h: number;
  scene: {
    elements?: SceneElements;
    appState?: Partial<SceneAppState>;
    files?: BinaryFiles;
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function frameFile(dataUrl: string): BinaryFiles {
  return {
    [FRAME_FILE_ID]: {
      mimeType: "image/jpeg",
      id: FRAME_FILE_ID as FileId,
      dataURL: dataUrl as BinaryFileData["dataURL"],
      created: Date.now(),
    },
  };
}

function frameElement(w: number, h: number): SceneElements {
  return [
    {
      type: "image",
      id: FRAME_ELEMENT_ID,
      x: 0,
      y: 0,
      width: w,
      height: h,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: null,
      locked: false,
      status: "saved",
      fileId: FRAME_FILE_ID as FileId,
      scale: [1, 1],
    } as unknown as SceneElements[number],
  ];
}

/**
 * Full-screen draw surface over a captured frame (`/frame`). Fresh captures
 * arrive via router state {urlHash,url,tmpPath,w,h,videoTime}; reopen-edit
 * arrives as {itemId} and re-seeds the saved scene. The frame item exists
 * only after save_frame_item — Cancel leaves nothing behind.
 */
export default function FrameDraw() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const state = (location.state ?? {}) as FrameRouteState;

  const elementsRef = useRef<SceneElements>([]);
  const appStateRef = useRef<Partial<SceneAppState>>({});
  const filesRef = useRef<BinaryFiles>({});

  const [loading, setLoading] = useState(Boolean(state.itemId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedItem, setSavedItem] = useState<AttachableVideoItem | null>(null);
  const [existing, setExisting] = useState<ExistingFrame | null>(null);

  useEffect(() => {
    if (!state.itemId) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await invokeCommand<FrameItemDetail>("get_frame_item", {
          itemId: state.itemId,
        });
        const jpgPath = await join(
          await appDataDir(),
          "frames",
          `${detail.itemId}.jpg`,
        );
        if (cancelled) return;
        const parsed = detail.sceneJson
          ? (JSON.parse(detail.sceneJson) as ExistingFrame["scene"])
          : null;
        const w = detail.w ?? 1280;
        const h = detail.h ?? 720;
        // The scene's stored dataURL points at the long-gone tmp capture;
        // repoint it at the permanent frames/<id>.jpg so the base loads.
        if (parsed?.files?.[FRAME_FILE_ID]) {
          parsed.files[FRAME_FILE_ID] = {
            ...parsed.files[FRAME_FILE_ID],
            dataURL: convertFileSrc(jpgPath) as BinaryFileData["dataURL"],
          };
        }
        setExisting({
          tmpPath: jpgPath,
          videoTime: detail.videoTime,
          w,
          h,
          scene:
            parsed && parsed.elements
              ? parsed
              : {
                  elements: frameElement(w, h),
                  files: frameFile(convertFileSrc(jpgPath)),
                },
        });
      } catch {
        if (!cancelled) setLoadError("Couldn't load that drawing.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.itemId]);

  const initialData = useMemo(() => {
    if (existing) {
      filesRef.current = existing.scene.files ?? {};
      return existing.scene;
    }
    if (!state.tmpPath || !state.w || !state.h) return null;
    const files = frameFile(convertFileSrc(state.tmpPath));
    filesRef.current = files;
    return {
      elements: frameElement(state.w, state.h),
      appState: { viewBackgroundColor: "#101014" } as Partial<SceneAppState>,
      files,
    };
  }, [existing, state.tmpPath, state.w, state.h]);

  const finishAndResume = useCallback(() => {
    navigate(-1);
    playerBridge.commands.play();
  }, [navigate]);

  const cancel = useCallback(() => {
    const path = state.tmpPath;
    if (path && !existing) {
      void invoke("cleanup_capture", { path }).catch(() => {});
    }
    finishAndResume();
  }, [existing, finishAndResume, state.tmpPath]);

  const persistThenComment = useCallback(async () => {
    if (elementsRef.current.length === 0) {
      toast("Nothing to save yet — draw something first.");
      return;
    }
    try {
      const blob = await exportToBlob({
        elements: elementsRef.current,
        appState: appStateRef.current as never,
        files: filesRef.current,
        mimeType: "image/png",
      });
      const pngBase64 = await blobToBase64(blob);
      const sceneJson = serializeAsJSON(
        elementsRef.current,
        appStateRef.current as never,
        filesRef.current,
        "local",
      );
      const saved = await invokeCommand<SaveFrameOut>("save_frame_item", {
        url: state.url,
        videoTime: existing?.videoTime ?? state.videoTime ?? 0,
        tmpPath: existing?.tmpPath ?? state.tmpPath,
        pngBase64,
        sceneJson,
        itemId: state.itemId ?? undefined,
      });
      await queryClient.invalidateQueries({
        queryKey: ["videoItems", state.urlHash],
      });
      setSavedItem({
        id: saved.itemId,
        kind: "frame",
        videoTime: existing?.videoTime ?? state.videoTime ?? 0,
        notes: [],
        updatedAt: Date.now(),
        frame: { w: existing?.w ?? state.w ?? 0, h: existing?.h ?? state.h ?? 0 },
      });
    } catch {
      toast("Couldn't save the frame.");
    }
  }, [existing, queryClient, state.itemId, state.url, state.urlHash, state.videoTime, state.tmpPath, state.w, state.h]);

  if (loadError || (!loading && !initialData)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-base text-text">
        <p className="text-sm text-text-2">
          {loadError ?? "No captured frame to draw on."}
        </p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-md border border-hairline px-3 py-1.5 text-sm text-text-2 hover:text-text"
        >
          Go back
        </button>
      </div>
    );
  }

  if (!initialData) {
    return (
      <div className="h-screen bg-black" role="status" aria-label="Loading frame" />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#000000f2]"
      data-testid="frame-draw"
    >
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={cancel}
          disabled={Boolean(savedItem)}
          className="rounded-md border border-hairline px-3 py-1.5 text-sm text-text-2 hover:text-text disabled:opacity-40"
        >
          Cancel
        </button>
        <p aria-live="polite" className="text-xs text-text-3">
          Draw over the captured frame
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void persistThenComment()}
            disabled={Boolean(savedItem)}
            className="rounded-md border border-hairline px-3 py-1.5 text-sm text-text-2 hover:text-text disabled:opacity-40"
          >
            💬 Comment
          </button>
          <button
            type="button"
            onClick={() => void persistThenComment()}
            disabled={Boolean(savedItem)}
            className="rounded-md bg-[color:var(--sc-accent)] px-4 py-1.5 text-sm font-medium text-[var(--sc-accent-text)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="frame-save"
          >
            Save
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <Excalidraw
          theme="dark"
          initialData={initialData}
          excalidrawAPI={(api) => {
            filesRef.current = api.getFiles();
          }}
          onChange={(elements, appState, files) => {
            elementsRef.current = elements;
            appStateRef.current = appState;
            if (files) filesRef.current = files;
          }}
        />
      </div>

      <CommentEditorSheet
        open={Boolean(savedItem)}
        target={
          state.urlHash
            ? { urlHash: state.urlHash, currentTime: savedItem?.videoTime ?? 0 }
            : null
        }
        attachTo={savedItem}
        onClose={finishAndResume}
      />
    </div>
  );
}
