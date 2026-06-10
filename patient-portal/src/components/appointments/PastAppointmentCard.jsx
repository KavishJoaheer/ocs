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

function PastAppointmentCard({ appointment }) {
  const date = dayjs(appointment.date);
  const dateTimeLabel = appointment.time_window
    ? `${date.format("D MMMM YYYY")} · ${appointment.time_window}`
    : date.format("D MMMM YYYY");

  const summaryPath = appointment.consultation_id
    ? `/health-records/visits/${appointment.consultation_id}`
    : "/health-records";

  const statusLabel = appointment.status === "cancelled" ? "Cancelled" : "Completed";

  return (
    <article className="visits-crafted-card visits-card overflow-hidden rounded-2xl border border-teal-500/10 bg-white shadow-sm lg:rounded-[18px] lg:border-0 lg:shadow-none">
      {/* ── Mobile ── */}
      <div className="flex flex-col p-5 lg:hidden">
        <div className="flex gap-4">
          <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-gray-50 text-gray-600">
            <span className="text-xl font-bold leading-none">{date.format("D")}</span>
            <span className="mt-0.5 text-[10px] font-bold tracking-wide">
              {date.format("MMM").toUpperCase()}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[17px] font-bold leading-snug text-teal-900">{appointment.type}</p>
              <VisitStatusBadge>{statusLabel}</VisitStatusBadge>
            </div>

            <p className="mt-1 text-[15px] font-medium text-gray-800">{appointment.doctor_name}</p>

            <div className="mt-1 flex items-center gap-1.5 text-[13px] text-gray-500">
              <Clock className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span>{dateTimeLabel}</span>
            </div>
          </div>
        </div>

        {appointment.status !== "cancelled" ? (
          <div className="mt-4 flex gap-4 border-t border-teal-500/10 pt-4">
            <div className="w-16 shrink-0" aria-hidden="true" />
            <Link
              to={summaryPath}
              className="flex min-h-[44px] items-center gap-0.5 text-[15px] font-semibold text-brand-orange no-underline transition-opacity active:opacity-80"
            >
              <span>View Visit Summary</span>
              <ChevronRight className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </div>

      {/* ── Desktop ── */}
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
                <Clock className="size-3.5 shrink-0 text-[#6b9e95]" strokeWidth={1.5} />
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
  );
}

export default PastAppointmentCard;
