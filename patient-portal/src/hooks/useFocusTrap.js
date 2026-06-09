import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

/** Traps keyboard focus inside an open overlay for accessibility. */
export function useFocusTrap(enabled, containerRef) {
  const previouslyFocusedRef = useRef(null);

  useEffect(() => {
    if (!enabled || !containerRef.current) return undefined;

    const container = containerRef.current;
    previouslyFocusedRef.current = document.activeElement;

    const focusable = getFocusableElements(container);
    (focusable[0] || container).focus();

    function handleKeyDown(event) {
      if (event.key !== "Tab") return;

      const nodes = getFocusableElements(container);
      if (nodes.length === 0) return;

      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    container.addEventListener("keydown", handleKeyDown);

    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocusedRef.current?.focus) {
        previouslyFocusedRef.current.focus();
      }
    };
  }, [enabled, containerRef]);
}
