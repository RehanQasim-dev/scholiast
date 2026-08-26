import { useEffect, useState } from "react";

export function useOffline(): boolean {
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false,
  );
  useEffect(() => {
    const on = () => setOffline(!navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  return offline;
}

export default function OfflineBanner() {
  const offline = useOffline();

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="flex items-center justify-center gap-2 border-b border-[rgba(255,255,255,0.08)] bg-elevated px-4 py-2 text-xs font-medium text-text-2"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sc-danger)]" aria-hidden />
      You&apos;re offline — changes will sync when you&apos;re back.
    </div>
  );
}
