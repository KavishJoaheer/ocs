import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cx } from "../lib/utils.js";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getFocusable(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
    (node) => node.getAttribute("aria-hidden") !== "true" && node.tabIndex !== -1,
  );
}

function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "lg",
  /** When false, children manage their own scroll (e.g. sticky footer inside form). */
  innerScroll = true,
  labelledBy,
}) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const headingId = labelledBy || titleId;

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const focusables = getFocusable(panel);
    const initial = focusables.find((node) => node.getAttribute("data-modal-initial-focus") != null) || focusables[0];
    window.requestAnimationFrame(() => {
      initial?.focus();
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusable(panelRef.current);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = {
    sm: "max-w-lg",
    md: "max-w-2xl",
    lg: "max-w-3xl",
    xl: "max-w-5xl",
  }[size] || "max-w-3xl";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-x-hidden overscroll-x-none p-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:items-center sm:p-4 sm:py-10">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[rgba(34,72,91,0.42)] backdrop-blur-sm md:bg-ocs-slate/50"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={description ? descriptionId : undefined}
        className={cx(
          "relative z-10 flex w-full min-w-0 max-w-[min(100%,calc(100vw-1.5rem))] max-h-[min(92dvh,100dvh-1.5rem)] flex-col overflow-x-hidden rounded-[28px] border border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(242,251,250,0.94))] p-4 shadow-[0_40px_120px_rgba(34,72,91,0.18)] sm:rounded-[34px] sm:p-6 md:border-transparent md:bg-white md:shadow-md",
          sizeClass,
        )}
      >
        <div className="mb-4 flex shrink-0 items-start justify-between gap-4 sm:mb-6">
          <div className="min-w-0">
            <h3 id={headingId} className="text-xl font-semibold text-slate-950 md:text-ocs-slate">
              {title}
            </h3>
            {description ? (
              <p id={descriptionId} className="mt-2 text-sm text-slate-500 md:text-ocs-grey">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-2xl border border-[rgba(65,200,198,0.18)] p-2 text-[#496874] transition hover:border-[rgba(65,200,198,0.32)] hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2d8f98] md:border-slate-200 md:text-ocs-slate md:hover:border-ocs-teal md:hover:text-ocs-teal"
          >
            <X className="size-5" />
          </button>
        </div>

        <div
          className={cx(
            "min-h-0 min-w-0 flex-1",
            innerScroll ? "overflow-x-hidden overflow-y-auto" : "flex flex-col overflow-hidden",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default Modal;
