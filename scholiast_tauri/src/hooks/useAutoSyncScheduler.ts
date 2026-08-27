import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { invokeCommand } from "../lib/ipc";
import { getPref, PREF_KEYS } from "../lib/store";

interface DriveStatus {
  connected: boolean;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function useAutoSyncScheduler() {
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);
  const syncingRef = useRef(false);

  async function tryBackgroundSync(reason: string) {
    if (syncingRef.current) return;
    try {
      const drive = await invokeCommand<DriveStatus>("drive_status");
      if (!drive.connected) return;

      syncingRef.current = true;
      console.log(`[AutoSync] Triggering background sync: ${reason}`);
      await invokeCommand("sync_now");
      console.log(`[AutoSync] Background sync complete (${reason})`);
    } catch (err) {
      console.warn(`[AutoSync] Background sync skipped/failed (${reason}):`, err);
    } finally {
      syncingRef.current = false;
    }
  }

  // 1. Periodic 5-minute auto-backup
  useEffect(() => {
    const timer = setInterval(() => {
      void (async () => {
        const enabled = await getPref<boolean>(PREF_KEYS.syncAutoInterval, true);
        if (enabled) {
          await tryBackgroundSync("periodic-5min");
        }
      })();
    }, FIVE_MINUTES_MS);

    return () => clearInterval(timer);
  }, []);

  // 2. Auto-backup on exiting a study session (/player or /reader)
  useEffect(() => {
    const prev = prevPathRef.current;
    const current = location.pathname;
    prevPathRef.current = current;

    const wasStudySession = prev === "/player" || prev === "/reader";
    const isStudySession = current === "/player" || current === "/reader";

    if (wasStudySession && !isStudySession) {
      void (async () => {
        const enabled = await getPref<boolean>(PREF_KEYS.syncOnExit, true);
        if (enabled) {
          await tryBackgroundSync("exit-study-session");
        }
      })();
    }
  }, [location.pathname]);

  // 3. Auto-backup when app is minimized / backgrounded
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void (async () => {
          const enabled = await getPref<boolean>(PREF_KEYS.syncOnExit, true);
          if (enabled) {
            await tryBackgroundSync("app-hidden");
          }
        })();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);
}
