import { PREF_DEFAULTS, PREF_KEYS } from "../../lib/store";
import { usePref } from "./usePref";

export default function AppearanceSection() {
  const [density, setDensity] = usePref(
    PREF_KEYS.density,
    String(PREF_DEFAULTS[PREF_KEYS.density]),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-text">Display Density</div>
          <div className="text-xs text-text-3 mt-0.5">Controls UI spacing, list density, and card padding</div>
        </div>
        <div className="flex items-center rounded-lg border border-hairline bg-base p-1 gap-1 self-start sm:self-auto">
          {[
            { id: "comfortable", label: "Comfortable" },
            { id: "compact", label: "Compact" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void setDensity(item.id)}
              className={`rounded-md px-4 py-2 text-xs font-medium transition-all ${
                density === item.id
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-2 hover:text-text hover:bg-elevated/60"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-text-3">Scholiast uses an OLED Pitch Black theme by default.</p>
    </div>
  );
}
