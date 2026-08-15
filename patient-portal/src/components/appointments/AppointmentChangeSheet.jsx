import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { api } from "../../lib/api.js";
import { dispatchPatientDataChange } from "../../lib/patientDataSync.js";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { useScrollLock } from "../../hooks/useScrollLock.js";

function tomorrowIso() {
  return dayjs().add(1, "day").format("YYYY-MM-DD");
}

function AppointmentChangeSheet({ open, appointment, requestType, onClose }) {
  const sheetRef = useRef(null);
  const isReschedule = requestType === "reschedule";
  const [preferredDate, setPreferredDate] = useState(tomorrowIso());
  const [preferredTime, setPreferredTime] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useScrollLock(open);
  useFocusTrap(open, sheetRef);

  useEffect(() => {
    if (!open) return undefined;
    setPreferredDate(tomorrowIso());
    setPreferredTime("");
    setMessage("");
    setSubmitting(false);
    return undefined;
  }, [open, requestType, appointment?.id]);

  useEffect(() => {
    if (!open) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !appointment || !requestType) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    if (isReschedule && preferredDate < tomorrowIso()) {
      toast.error("Please choose a date from tomorrow onwards.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/patient-portal/appointment-change-requests", {
        appointment_id: appointment.id,
        request_type: requestType,
        patient_message: message,
        preferred_date: isReschedule ? preferredDate : null,
        preferred_time: isReschedule ? preferredTime || null : null,
      });
      toast.success("Sent to the clinic. They will confirm before anything changes.");
      dispatchPatientDataChange();
      onClose();
    } catch (error) {
      toast.error(error.message || "Could not send this request.");
    } finally {
      setSubmitting(false);
    }
  }

  const title = isReschedule ? "Change the date" : "Ask the clinic to cancel";
  const submitLabel = isReschedule ? "Ask the clinic to reschedule" : "Ask the clinic to cancel";

  return (
    <div
      ref={sheetRef}
      className="fixed inset-0 z-[var(--z-sheet)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appointment-change-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-sheet-overlay absolute inset-0 bg-[rgba(13,42,46,0.5)]"
      />
      <div className="animate-sheet-up absolute inset-x-0 bottom-0 mx-auto flex max-h-[min(85dvh,100dvh-env(safe-area-inset-bottom,0px))] w-full max-w-lg flex-col rounded-t-[24px] bg-white pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-8px_40px_rgba(13,42,46,0.18)] lg:bottom-auto lg:top-1/2 lg:-translate-y-1/2 lg:rounded-[24px]">
        <div className="flex justify-center pt-3 lg:hidden">
          <span className="h-[5px] w-[40px] rounded-full bg-[rgba(13,42,46,0.18)]" aria-hidden="true" />
        </div>
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <div>
            <h2 id="appointment-change-title" className="native-display text-[22px] leading-tight text-[#1a5c52]">
              {title}
            </h2>
            <p className="mt-1 text-[14px] leading-relaxed text-[#5b7f8a]">
              The clinic will confirm before anything changes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-[#8a9e9a] transition hover:bg-[rgba(26,160,140,0.08)] hover:text-[#1a5c52]"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        <form className="mt-4 space-y-4 overflow-y-auto px-5 pb-5" onSubmit={handleSubmit}>
          {isReschedule ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[12px] font-semibold uppercase tracking-wide text-[#6e949b]">
                Preferred date
                <input
                  required
                  type="date"
                  min={tomorrowIso()}
                  value={preferredDate}
                  onChange={(event) => setPreferredDate(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-teal-100 px-3 py-2.5 text-sm text-[#1a5c52]"
                />
              </label>
              <label className="text-[12px] font-semibold uppercase tracking-wide text-[#6e949b]">
                Preferred time
                <input
                  type="time"
                  value={preferredTime}
                  onChange={(event) => setPreferredTime(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-teal-100 px-3 py-2.5 text-sm text-[#1a5c52]"
                />
              </label>
            </div>
          ) : null}
          <label className="block text-[12px] font-semibold uppercase tracking-wide text-[#6e949b]">
            Note for the clinic
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              placeholder="Optional — tell us why"
              className="mt-1.5 w-full rounded-xl border border-teal-100 px-3 py-2.5 text-sm text-[#1a5c52]"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="request-wizard-primary-btn w-full disabled:opacity-50"
          >
            {submitting ? "Sending..." : submitLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 text-center text-[13px] font-semibold text-[#8a9e9a]"
          >
            Keep this appointment
          </button>
        </form>
      </div>
    </div>
  );
}

export default AppointmentChangeSheet;
