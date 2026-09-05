import { PREF_DEFAULTS, PREF_KEYS } from "../../lib/store";
import { usePref } from "./usePref";
import ThemedSelect from "./ThemedSelect";

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
      <div className="flex flex-col gap-1.5 text-sm text-text-2">
        <span>Seek step size</span>
        <ThemedSelect
          value={seekStep}
          onChange={(next) => void setSeekStep(next)}
          options={SEEK_STEPS}
          testId="pref-playback.seek_step"
          ariaLabel="Seek step size"
        />
      </div>
    </div>
  );
}
