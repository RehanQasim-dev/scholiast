import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { Settings } from "lucide-react";
import OpenLinkField from "../components/OpenLinkField";
import RecentGrid from "../components/RecentGrid";
import CloudSyncIndicator from "../components/CloudSyncIndicator";
import { ToastHost } from "../components/Toast";

const RECENT_KEY = ["videos", "recent"] as const;

export default function Home() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

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
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-6 pt-7 sm:pt-9 pb-24">
      <ToastHost />
      <header className="sticky top-0 z-10 -mx-6 -mt-7 flex items-center justify-between gap-4 border-b border-transparent bg-base/80 px-6 py-4 backdrop-blur-md supports-[backdrop-filter]:bg-base/70 sm:-mt-9">
        <h1 className="text-xl font-semibold tracking-tight text-text">Scholiast</h1>
        <div className="flex items-center gap-1.5">
          <CloudSyncIndicator />
          <button
            type="button"
            aria-label="Open settings"
            onClick={() => navigate("/settings")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-text-2 transition-all hover:bg-elevated hover:text-text active:scale-95 focus-visible:outline-none"
          >
            <Settings size={20} strokeWidth={2} style={{ strokeLinecap: "round", strokeLinejoin: "round" } as React.CSSProperties} />
          </button>
        </div>
      </header>
      <OpenLinkField />
      <section aria-label="Recent activity" className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-3">Recent Activity</h2>
          <span className="text-[11px] text-text-3">Newest first</span>
        </div>
        <RecentGrid />
      </section>
    </section>
  );
}
