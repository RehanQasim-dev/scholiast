import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { Settings } from "lucide-react";
import OpenLinkField from "../components/OpenLinkField";
import RecentGrid from "../components/RecentGrid";
import SyncStatusCard from "../components/SyncStatusCard";
import { ToastHost } from "../components/Toast";
import { useDeepLinks } from "../lib/deepLink";
import SettingsPage from "./Settings";

const RECENT_KEY = ["videos", "recent"] as const;

export default function Home() {
  const queryClient = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);
  useDeepLinks();

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    try {
      void listen("db://changed:videos", () => {
        void queryClient.invalidateQueries({ queryKey: RECENT_KEY });
      })
        .then((fn) => {
          if (cancelled) fn();
          else dispose = fn;
        })
        .catch(() => {
          /* tauri event API unavailable (e.g. mocked test env) */
        });
    } catch {
      /* tauri event API unavailable (e.g. mocked test env) */
    }
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [queryClient]);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-6">
      <ToastHost />
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight text-text">Scholiast</h1>
        <button
          type="button"
          aria-label="Open settings"
          onClick={() => setSettingsOpen(true)}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-elevated hover:text-text focus-visible:outline-none"
        >
          <Settings size={24} strokeWidth={2} style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties} />
        </button>
      </header>
      <OpenLinkField />
      <section aria-label="Your library" className="flex flex-col gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-3">Your Library</h2>
        <RecentGrid />
      </section>
      <section aria-label="Sync status" className="flex flex-col gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-text-3">Sync Status</h2>
        <SyncStatusCard />
      </section>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSettingsOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-hairline bg-surface shadow-xl"
          >
            <button
              type="button"
              aria-label="Close settings"
              onClick={() => setSettingsOpen(false)}
              className="absolute right-3 top-3 flex h-12 w-12 items-center justify-center rounded-md text-text-2 hover:bg-elevated hover:text-text"
            >
              <span aria-hidden className="text-xl leading-none">×</span>
            </button>
            <SettingsPage />
          </div>
        </div>
      )}
    </section>
  );
}
