import { useEffect, useState } from "react";

export const NARROW_QUERY = "(max-width: 900px)";

function computeNarrow(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(NARROW_QUERY).matches
  );
}

/** True below 900px (phones / narrow tablets). Defaults false where
 * matchMedia is unavailable (tests), keeping desktop rendering untouched. */
export default function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(computeNarrow);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return narrow;
}
