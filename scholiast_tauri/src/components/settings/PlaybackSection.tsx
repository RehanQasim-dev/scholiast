import { PREF_DEFAULTS, PREF_KEYS } from "../../lib/store";
import { usePref } from "./usePref";

const SEEK_STEPS = [
  ["5", "5 seconds"],
  ["10", "10 seconds"],
  ["15", "15 seconds"],
  ["30", "30 seconds"],
] as const;

export default function PlaybackSection() {
  const [seekStep, setSeekStep] = usePref(
    PREF_KEYS.seekStep,
    String(PREF_DEFAULTS[PREF_KEYS.seekStep]),
  );

  return (
    <div className="grid gap-3 sm:grid-cols-1">
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
