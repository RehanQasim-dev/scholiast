import { PREF_DEFAULTS, PREF_KEYS } from "../../lib/store";
import { usePref } from "./usePref";

export default function AppearanceSection() {
  const [density, setDensity] = usePref(
    PREF_KEYS.density,
    String(PREF_DEFAULTS[PREF_KEYS.density]),
  );

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        Density
        <select
          value={density}
          onChange={(event) => setDensity(event.target.value)}
          data-testid="pref-appearance.density"
          className="mt-1 w-full max-w-48 rounded-sm border border-hairline bg-surface px-2 py-1.5"
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <p className="text-xs text-text-2">Scholiast is dark-only for now.</p>
    </div>
  );
}
