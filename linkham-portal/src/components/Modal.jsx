import { useEffect } from "react";
import { X } from "lucide-react";
import { cx } from "../lib/utils.js";

function Modal({
  open,
  onClose,
  title,
  description,
  children,
  size = "lg",
  /** When false, children manage their own scroll (e.g. sticky footer inside form). */
  innerScroll = true,
}) {
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = {
    md: "max-w-2xl",
    lg: "max-w-3xl",
    xl: "max-w-5xl",
  }[size];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-x-hidden overscroll-x-none p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:items-center sm:py-10">
      <button
        aria-label="Close modal"
        className="absolute inset-0 bg-[rgba(34,72,91,0.42)] backdrop-blur-sm"
        onClick={onClose}
        type="button"
      />

      <div
        className={cx(
          "relative z-10 flex w-full min-w-0 max-w-[min(100%,calc(100vw-2rem))] max-h-[min(90vh,100dvh-2rem)] flex-col overflow-x-hidden rounded-[34px] border border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(242,251,250,0.94))] p-4 shadow-[0_40px_120px_rgba(34,72,91,0.18)] sm:p-6",
          sizeClass,
        )}
      >
        <div className="mb-6 flex shrink-0 items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-slate-950">{title}</h3>
            {description ? <p className="mt-2 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-[rgba(65,200,198,0.18)] p-2 text-[#496874] transition hover:border-[rgba(65,200,198,0.32)] hover:text-slate-900"
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
