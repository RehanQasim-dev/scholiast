import { useEffect, useState } from "react";
import { getPref, setPref, PREF_KEYS } from "../../lib/store";
import { toast } from "../Toast";

export default function ExcalidrawSettingsSection() {
  const [roughness, setRoughness] = useState<number>(1);
  const [grid, setGrid] = useState<string>("dots");
  const [penCurve, setPenCurve] = useState<string>("soft");
  const [exportScale, setExportScale] = useState<number>(2);

  useEffect(() => {
    void getPref<number>(PREF_KEYS.excalidrawRoughness, 1).then(setRoughness);
    void getPref<string>(PREF_KEYS.excalidrawGrid, "dots").then(setGrid);
    void getPref<string>(PREF_KEYS.excalidrawPenCurve, "soft").then(setPenCurve);
    void getPref<number>(PREF_KEYS.excalidrawExportScale, 2).then(setExportScale);
  }, []);

  async function updateRoughness(val: number) {
    setRoughness(val);
    await setPref(PREF_KEYS.excalidrawRoughness, val);
    toast("Canvas roughness updated");
  }

  async function updateGrid(val: string) {
    setGrid(val);
    await setPref(PREF_KEYS.excalidrawGrid, val);
    toast("Grid style updated");
  }

  async function updatePenCurve(val: string) {
    setPenCurve(val);
    await setPref(PREF_KEYS.excalidrawPenCurve, val);
    toast("Stylus sensitivity curve updated");
  }

  async function updateExportScale(val: number) {
    setExportScale(val);
    await setPref(PREF_KEYS.excalidrawExportScale, val);
    toast("Export resolution updated");
  }

  return (
    <div className="space-y-6 text-sm text-text">
      {/* Stroke Roughness / Style */}
      <div className="space-y-2">
        <div className="flex flex-col">
          <span className="font-medium text-text">Stroke Roughness</span>
          <span className="text-xs text-text-3">
            Controls the hand-drawn sketchiness of shapes and arrows
          </span>
        </div>
        <div className="flex rounded-lg border border-hairline bg-base p-1 gap-1">
          {[
            { val: 0, label: "Architect (Clean)" },
            { val: 1, label: "Artist (Hand-drawn)" },
            { val: 2, label: "Cartoonist" },
          ].map((item) => (
            <button
              key={item.val}
              type="button"
              onClick={() => void updateRoughness(item.val)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                roughness === item.val
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-2 hover:bg-elevated hover:text-text"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stylus / S-Pen Pressure Curve */}
      <div className="space-y-2">
        <div className="flex flex-col">
          <span className="font-medium text-text">Stylus & S-Pen Sensitivity</span>
          <span className="text-xs text-text-3">
            Hardware pressure curve response on Samsung Galaxy Tab S7+ & active styluses
          </span>
        </div>
        <div className="flex rounded-lg border border-hairline bg-base p-1 gap-1">
          {[
            { val: "linear", label: "Linear (Standard)" },
            { val: "soft", label: "Soft (High Sensitivity)" },
            { val: "firm", label: "Firm (Controlled)" },
          ].map((item) => (
            <button
              key={item.val}
              type="button"
              onClick={() => void updatePenCurve(item.val)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                penCurve === item.val
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-2 hover:bg-elevated hover:text-text"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid Style */}
      <div className="space-y-2">
        <div className="flex flex-col">
          <span className="font-medium text-text">Canvas Grid & Snapping</span>
          <span className="text-xs text-text-3">
            Background guide grid for architectural alignment
          </span>
        </div>
        <div className="flex rounded-lg border border-hairline bg-base p-1 gap-1">
          {[
            { val: "none", label: "None (Blank)" },
            { val: "dots", label: "Dots (Subtle)" },
            { val: "crosshatch", label: "Crosshatch (Grid)" },
          ].map((item) => (
            <button
              key={item.val}
              type="button"
              onClick={() => void updateGrid(item.val)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                grid === item.val
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-2 hover:bg-elevated hover:text-text"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Export Scale */}
      <div className="space-y-2">
        <div className="flex flex-col">
          <span className="font-medium text-text">Export PNG Resolution</span>
          <span className="text-xs text-text-3">
            Render resolution for diagram images saved into comment cards and synced to Drive
          </span>
        </div>
        <div className="flex rounded-lg border border-hairline bg-base p-1 gap-1">
          {[
            { val: 1, label: "1× (Standard 72 DPI)" },
            { val: 2, label: "2× (Retina 144 DPI)" },
            { val: 3, label: "3× (Ultra Sharp)" },
          ].map((item) => (
            <button
              key={item.val}
              type="button"
              onClick={() => void updateExportScale(item.val)}
              className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                exportScale === item.val
                  ? "bg-accent text-white shadow-sm"
                  : "text-text-2 hover:bg-elevated hover:text-text"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
