import { PREF_DEFAULTS, PREF_KEYS } from "../../lib/store";
import { usePref } from "./usePref";

export default function AppearanceSection() {
  const [density, setDensity] = usePref(
    PREF_KEYS.density,
    String(PREF_DEFAULTS[PREF_KEYS.density]),
  );

  return (
    <div className="space-y-3">
      <label className="block text-sm text-text-2">
        Density
        <select
          value={density}
          onChange={(event) => setDensity(event.target.value)}
          data-testid="pref-appearance.density"
          className="mt-1 h-14 w-full max-w-48 rounded-md border border-hairline bg-elevated px-3 text-sm text-text outline-none focus:border-accent"
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <p className="text-xs text-text-2">Scholiast is dark-only for now.</p>
    </div>
  );
}
