import { PREF_DEFAULTS, PREF_KEYS } from "../../lib/store";
import { usePref } from "./usePref";

const SPEEDS = ["0.25", "0.5", "0.75", "1", "1.25", "1.5", "1.75", "2"];
const SEEK_STEPS = [
  ["5", "5 seconds"],
  ["10", "10 seconds"],
  ["15", "15 seconds"],
  ["30", "30 seconds"],
] as const;

export default function PlaybackSection() {
  const [speed, setSpeed] = usePref(
    PREF_KEYS.defaultSpeed,
    String(PREF_DEFAULTS[PREF_KEYS.defaultSpeed]),
  );
  const [seekStep, setSeekStep] = usePref(
    PREF_KEYS.seekStep,
    String(PREF_DEFAULTS[PREF_KEYS.seekStep]),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm text-text-2">
        Default playback speed
        <select
          value={speed}
          onChange={(event) => setSpeed(event.target.value)}
          data-testid="pref-playback.default_speed"
          className="mt-1 h-14 w-full rounded-md border border-hairline bg-elevated px-3 text-sm text-text outline-none focus:border-accent"
        >
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-text-2">
        Seek step size
        <select
          value={seekStep}
          onChange={(event) => setSeekStep(event.target.value)}
          data-testid="pref-playback.seek_step"
          className="mt-1 h-14 w-full rounded-md border border-hairline bg-elevated px-3 text-sm text-text outline-none focus:border-accent"
        >
          {SEEK_STEPS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
