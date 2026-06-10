import { useEffect, useState } from "react";

/** Tracks virtual-keyboard inset for fixed bottom sheets on mobile browsers. */
export function useKeyboardOffset(enabled) {
  const [inset, setInset] = useState({ bottom: 0, top: 0 });

  useEffect(() => {
    if (!enabled) {
      setInset({ bottom: 0, top: 0 });
      return undefined;
    }

    if (typeof window === "undefined" || !window.visualViewport) {
      return undefined;
    }

    const viewport = window.visualViewport;

    function updateInset() {
      const bottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setInset({ bottom, top: viewport.offsetTop });
    }

    viewport.addEventListener("resize", updateInset);
    viewport.addEventListener("scroll", updateInset);
    updateInset();

    return () => {
      viewport.removeEventListener("resize", updateInset);
      viewport.removeEventListener("scroll", updateInset);
    };
  }, [enabled]);

  return inset;
}
