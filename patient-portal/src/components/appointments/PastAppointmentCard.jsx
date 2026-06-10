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
      <div className="flex items-start gap-4 p-5">
        <div className="visits-date-block visits-date-block-past">
          <span className="visits-date-day">{date.format("D")}</span>
          <span className="visits-date-month">{date.format("MMM").toUpperCase()}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="native-display text-[16px] font-bold leading-snug text-[#1a5c52]">
              {appointment.type}
            </p>
            <span className="visits-badge-muted shrink-0">{statusLabel}</span>
          </div>

          <div className="mt-2.5 flex items-center gap-2.5">
            <DoctorAvatar name={appointment.doctor_name} size="md" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#22485b]">{appointment.doctor_name}</p>
              <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#5b7f8a]">
                <Clock className="size-3.5 shrink-0 text-[#6b9e95]" strokeWidth={1.75} />
                <span>{dateTimeLabel}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {appointment.status !== "cancelled" ? (
        <>
          <div className="visits-card-footer-divider" aria-hidden="true" />
          <Link to={summaryPath} className="visits-summary-link group">
            <span>View Visit Summary</span>
            <ChevronRight
              className="visits-summary-arrow size-[18px] text-[#e8a020]"
              strokeWidth={2.25}
            />
          </Link>
        </>
      ) : null}
    </article>
  );
}

export default PastAppointmentCard;
