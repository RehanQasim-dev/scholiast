import { playerBridge } from "../player/playerBridge";

function formatVideoTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

interface TimestampChipProps {
  seconds: number;
  secondsEnd?: number;
  label?: string;
}

export default function TimestampChip({
  seconds,
  secondsEnd,
  label,
}: TimestampChipProps) {
  return (
    <button
      type="button"
      onClick={() => playerBridge.commands.seekTo(seconds)}
      title={label ?? "Jump to this moment"}
      className="rounded-sm bg-elevated px-1.5 py-0.5 font-mono text-xs tabular-nums text-accent transition-opacity duration-[var(--sc-dur-fast)] ease-out hover:opacity-80"
    >
      {secondsEnd === undefined
        ? formatVideoTime(seconds)
        : `${formatVideoTime(seconds)}–${formatVideoTime(secondsEnd)}`}
    </button>
  );
}
