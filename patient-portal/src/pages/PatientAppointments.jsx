import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { api } from "../lib/api.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import FamilyProfileSwitcher from "../components/FamilyProfileSwitcher.jsx";
import UpcomingAppointmentCard from "../components/appointments/UpcomingAppointmentCard.jsx";
import PastAppointmentCard from "../components/appointments/PastAppointmentCard.jsx";

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
  if (kind === "review") return "Follow-up Review";
  if (status === "completed") return "Home Visit Consultation";
  if (status === "cancelled") return "Cancelled";
  return "Scheduled Visit";
}

function formatAppointmentNote(row, doctorName, kind) {
  if (kind === "review" && doctorName) {
    return `Follow-up check-up with ${doctorName}.`;
  }

  const raw = String(row.reason || "").trim();
  if (!raw) return null;
  return raw.endsWith(".") ? raw : `${raw}.`;
}

function mapAppointment(row) {
  const time = formatTime(row.appointment_time);
  const kind = row.kind || null;
  const doctorName = withDoctorPrefix(row.doctor_name);

  return {
    id: row.id,
    date: row.appointment_date,
    time: row.appointment_time || time,
    time_window: row.time_window || formatTimeWindow(row.appointment_time, kind),
    type: typeLabel(row.status, kind),
    doctor_name: doctorName,
    status: row.status,
    kind,
    note: formatAppointmentNote(row, doctorName, kind),
    consultation_id: row.consultation_id || null,
  };
}

function SectionLabel({ children }) {
  return <p className="visits-section-label">{children}</p>;
}

function PatientAppointments() {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setLoadError(null);

    async function fetchAppointments() {
      try {
        const data = await api.get("/patient-portal/appointments");
        if (!ignore) {
          setAppointments((data.appointments || []).map(mapAppointment));
        }
      } catch (error) {
        if (!ignore) {
          setLoadError(
            error?.message || "We couldn't load your appointments. Check your connection and try again.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchAppointments();
    return () => {
      ignore = true;
    };
  }, [refreshKey, retryToken]);

  const today = dayjs().format("YYYY-MM-DD");
  const upcoming = appointments
    .filter((a) => a.status === "scheduled" && a.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const past = appointments
    .filter((a) => !(a.status === "scheduled" && a.date >= today))
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

  return (
    <div className="visits-screen native-screen mx-auto w-full max-w-[720px] px-[var(--native-pad-screen)] font-sans lg:max-w-3xl lg:px-0">
      <div className="sticky top-0 z-40 -mx-[var(--native-pad-screen)] flex min-h-12 items-center justify-between border-b border-teal-500/10 bg-white/90 px-[var(--native-pad-screen)] pt-safe backdrop-blur-md lg:hidden">
        <img
          src="/ocs-medecins-mark.png"
          alt="OCS Care"
          className="h-7 w-7 shrink-0 object-contain"
        />
        <p className="absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[2px] text-[#2d8f98]">
          OCS Care
        </p>
        <FamilyProfileSwitcher variant="avatar" />
      </div>

      <header className="animate-fade-in-up pb-2 pt-3 lg:pt-0">
        <h1 className="native-display text-[26px] leading-tight text-[#1a5c52] lg:text-4xl">
          Your Appointments.
        </h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-[#5b7f8a]">
          Scheduled by your OCS care team.
        </p>
      </header>

      {loading ? (
        <div className="mt-6 space-y-4 lg:mt-8">
          <div className="h-40 animate-pulse rounded-3xl border border-teal-100 bg-white/70 max-lg:shadow-sm lg:visits-card" />
          <div className="h-28 animate-pulse rounded-2xl bg-white/70 lg:visits-card" />
        </div>
      ) : loadError ? (
        <div className="mt-8 flex flex-col items-center px-4 py-16 text-center">
          <p className="native-display text-[20px] text-[#1a5c52]">Couldn&apos;t load appointments</p>
          <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-[#5b7f8a]">{loadError}</p>
          <button
            type="button"
            onClick={() => setRetryToken((token) => token + 1)}
            className="request-wizard-primary-btn mt-6 w-full max-w-[280px]"
          >
            Try Again
          </button>
        </div>
      ) : (
        <>
          <section className="animate-fade-in-up stagger-1 mt-6 space-y-3 lg:mt-8 lg:space-y-4">
            <SectionLabel>Upcoming</SectionLabel>
            {upcoming.length === 0 ? (
              <p className="text-[14px] italic text-[#8a9e9a]">
                No upcoming appointments. Your OCS care team will schedule these for you.
              </p>
            ) : (
              <div className="space-y-3 lg:space-y-4">
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
            className={`animate-fade-in-up mt-10 space-y-3 lg:mt-12 lg:space-y-4 ${
              upcoming.length > 0 ? `stagger-${Math.min(upcoming.length + 2, 6)}` : "stagger-2"
            }`}
          >
            <SectionLabel>Past</SectionLabel>
            {past.length === 0 ? (
              <p className="text-[14px] italic text-[#8a9e9a]">No past appointments yet.</p>
            ) : (
              <div className="visits-timeline max-lg:space-y-5 lg:space-y-4">
                {past.map((appointment, idx) => (
                  <div
                    key={appointment.id}
                    className={`animate-fade-in-up stagger-${Math.min(idx + 3, 6)}`}
                  >
                    <PastAppointmentCard
                      appointment={appointment}
                      isLast={idx === past.length - 1}
                    />
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
