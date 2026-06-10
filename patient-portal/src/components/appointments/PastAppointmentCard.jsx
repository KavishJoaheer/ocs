import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { ChevronRight, Clock } from "lucide-react";
import DoctorAvatar from "./DoctorAvatar.jsx";

function VisitStatusBadge({ children }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-gray-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">
      {children}
    </span>
  );
}

function PastAppointmentCard({ appointment, isLast = false }) {
  const date = dayjs(appointment.date);
  const dateTimeLabel = appointment.time_window
    ? `${date.format("D MMMM YYYY")} · ${appointment.time_window}`
    : date.format("D MMMM YYYY");

  const summaryPath = appointment.consultation_id
    ? `/health-records/visits/${appointment.consultation_id}`
    : "/health-records";

  const statusLabel = appointment.status === "cancelled" ? "Cancelled" : "Completed";

  return (
    <div className="visits-timeline-item relative max-lg:pl-7 lg:pl-0">
      {!isLast ? (
        <span
          className="absolute top-8 bottom-0 left-[5px] w-px bg-teal-100 lg:hidden"
          aria-hidden="true"
        />
      ) : null}
      <span
        className="absolute top-6 left-0 z-[1] size-2.5 rounded-full border-2 border-teal-300 bg-white lg:hidden"
        aria-hidden="true"
      />

      <article className="visits-crafted-card visits-card max-lg:rounded-2xl max-lg:border-0 max-lg:bg-white max-lg:p-4 max-lg:shadow-none lg:bg-white">
        {/* ── Mobile: compact timeline card ── */}
        <div className="lg:hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold leading-snug text-teal-900">{appointment.type}</p>
              <p className="mt-1 text-[13px] font-semibold text-gray-700">{appointment.doctor_name}</p>
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-gray-400">
                <Clock className="size-3.5 shrink-0 translate-y-px" strokeWidth={1.5} aria-hidden="true" />
                <span>{dateTimeLabel}</span>
              </div>
            </div>
            <VisitStatusBadge>{statusLabel}</VisitStatusBadge>
          </div>

          {appointment.status !== "cancelled" ? (
            <Link
              to={summaryPath}
              className="mt-3 inline-flex items-center gap-0.5 text-[13px] font-medium text-brand-orange no-underline transition-opacity active:opacity-70"
            >
              <span>View Visit Summary</span>
              <ChevronRight className="size-3.5 shrink-0 translate-y-px" strokeWidth={1.75} aria-hidden="true" />
            </Link>
          ) : null}
        </div>

        {/* ── Desktop: itinerary card ── */}
        <div className="hidden flex-col gap-4 p-5 lg:flex lg:flex-row lg:items-center lg:gap-6">
          <div className="visits-date-block visits-date-block-past shrink-0">
            <span className="visits-date-day visits-date-day--past">{date.format("D")}</span>
            <span className="visits-date-month visits-date-month--past">
              {date.format("MMM").toUpperCase()}
            </span>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <p className="native-display text-[17px] font-bold leading-snug text-[#1a5c52]">
              {appointment.type}
            </p>

            <div className="mt-2.5 flex items-center gap-2.5">
              <DoctorAvatar name={appointment.doctor_name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[#22485b]">{appointment.doctor_name}</p>
                <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#5b7f8a]">
                  <Clock className="size-3.5 shrink-0 translate-y-px text-[#6b9e95]" strokeWidth={1.5} />
                  <span>{dateTimeLabel}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end self-stretch lg:items-center">
            <VisitStatusBadge>{statusLabel}</VisitStatusBadge>
          </div>
        </div>

        {appointment.status !== "cancelled" ? (
          <>
            <div className="visits-card-footer-divider hidden lg:block" aria-hidden="true" />
            <Link to={summaryPath} className="visits-summary-link group hidden text-brand-orange lg:flex">
              <span>View Visit Summary</span>
              <ChevronRight
                className="visits-summary-arrow size-[18px] shrink-0 text-brand-orange"
                strokeWidth={1.75}
              />
            </Link>
          </>
        ) : null}
      </article>
    </div>
  );
}

export default PastAppointmentCard;
