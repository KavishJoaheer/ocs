import dayjs from "dayjs";
import { Link } from "react-router-dom";
import { ChevronRight, Clock } from "lucide-react";
import DoctorAvatar from "./DoctorAvatar.jsx";

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
    <article className="visits-crafted-card visits-card max-lg:visits-card-elevate bg-white">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:gap-6">
        {/* Left — date block */}
        <div className="visits-date-block visits-date-block-past shrink-0">
          <span className="visits-date-day visits-date-day--past">{date.format("D")}</span>
          <span className="visits-date-month visits-date-month--past">
            {date.format("MMM").toUpperCase()}
          </span>
        </div>

        {/* Center — visit context */}
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="native-display text-[16px] font-bold leading-snug text-[#1a5c52] lg:text-[17px]">
            {appointment.type}
          </p>

          <div className="mt-2.5 flex items-center gap-2.5">
            <DoctorAvatar name={appointment.doctor_name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-[#22485b]">{appointment.doctor_name}</p>
              <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#5b7f8a]">
                <Clock className="size-3.5 shrink-0 text-[#6b9e95]" strokeWidth={1.75} />
                <span>{dateTimeLabel}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right — status badge */}
        <div className="flex shrink-0 items-center justify-end lg:self-stretch lg:items-center">
          <span className="visits-badge-muted">{statusLabel}</span>
        </div>
      </div>

      {appointment.status !== "cancelled" ? (
        <>
          <div className="visits-card-footer-divider" aria-hidden="true" />
          <Link to={summaryPath} className="visits-summary-link group text-brand-orange">
            <span>View Visit Summary</span>
            <ChevronRight
              className="visits-summary-arrow size-[18px] shrink-0 text-brand-orange"
              strokeWidth={2.25}
            />
          </Link>
        </>
      ) : null}
    </article>
  );
}

export default PastAppointmentCard;
