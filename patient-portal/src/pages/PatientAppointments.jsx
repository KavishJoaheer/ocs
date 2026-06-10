import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { api } from "../lib/api.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import UpcomingAppointmentCard from "../components/appointments/UpcomingAppointmentCard.jsx";
import PastAppointmentCard from "../components/appointments/PastAppointmentCard.jsx";
import { MOCK_APPOINTMENTS } from "../components/appointments/mockAppointments.js";

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

function formatTimeWindow(time, kind) {
  const value = String(time || "").trim();
  if (!value) return "";
  const start = dayjs(`2000-01-01T${value}`);
  if (!start.isValid()) return formatTime(time);
  const end = start.add(kind === "review" ? 90 : 60, "minute");
  return `${start.format("h:mm A")} - ${end.format("h:mm A")}`;
}

function typeLabel(status, kind) {
  if (kind === "review") return "Scheduled Review";
  if (status === "completed") return "Consultation";
  if (status === "cancelled") return "Cancelled";
  return "Scheduled Visit";
}

function mapAppointment(row) {
  const time = formatTime(row.appointment_time);
  const kind = row.kind || null;

  return {
    id: row.id,
    date: row.appointment_date,
    time: row.appointment_time || time,
    time_window: row.time_window || formatTimeWindow(row.appointment_time, kind),
    type: typeLabel(row.status, kind),
    doctor_name: withDoctorPrefix(row.doctor_name),
    status: row.status,
    kind,
    note: row.reason || null,
    consultation_id: row.consultation_id || null,
  };
}

function SectionLabel({ children }) {
  return <p className="visits-section-label mb-4 tracking-wider text-[#a8b5b2]">{children}</p>;
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
        if (!ignore) {
          setAppointments((data.appointments || []).map(mapAppointment));
        }
      } catch {
        if (!ignore) setAppointments(MOCK_APPOINTMENTS);
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchAppointments();
    return () => {
      ignore = true;
    };
  }, [refreshKey]);

  const today = dayjs().format("YYYY-MM-DD");
  const upcoming = appointments
    .filter((a) => a.status === "scheduled" && a.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const past = appointments
    .filter((a) => !(a.status === "scheduled" && a.date >= today))
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

  return (
    <div className="visits-screen native-screen mx-auto w-full max-w-[720px] lg:max-w-4xl">
      <header className="animate-fade-in-up pb-2">
        <h1 className="native-display text-[28px] leading-tight text-[#1a5c52] lg:text-4xl">
          Your Appointments.
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#5b7f8a]">
          Scheduled by your OCS care team.
        </p>
      </header>

      {loading ? (
        <div className="mt-8 space-y-4">
          <div className="visits-card h-36 animate-pulse bg-white/70" />
          <div className="visits-card h-36 animate-pulse bg-white/70" />
        </div>
      ) : (
        <>
          <section className="animate-fade-in-up stagger-1 mt-8 space-y-4">
            <SectionLabel>Upcoming</SectionLabel>
            {upcoming.length === 0 ? (
              <p className="text-[14px] italic text-[#8a9e9a]">
                No upcoming appointments. Your OCS care team will schedule these for you.
              </p>
            ) : (
              <div className="space-y-4">
                {upcoming.map((appointment, idx) => (
                  <div
                    key={appointment.id}
                    className={`animate-fade-in-up stagger-${Math.min(idx + 2, 6)}`}
                  >
                    <UpcomingAppointmentCard
                      appointment={appointment}
                      isNextVisit={idx === 0}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section
            className={`animate-fade-in-up mt-12 space-y-4 ${
              upcoming.length > 0 ? `stagger-${Math.min(upcoming.length + 2, 6)}` : "stagger-2"
            }`}
          >
            <SectionLabel>Past</SectionLabel>
            {past.length === 0 ? (
              <p className="text-[14px] italic text-[#8a9e9a]">No past appointments yet.</p>
            ) : (
              <div className="space-y-4">
                {past.map((appointment, idx) => (
                  <div
                    key={appointment.id}
                    className={`animate-fade-in-up stagger-${Math.min(idx + 3, 6)}`}
                  >
                    <PastAppointmentCard appointment={appointment} />
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
