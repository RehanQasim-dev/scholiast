import { useEffect, useState } from "react";
import { getPref, setPref } from "../../lib/store";

/** Loads a pref once, keeps it editable locally and persists every change. */
export function usePref(key: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPref(key, fallback).then((stored) => {
      if (!cancelled) {
        setValue(stored);
        setLoaded(true);
      }
    }).catch(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = (next: string) => {
    setValue(next);
    if (loaded) void setPref(key, next).catch(() => {});
  };

  return [value, update];
}
