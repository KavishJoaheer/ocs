import dayjs from "dayjs";
import { CalendarPlus, Clock } from "lucide-react";
import { downloadAppointmentIcs } from "../../lib/calendarExport.js";
import DoctorAvatar from "./DoctorAvatar.jsx";

function UpcomingAppointmentCard({ appointment, isNextVisit = false }) {
  const date = dayjs(appointment.date);

  return (
    <article className="visits-card visits-card-elevate">
      <div className="flex gap-4 p-5">
        <div className="visits-date-block visits-date-block-upcoming">
          <span className="visits-date-day">{date.format("D")}</span>
          <span className="visits-date-month">{date.format("MMM").toUpperCase()}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="native-display text-[16px] leading-snug text-[#1a5c52]">
              {appointment.type}
            </p>
            {isNextVisit ? (
              <span className="visits-badge-teal shrink-0">Next Visit</span>
            ) : (
              <span className="visits-badge-teal-muted shrink-0">Upcoming</span>
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <DoctorAvatar name={appointment.doctor_name} />
            <p className="text-[14px] font-semibold text-[#22485b]">{appointment.doctor_name}</p>
          </div>

          {appointment.time_window ? (
            <div className="mt-2 flex items-center gap-1.5 text-[13px] text-[#5b7f8a]">
              <Clock className="size-3.5 shrink-0 text-[rgba(45,143,152,0.55)]" strokeWidth={1.75} />
              <span>{appointment.time_window}</span>
            </div>
          ) : null}

          {appointment.note ? (
            <p className="mt-2 text-[13px] leading-relaxed text-[#8a9e9a]">{appointment.note}</p>
          ) : null}
        </div>
      </div>

      <div className="flex justify-end px-5 pb-4">
        <button
          type="button"
          onClick={() => downloadAppointmentIcs(appointment)}
          className="visits-calendar-btn"
        >
          <CalendarPlus className="size-4" strokeWidth={1.75} />
          Add to Calendar
        </button>
      </div>
    </article>
  );
}

export default UpcomingAppointmentCard;
