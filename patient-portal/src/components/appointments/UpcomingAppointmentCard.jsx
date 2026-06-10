import dayjs from "dayjs";
import { CalendarPlus, Clock } from "lucide-react";
import { downloadAppointmentIcs } from "../../lib/calendarExport.js";
import DoctorAvatar from "./DoctorAvatar.jsx";

function VisitStatusBadge({ children, tone = "teal" }) {
  const toneClass =
    tone === "muted"
      ? "bg-gray-100 text-gray-500"
      : tone === "teal-muted"
        ? "bg-teal-50/80 text-teal-700"
        : "bg-teal-50 text-teal-800";

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

  function handleAddToCalendar() {
    downloadAppointmentIcs(appointment);
  }

  return (
    <article className="visits-featured-card visits-crafted-card visits-card max-lg:overflow-hidden max-lg:rounded-3xl max-lg:border max-lg:border-teal-100 max-lg:bg-white max-lg:shadow-sm lg:bg-white">
      {/* ── Mobile: featured card ── */}
      <div className="lg:hidden">
        <div className="p-5">
          <div className="flex gap-4">
            <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-teal-50 text-teal-900">
              <span className="text-xl font-bold leading-none">{date.format("D")}</span>
              <span className="mt-0.5 text-[10px] font-bold tracking-wide">
                {date.format("MMM").toUpperCase()}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="text-[15px] font-bold leading-snug text-teal-900">{appointment.type}</p>
                <VisitStatusBadge>{isNextVisit ? "Next Visit" : "Upcoming"}</VisitStatusBadge>
              </div>

              <p className="text-[14px] font-semibold text-gray-800">{appointment.doctor_name}</p>

              {appointment.time_window ? (
                <div className="mt-1 flex items-center gap-1.5 text-[13px] text-gray-500">
                  <Clock className="size-3.5 shrink-0 translate-y-px" strokeWidth={1.5} aria-hidden="true" />
                  <span>{appointment.time_window}</span>
                </div>
              ) : null}

              {appointment.note ? (
                <p className="mt-2 text-[13px] leading-relaxed text-gray-400">{appointment.note}</p>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleAddToCalendar}
          className="flex w-full cursor-pointer items-center justify-center gap-2 border-t border-teal-50 py-3.5 text-[14px] font-semibold text-brand-orange transition-colors duration-200 active:bg-teal-50/40"
        >
          <CalendarPlus className="size-4 shrink-0 translate-y-px" strokeWidth={1.5} aria-hidden="true" />
          Add to Calendar
        </button>
      </div>

      {/* ── Desktop: itinerary card ── */}
      <div className="hidden flex-col gap-4 p-5 lg:flex lg:flex-row lg:items-center lg:gap-6">
        <div className="visits-date-block visits-date-block-upcoming shrink-0">
          <span className="visits-date-day">{date.format("D")}</span>
          <span className="visits-date-month">{date.format("MMM").toUpperCase()}</span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <p className="native-display text-[17px] font-bold leading-snug text-[#1a5c52]">
            {appointment.type}
          </p>

          <div className="mt-2.5 flex items-center gap-2.5">
            <DoctorAvatar name={appointment.doctor_name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-[#22485b]">{appointment.doctor_name}</p>
              {appointment.time_window ? (
                <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#5b7f8a]">
                  <Clock className="size-3.5 shrink-0 translate-y-px text-[#6b9e95]" strokeWidth={1.5} />
                  <span>{appointment.time_window}</span>
                </div>
              ) : null}
            </div>
          </div>

          {appointment.note ? (
            <p className="mt-2 text-[13px] leading-relaxed text-[#8a9e9a]">{appointment.note}</p>
          ) : null}
        </div>

        <div className="flex w-auto shrink-0 flex-col items-end justify-center self-stretch">
          <VisitStatusBadge tone={isNextVisit ? "teal" : "teal-muted"}>
            {isNextVisit ? "Next Visit" : "Upcoming"}
          </VisitStatusBadge>
        </div>
      </div>

      <div className="hidden border-t border-gray-100 lg:block" aria-hidden="true" />
      <div className="hidden items-center justify-end px-5 py-[14px] pb-4 lg:flex">
        <button
          type="button"
          onClick={handleAddToCalendar}
          className="flex cursor-pointer items-center gap-2 text-[14px] font-medium text-brand-orange transition-colors duration-200 hover:text-[#c88710]"
        >
          <CalendarPlus className="size-4 shrink-0 translate-y-px" strokeWidth={1.5} aria-hidden="true" />
          Add to Calendar
        </button>
      </div>
    </article>
  );
}

export default UpcomingAppointmentCard;
