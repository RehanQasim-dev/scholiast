import { useEffect, useState } from "react";

type Listener = (message: string) => void;
let listener: Listener | null = null;

export function toast(message: string) {
  listener?.(message);
}

export function ToastHost({ durationMs = 4000 }: { durationMs?: number }) {
  const [items, setItems] = useState<{ id: number; message: string }[]>([]);

  useEffect(() => {
    let seq = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    listener = (message: string) => {
      const id = ++seq;
      setItems((prev) => [...prev.slice(-2), { id, message }]);
      timers.push(
        setTimeout(
          () => setItems((prev) => prev.filter((i) => i.id !== id)),
          durationMs,
        ),
      );
    };
    return () => {
      listener = null;
      timers.forEach(clearTimeout);
    };
  }, [durationMs]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-md border border-hairline bg-elevated px-4 py-2 text-sm text-text shadow-lg"
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
