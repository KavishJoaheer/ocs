import { useCallback, useSyncExternalStore } from "react";

/** High-density inventory tables start at this width. Cards are used below it. */
export const DENSE_TABLE_BREAKPOINT = 1024;

export function useIsMobile(breakpoint = 768) {
  const query = `(max-width: ${breakpoint - 1}px)`;

  const subscribe = useCallback(
    (callback) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", callback);
      return () => mql.removeEventListener("change", callback);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

export function useIsCompactInventory() {
  return useIsMobile(DENSE_TABLE_BREAKPOINT);
}
