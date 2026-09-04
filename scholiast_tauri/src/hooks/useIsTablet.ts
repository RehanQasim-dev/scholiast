import { useEffect, useState } from "react";

export const TABLET_QUERY = "(min-width: 768px) and (max-width: 1280px)";

function computeIsTablet(): boolean {
  if (typeof window === "undefined") return false;

  const hasTouch =
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches);

  const isTabletWidth =
    typeof window.matchMedia === "function"
      ? window.matchMedia(TABLET_QUERY).matches
      : window.innerWidth >= 768 && window.innerWidth <= 1280;

  return Boolean(hasTouch && isTabletWidth);
}

/**
 * Returns true if the device is a tablet touch screen (width between 768px and 1280px
 * with touch capability). Defaults to false in test/SSR environments.
 */
export default function useIsTablet(): boolean {
  const [isTablet, setIsTablet] = useState(computeIsTablet);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const check = () => setIsTablet(computeIsTablet());

    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return isTablet;
}
