import { useState } from "react";
import dayjs from "dayjs";
import { CalendarPlus, Clock } from "lucide-react";
import { downloadAppointmentIcs } from "../../lib/calendarExport.js";
import AppointmentChangeSheet from "./AppointmentChangeSheet.jsx";
import DoctorAvatar from "./DoctorAvatar.jsx";

function VisitStatusBadge({ children, tone = "teal" }) {
  const toneClass =
    tone === "muted"
      ? "bg-gray-100 text-gray-500"
      : tone === "teal-muted"
        ? "bg-teal-50/80 text-teal-700 lg:bg-brand-teal/10 lg:text-brand-dark-grey"
        : "bg-teal-50 text-teal-800 lg:bg-brand-teal/10 lg:text-brand-dark-grey";

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${toneClass}`}
    >
      {children}
    </span>
  );
}

function UpcomingAppointmentCard({ appointment, isNextVisit = false }) {
  const date = dayjs(appointment.date);
  const [sheetType, setSheetType] = useState("");
  const pending = appointment.pending_change;
  const canRequestChange =
    appointment.kind !== "review" &&
    Number.isInteger(Number(appointment.id)) &&
    !String(appointment.id).startsWith("review-");

  function handleAddToCalendar() {
    downloadAppointmentIcs(appointment);
  }

  return (
    <article className="visits-featured-card visits-crafted-card visits-card overflow-hidden rounded-2xl border border-teal-500/10 bg-white shadow-sm lg:rounded-[18px] lg:border-0 lg:shadow-none">
      {/* ── Mobile ── */}
      <div className="flex flex-col p-5 lg:hidden">
        <div className="flex gap-4">
          <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-teal-50 text-teal-900">
            <span className="text-xl font-bold leading-none">{date.format("D")}</span>
            <span className="mt-0.5 text-[10px] font-bold tracking-wide">
              {date.format("MMM").toUpperCase()}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[17px] font-bold leading-snug text-teal-900">{appointment.type}</p>
              <VisitStatusBadge>{isNextVisit ? "Next Visit" : "Upcoming"}</VisitStatusBadge>
            </div>

            <p className="mt-1 text-[15px] font-medium text-gray-800">{appointment.doctor_name}</p>

            {appointment.time_window ? (
              <div className="mt-1 flex items-center gap-1.5 text-[13px] text-gray-500">
                <Clock className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                <span>{appointment.time_window}</span>
              </div>
            ) : null}

            {appointment.note ? (
              <p className="mt-1.5 text-[13px] leading-snug text-gray-500">{appointment.note}</p>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-teal-500/10 pt-4">
          <button
            type="button"
            onClick={handleAddToCalendar}
            className="flex min-h-[44px] items-center gap-2 text-[15px] font-semibold text-brand-gold transition-colors active:opacity-80"
          >
            <CalendarPlus className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
            Add to Calendar
          </button>
          {pending ? (
            <p className="text-[13px] text-[#2d8f98]">
              {pending.request_type === "cancel" ? "Cancel" : "Reschedule"} request is with the clinic.
              They will confirm before anything changes.
            </p>
          ) : canRequestChange ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSheetType("reschedule")}
                className="rounded-xl bg-[#2d8f98] px-4 py-2.5 text-[13px] font-semibold text-white"
              >
                Change the date
              </button>
              <button
                type="button"
                onClick={() => setSheetType("cancel")}
                className="rounded-xl border border-[#c23a2f]/30 px-4 py-2.5 text-[13px] font-semibold text-[#c23a2f]"
              >
                Cancel this visit
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Desktop ── */}
      <div className="hidden flex-col gap-4 p-5 lg:flex lg:flex-row lg:items-center lg:gap-6">
        <div className="visits-date-block visits-date-block-upcoming shrink-0">
          <span className="visits-date-day">{date.format("D")}</span>
          <span className="visits-date-month">{date.format("MMM").toUpperCase()}</span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <p className="native-display text-[17px] font-bold leading-snug text-brand-dark-grey">
            {appointment.type}
          </p>

          <div className="mt-2.5 flex items-center gap-2.5">
            <DoctorAvatar name={appointment.doctor_name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-brand-dark-grey">{appointment.doctor_name}</p>
              {appointment.time_window ? (
                <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-brand-cool-grey">
                  <Clock className="size-3.5 shrink-0 text-brand-teal" strokeWidth={1.5} />
                  <span>{appointment.time_window}</span>
                </div>
              ) : null}
            </div>
          </div>

          {appointment.note ? (
            <p className="mt-2 text-[13px] leading-relaxed text-brand-cool-grey">{appointment.note}</p>
          ) : null}
        </div>

        <div className="flex w-auto shrink-0 flex-col items-end justify-center self-stretch">
          <VisitStatusBadge tone={isNextVisit ? "teal" : "teal-muted"}>
            {isNextVisit ? "Next Visit" : "Upcoming"}
          </VisitStatusBadge>
        </div>
      </div>

      <div className="hidden border-t border-brand-teal/20 lg:block" aria-hidden="true" />
      <div className="hidden items-center justify-between gap-3 px-5 py-[14px] pb-4 lg:flex">
        <button
          type="button"
          onClick={handleAddToCalendar}
          className="flex cursor-pointer items-center gap-2 text-[14px] font-medium text-ocs-yellow transition-colors duration-200 hover:text-ocs-yellow-dark"
        >
          <CalendarPlus className="size-4 shrink-0" strokeWidth={1.5} aria-hidden="true" />
          Add to Calendar
        </button>
        {pending ? (
          <p className="max-w-[240px] text-right text-[13px] text-[#2d8f98]">
            {pending.request_type === "cancel" ? "Cancel" : "Reschedule"} request is with the clinic.
            They will confirm before anything changes.
          </p>
        ) : canRequestChange ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSheetType("reschedule")}
              className="rounded-xl bg-[#2d8f98] px-4 py-2 text-[13px] font-semibold text-white"
            >
              Change the date
            </button>
            <button
              type="button"
              onClick={() => setSheetType("cancel")}
              className="rounded-xl border border-[#c23a2f]/30 px-4 py-2 text-[13px] font-semibold text-[#c23a2f]"
            >
              Cancel this visit
            </button>
          </div>
        ) : null}
      </div>

      <AppointmentChangeSheet
        open={Boolean(sheetType)}
        appointment={appointment}
        requestType={sheetType}
        onClose={() => setSheetType("")}
      />
    </article>
  );
}

export default UpcomingAppointmentCard;
