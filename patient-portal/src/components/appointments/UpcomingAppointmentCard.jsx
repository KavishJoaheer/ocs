import dayjs from "dayjs";
import { CalendarPlus, Clock } from "lucide-react";
import { downloadAppointmentIcs } from "../../lib/calendarExport.js";
import DoctorAvatar from "./DoctorAvatar.jsx";

function UpcomingAppointmentCard({ appointment, isNextVisit = false }) {
  const date = dayjs(appointment.date);

  return (
    <article className="visits-crafted-card visits-card max-lg:visits-card-elevate bg-white">
      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:gap-6">
        {/* Left — date block */}
        <div className="visits-date-block visits-date-block-upcoming shrink-0">
          <span className="visits-date-day">{date.format("D")}</span>
          <span className="visits-date-month">{date.format("MMM").toUpperCase()}</span>
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
              {appointment.time_window ? (
                <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-[#5b7f8a]">
                  <Clock className="size-3.5 shrink-0 text-[#6b9e95]" strokeWidth={1.75} />
                  <span>{appointment.time_window}</span>
                </div>
              ) : null}
            </div>
          </div>

          {appointment.note ? (
            <p className="mt-2 text-[13px] leading-relaxed text-[#8a9e9a]">{appointment.note}</p>
          ) : null}
        </div>

        {/* Right — badge & calendar action */}
        <div className="flex shrink-0 flex-row items-center justify-between gap-3 border-t border-[rgba(0,0,0,0.04)] pt-4 lg:flex-col lg:items-end lg:justify-center lg:self-stretch lg:border-t-0 lg:pt-0">
          {isNextVisit ? (
            <span className="visits-badge-teal">Next Visit</span>
          ) : (
            <span className="visits-badge-teal-muted">Upcoming</span>
          )}
          <button
            type="button"
            onClick={() => downloadAppointmentIcs(appointment)}
            className="visits-calendar-btn"
          >
            <CalendarPlus className="size-4" strokeWidth={1.75} />
            Add to Calendar
          </button>
        </div>
      </div>
    </article>
  );
}

export default UpcomingAppointmentCard;
