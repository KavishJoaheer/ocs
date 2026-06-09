import { useEffect } from "react";

/** Locks document and main scroll container while overlays are open. */
export function useScrollLock(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;

    const main = document.getElementById("app-main-scroll");
    const previousBodyOverflow = document.body.style.overflow;
    const previousMainOverflow = main?.style.overflow ?? "";
    const previousMainOverscroll = main?.style.overscrollBehavior ?? "";

    document.body.style.overflow = "hidden";
    if (main) {
      main.style.overflow = "hidden";
      main.style.overscrollBehavior = "none";
    }

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (main) {
        main.style.overflow = previousMainOverflow;
        main.style.overscrollBehavior = previousMainOverscroll;
      }
    };
  }, [enabled]);
}
