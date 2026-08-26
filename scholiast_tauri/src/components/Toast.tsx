import { useEffect, useRef, useState } from "react";

type Listener = (message: string) => void;
let listener: Listener | null = null;

export function toast(message: string) {
  listener?.(message);
}

export function ToastHost({ durationMs = 4000 }: { durationMs?: number }) {
  const [visible, setVisible] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const dismissRef = useRef<number | null>(null);
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    listener = (message: string) => {
      pendingRef.current = message;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        const next = pendingRef.current;
        pendingRef.current = null;
        debounceRef.current = null;
        if (dismissRef.current !== null) window.clearTimeout(dismissRef.current);
        setVisible(next);
        if (next) {
          dismissRef.current = window.setTimeout(() => {
            setVisible(null);
            dismissRef.current = null;
          }, durationMs);
        }
      }, 120);
    };
    return () => {
      listener = null;
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      if (dismissRef.current !== null) window.clearTimeout(dismissRef.current);
    };
  }, [durationMs]);

  if (!visible) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 z-50 flex -translate-x-1/2 px-4"
      style={{
        bottom: "calc(4rem + var(--sc-safe-bottom) + 16px)",
        maxWidth: "min(92vw, 420px)",
        width: "max-content",
      }}
    >
      <div
        role="status"
        data-testid="toast-snackbar"
        className="pointer-events-auto rounded-full border border-hairline bg-[#16191F] px-4 py-2.5 text-sm font-medium text-text shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{ animation: "sc-toast-in 180ms cubic-bezier(0.16,1,0.3,1)" }}
      >
        {visible}
      </div>
      <style>{`@keyframes sc-toast-in{from{transform:translateY(8px) scale(0.98);opacity:0}to{transform:translateY(0) scale(1);opacity:1}}`}</style>
    </div>
  );
}
