import { useEffect, useState } from "react";
import { PREF_DEFAULTS, PREF_KEYS, getPref } from "../lib/store";

/** Reads `playback.seek_step` (seconds) for arrow-key and double-tap seeks. */
export function useSeekStep(): number {
  const fallback = Number(PREF_DEFAULTS[PREF_KEYS.seekStep]) || 10;
  const [step, setStep] = useState(fallback);

  useEffect(() => {
    let cancelled = false;
    getPref<string | number>(PREF_KEYS.seekStep, fallback).then(
      (stored) => {
        if (cancelled) return;
        const parsed = Number(stored);
        setStep(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [fallback]);

  return step;
}
