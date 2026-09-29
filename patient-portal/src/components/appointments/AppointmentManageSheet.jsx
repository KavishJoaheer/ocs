import { useEffect, useRef } from "react";
import { CalendarDays, CalendarX2, ChevronRight, X } from "lucide-react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { useScrollLock } from "../../hooks/useScrollLock.js";

function AppointmentManageSheet({ open, appointment, onSelect, onClose }) {
  const sheetRef = useRef(null);
  useScrollLock(open);
  useFocusTrap(open, sheetRef);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !appointment) return null;

  return (
    <div ref={sheetRef} className="fixed inset-0 z-[var(--z-sheet)]" role="dialog" aria-modal="true" aria-labelledby="appointment-manage-title">
      <button type="button" aria-label="Close" onClick={onClose} className="animate-sheet-overlay absolute inset-0 bg-[rgba(13,42,46,0.5)]" />
      <div className="animate-sheet-up absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg rounded-t-[24px] bg-white pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-8px_40px_rgba(13,42,46,0.18)] lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-[24px]">
        <div className="flex justify-center pt-3 lg:hidden">
          <span className="h-[5px] w-[40px] rounded-full bg-[rgba(13,42,46,0.18)]" aria-hidden="true" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            <h2 id="appointment-manage-title" className="native-display text-[22px] leading-tight text-[#1a5c52]">Manage appointment</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-[#5b7f8a]">The clinic confirms every request before your appointment changes.</p>
          </div>
          <button type="button" onClick={onClose} className="flex size-10 shrink-0 items-center justify-center rounded-full text-[#8a9e9a] transition hover:bg-[rgba(26,160,140,0.08)]" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-4 space-y-2 px-5 pb-5">
          <button type="button" onClick={() => onSelect("reschedule")} className="flex w-full items-center gap-3 rounded-2xl border border-teal-100 px-4 py-4 text-left transition hover:bg-teal-50/60">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#d9f6f3] text-[#1f7777]"><CalendarDays className="size-5" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-[#1a5c52]">Request another date</span><span className="mt-0.5 block text-[12px] leading-relaxed text-[#6e8587]">Tell the clinic which date works better for you.</span></span>
            <ChevronRight className="size-5 shrink-0 text-[#8a9e9a]" />
          </button>
          <button type="button" onClick={() => onSelect("cancel")} className="flex w-full items-center gap-3 rounded-2xl border border-rose-100 px-4 py-4 text-left transition hover:bg-rose-50/60">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><CalendarX2 className="size-5" /></span>
            <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-[#1a5c52]">Ask the clinic to cancel</span><span className="mt-0.5 block text-[12px] leading-relaxed text-[#6e8587]">Send a cancellation request for confirmation.</span></span>
            <ChevronRight className="size-5 shrink-0 text-[#8a9e9a]" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default AppointmentManageSheet;
