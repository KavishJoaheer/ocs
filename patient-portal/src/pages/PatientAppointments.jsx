import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { CalendarCheck2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";

function withDoctorPrefix(name) {
  const value = String(name || "").trim();
  if (!value) return "Your OCS doctor";
  return /^dr\.?\s/i.test(value) ? value : `Dr. ${value}`;
}

function formatTime(time) {
  const value = String(time || "").trim();
  if (!value) return "";
  const parsed = dayjs(`2000-01-01T${value}`);
  return parsed.isValid() ? parsed.format("h:mm A") : value;
}

function typeLabel(status) {
  if (status === "completed") return "Consultation";
  if (status === "cancelled") return "Cancelled";
  return "Scheduled Visit";
}

function mapAppointment(row) {
  return {
    id: row.id,
    date: row.appointment_date,
    time: formatTime(row.appointment_time),
    type: typeLabel(row.status),
    doctor_name: withDoctorPrefix(row.doctor_name),
    status: row.status,
  };
}

function SectionLabel({ children, muted = false }) {
  return (
    <p
      className={`text-[11px] font-semibold uppercase tracking-[1.5px] ${
        muted ? "text-[#8a9ea3]" : "text-[#6e949b]"
      }`}
    >
      {children}
    </p>
  );
}

function AppointmentCard({ appointment, variant, isNextVisit = false }) {
  const isUpcoming = variant === "upcoming";
  const date = dayjs(appointment.date);

  return (
    <div
      className={`flex items-stretch gap-5 rounded-xl border border-[rgba(26,160,140,0.12)] px-6 py-5 ${
        isUpcoming && isNextVisit
          ? "border-l-4 border-l-[#1a5c52] bg-[rgba(26,160,140,0.03)]"
          : isUpcoming
            ? "border-l-[3px] border-l-[#1a5c52] bg-white"
            : "border-l-[3px] border-l-[#c0c0c0] bg-[rgba(0,0,0,0.02)]"
      }`}
    >
      <div className="flex shrink-0 items-center gap-5">
        <div className="text-center">
          <p
            className={`font-display text-2xl font-bold leading-none ${
              isUpcoming ? "text-[#1a5c52]" : "text-[#6e949b]"
            }`}
          >
            {date.format("D")}
          </p>
          <p
            className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
              isUpcoming ? "text-[#5b7f8a]" : "text-[#94a9ad]"
            }`}
          >
            {date.format("MMM")}
          </p>
        </div>
        <div
          className={`h-full w-px self-stretch ${
            isUpcoming ? "bg-[rgba(26,160,140,0.12)]" : "bg-[rgba(0,0,0,0.08)]"
          }`}
        />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`text-[15px] font-bold ${
            isUpcoming ? "text-[#1a5c52]" : "text-[#5b7f8a]"
          }`}
        >
          {appointment.type}
        </p>
        <p
          className={`mt-0.5 text-sm font-light ${
            isUpcoming ? "text-[#5b7f8a]" : "text-[#8a9ea3]"
          }`}
        >
          {appointment.doctor_name}
        </p>
        <p
          className={`mt-1 text-[13px] ${
            isUpcoming ? "text-[#6e949b]" : "text-[#94a9ad]"
          }`}
        >
          {appointment.time}
        </p>
      </div>

      <div className="flex shrink-0 items-start">
        {isUpcoming && isNextVisit ? (
          <span className="inline-flex rounded-[20px] bg-[#1a5c52] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
            Next Visit
          </span>
        ) : isUpcoming ? (
          <span className="inline-flex rounded-[20px] bg-[rgba(26,160,140,0.1)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#2d8f98]">
            Upcoming
          </span>
        ) : (
          <span className="inline-flex rounded-[20px] bg-[rgba(0,0,0,0.06)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#8a9ea3]">
            {appointment.status === "cancelled" ? "Cancelled" : "Completed"}
          </span>
        )}
      </div>
    </div>
  );
}

function PatientAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function fetchAppointments() {
      try {
        const data = await api.get("/patient-portal/appointments");
        if (!ignore) setAppointments((data.appointments || []).map(mapAppointment));
      } catch {
        if (!ignore) setAppointments([]);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchAppointments();
    return () => { ignore = true; };
  }, [refreshKey]);

  const today = dayjs().format("YYYY-MM-DD");
  const upcoming = appointments
    .filter((a) => a.status === "scheduled" && a.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const past = appointments
    .filter((a) => !(a.status === "scheduled" && a.date >= today))
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

  return (
    <div className="mx-auto max-w-[720px] space-y-10">
      <div className="animate-fade-in-up">
        <div className="flex items-center gap-2">
          <CalendarCheck2
            className="size-[18px] shrink-0 text-[#6B9E95]"
            strokeWidth={1.5}
          />
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Review Appointments
          </p>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Your Appointments.
        </h1>
        <p className="mt-2 text-sm font-light text-[#5b7f8a]">
          Scheduled by your OCS care team.
        </p>
      </div>

      {loading ? (
        <p className="animate-fade-in-up text-[13px] font-light italic text-[#8a9ea3]">
          Loading your appointments…
        </p>
      ) : (
        <>
          <section className="animate-fade-in-up stagger-1 space-y-3">
            <SectionLabel>Upcoming</SectionLabel>
            {upcoming.length === 0 ? (
              <p className="text-[13px] font-light italic text-[#8a9ea3]">
                No upcoming appointments. Your OCS care team will schedule these for
                you.
              </p>
            ) : (
              <div className="space-y-3">
                {upcoming.map((appointment, idx) => (
                  <div
                    key={appointment.id}
                    className={`animate-fade-in-up stagger-${Math.min(idx + 2, 8)}`}
                  >
                    <AppointmentCard
                      appointment={appointment}
                      variant="upcoming"
                      isNextVisit={idx === 0}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section
            className={`animate-fade-in-up space-y-3 ${
              upcoming.length > 0
                ? `stagger-${Math.min(upcoming.length + 2, 8)}`
                : "stagger-2"
            }`}
          >
            <SectionLabel muted>Past</SectionLabel>
            {past.length === 0 ? (
              <p className="text-[13px] font-light italic text-[#8a9ea3]">
                No past appointments yet.
              </p>
            ) : (
              <div className="space-y-3">
                {past.map((appointment, idx) => (
                  <div
                    key={appointment.id}
                    className={`animate-fade-in-up stagger-${Math.min(idx + 3, 8)}`}
                  >
                    <AppointmentCard appointment={appointment} variant="past" />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default PatientAppointments;
