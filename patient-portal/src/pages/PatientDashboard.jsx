import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { ArrowRight } from "lucide-react";
import { useFamilyProfile } from "../hooks/useFamilyProfile.jsx";
import { api } from "../lib/api.js";
import { DEPENDENT_DASHBOARD } from "../lib/familyProfiles.js";
import VisitCancelPrompt from "../components/VisitCancelPrompt.jsx";
import MobileDashboardHome from "../components/dashboard/MobileDashboardHome.jsx";
import DesktopDashboardHome from "../components/dashboard/DesktopDashboardHome.jsx";

// Map a backend visit-request status onto the dashboard's 4-step mini tracker.
const VISIT_STATUS_STEP_INDEX = {
  pending: 0,
  acknowledged: 0,
  assigned: 1,
  en_route: 2,
  arrived: 3,
};

const VISIT_STEPS = [
  "Request received",
  "Doctor assigned",
  "Doctor en route",
  "Doctor arrived",
];
const ACTIVE_STEP_INDEX = 2;

function DashboardErrorState({ message, onRetry, className = "" }) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center px-[var(--native-pad-screen)] py-16 text-center",
        className,
      ].join(" ")}
    >
      <p className="native-display text-[20px] text-[#1a5c52]">Couldn&apos;t load your dashboard</p>
      <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-[#5b7f8a]">{message}</p>
      <button type="button" onClick={onRetry} className="request-wizard-primary-btn mt-6 w-full max-w-[280px]">
        Try Again
      </button>
    </div>
  );
}

function ActiveVisitCard({ visit, onCancelled }) {
  const activeStepIndex = Number.isInteger(visit.stepIndex) ? visit.stepIndex : ACTIVE_STEP_INDEX;

  return (
    <div className="desktop-card">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34c759] opacity-70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#34c759]" />
        </span>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
          Active Visit
        </p>
      </div>

      <p className="mt-3 font-display text-lg font-bold tracking-tight text-[#1a5c52]">
        {visit.doctor || "Your doctor"}
      </p>
      <p className="mt-1 text-sm text-[#5b7f8a]">
        {visit.statusText || "Doctor en route · Est. arrival 25 min"}
      </p>

      {/* 4-step horizontal progress */}
      <div className="mt-5 grid grid-cols-4 gap-1.5">
        {VISIT_STEPS.map((step, i) => (
          <div key={step} className="flex flex-col gap-2">
            <div className="flex h-[6px] items-center">
              {i === activeStepIndex ? (
                <span className="size-2 rounded-full bg-[#1a5c52] animate-visit-step-pulse" />
              ) : (
                <span className="size-2 rounded-full bg-transparent" aria-hidden="true" />
              )}
            </div>
            <span
              className={`h-[6px] rounded-full ${
                i <= activeStepIndex ? "bg-[#2d8f98]" : "bg-[rgba(100,116,139,0.2)]"
              }`}
            />
            <span
              className={`text-[0.55rem] leading-tight ${
                i === activeStepIndex
                  ? "font-semibold text-[#1a5c52]"
                  : i < activeStepIndex
                    ? "text-[#5b7f8a]"
                    : "text-[#94a9ad]"
              }`}
            >
              {step}
            </span>
          </div>
        ))}
      </div>

      <Link
        to="/request-visit/tracking"
        className="mt-6 inline-flex items-center gap-1 text-sm font-bold text-[#2d8f98] transition hover:gap-2 hover:text-[#23767f]"
      >
        View Live Tracking <ArrowRight className="size-4" />
      </Link>

      <VisitCancelPrompt
        visitId={visit.id}
        visitStatus={visit.status}
        onCancelled={onCancelled}
        className="mt-3"
      />
    </div>
  );
}

function formatDoctorName(name) {
  const trimmed = String(name || "Doctor").trim();
  if (/^dr\.?\s/i.test(trimmed)) {
    return trimmed;
  }
  return `Dr. ${trimmed}`;
}

function formatDoctorSurname(name) {
  const trimmed = String(name || "Doctor").trim();
  const withoutPrefix = trimmed.replace(/^dr\.?\s+/i, "");
  const parts = withoutPrefix.split(/\s+/).filter(Boolean);
  const surname = parts[parts.length - 1];
  return surname ? `Dr. ${surname}` : formatDoctorName(name);
}

function extractEtaMinutes(visit) {
  const status = visit?.status || "";
  const match = status.match(/(\d+)\s*min/i);
  if (match) return Number.parseInt(match[1], 10);
  return 25;
}

function isAppointmentWithin24Hours(appointment) {
  if (!appointment?.date) return false;
  let appointmentAt = dayjs(appointment.date);
  if (appointment.time) {
    const withTime = dayjs(`${appointment.date} ${appointment.time}`, "YYYY-MM-DD h:mm A");
    if (withTime.isValid()) appointmentAt = withTime;
  }
  const hoursUntil = appointmentAt.diff(dayjs(), "hour", true);
  return hoursUntil >= 0 && hoursUntil < 24;
}

function MobileActiveVisit({ visit, onCancelled }) {
  const doctor = formatDoctorSurname(visit.doctor);
  const eta = extractEtaMinutes(visit);
  const activeStepIndex = Number.isInteger(visit.stepIndex) ? visit.stepIndex : ACTIVE_STEP_INDEX;

  return (
    <div className="mb-5 animate-fade-in-up">
      <div className="flex items-center gap-2">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#34c759] opacity-70" />
          <span className="relative inline-flex size-2.5 rounded-full bg-[#34c759]" />
        </span>
        <p className="text-[10px] font-semibold uppercase tracking-[1.5px] text-[#2d8f98]">
          Active Visit
        </p>
      </div>

      <p className="mt-2 font-display text-[22px] font-bold leading-tight tracking-tight text-[#1a5c52]">
        {doctor} is on the way.
      </p>
      <p className="mt-1 text-[13px] font-light text-[#5b7f8a]">
        Estimated arrival: {eta} minutes
      </p>

      <div className="mt-5 grid grid-cols-4 gap-1.5">
        {VISIT_STEPS.map((step, i) => (
          <span
            key={step}
            className={`h-[6px] rounded-full ${
              i <= activeStepIndex ? "bg-[#2d8f98]" : "bg-[rgba(100,116,139,0.2)]"
            }`}
          />
        ))}
      </div>

      <div className="mt-5 space-y-3">
        <Link
          to="/request-visit/tracking"
          className="flex h-[48px] w-full items-center justify-center rounded-[14px] border border-[#2d8f98] text-sm font-bold text-[#2d8f98] transition active:scale-95 active:bg-[rgba(26,160,140,0.06)]"
        >
          View Live Tracking →
        </Link>
        <a
          href="tel:52522234"
          className="flex h-[48px] w-full items-center justify-center rounded-[14px] bg-[#E8A020] text-sm font-bold text-white shadow-sm transition active:scale-95 active:brightness-105"
        >
          Call {doctor}
        </a>
      </div>

      <VisitCancelPrompt
        visitId={visit.id}
        visitStatus={visit.status}
        onCancelled={onCancelled}
        className="mt-3 text-center"
        buttonClassName="text-xs font-medium text-[#cf8079] transition active:text-[#cf5b50]"
      />
    </div>
  );
}

function PatientDashboard() {
  const { activeProfile, activeProfileId } = useFamilyProfile();
  const [patient, setPatient] = useState(null);
  const [nextAppointment, setNextAppointment] = useState(null);
  const [lastConsultation, setLastConsultation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const [activeVisit, setActiveVisit] = useState(null);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setLoadError(null);

    async function fetchDashboard() {
      try {
        const [data, visitData] = await Promise.all([
          api.get("/patient-portal/dashboard"),
          api.get("/patient-portal/visit-requests/active").catch(() => ({ visit_request: null })),
        ]);
        if (!ignore) {
          setPatient(data.patient || null);
          setNextAppointment(data.next_appointment || null);
          setLastConsultation(data.last_consultation || null);
          setActiveVisit(visitData.visit_request || null);
        }
      } catch (error) {
        if (!ignore) {
          setLoadError(error?.message || "We couldn't reach your health portal. Check your connection and try again.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchDashboard();
    return () => {
      ignore = true;
    };
  }, [refreshKey, retryToken]);

  function handleRetryDashboard() {
    setRetryToken((token) => token + 1);
  }

  function handleVisitCancelled() {
    setActiveVisit(null);
  }

  const primaryActiveVisit = activeVisit
    ? {
        id: activeVisit.id,
        status: activeVisit.status,
        doctor: activeVisit.doctor_name ? formatDoctorName(activeVisit.doctor_name) : "Your doctor",
        statusText:
          activeVisit.eta_minutes != null
            ? `${activeVisit.status_label} · Est. arrival ${activeVisit.eta_minutes} min`
            : activeVisit.status_label,
        stepIndex: VISIT_STATUS_STEP_INDEX[activeVisit.status] ?? 0,
      }
    : null;

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  })();

  const firstName = activeProfile.firstName;
  const dependentDashboard = DEPENDENT_DASHBOARD[activeProfileId];
  const isPrimaryProfile = activeProfile.isPrimary;

  const profileNextAppointment = isPrimaryProfile
    ? nextAppointment
    : dependentDashboard?.nextAppointment ?? null;
  const profileLastConsultation = isPrimaryProfile
    ? lastConsultation
    : dependentDashboard?.lastConsultation ?? null;
  const careTeamDoctorName = isPrimaryProfile
    ? patient?.assigned_doctor_name || profileLastConsultation?.doctor_name || null
    : dependentDashboard?.careTeamDoctorName ?? profileLastConsultation?.doctor_name ?? null;
  const profileActiveVisit = isPrimaryProfile
    ? primaryActiveVisit
    : dependentDashboard?.activeVisit ?? null;

  const subline = (() => {
    if (loadError && isPrimaryProfile) return "We couldn't refresh your dashboard data.";
    if (loading && isPrimaryProfile) return "Loading your health portal\u2026";
    if (!isPrimaryProfile) {
      return `You're viewing ${activeProfile.firstName}'s health space. All records and visits shown are ${activeProfile.possessive}.`;
    }
    if (profileActiveVisit) {
      const doctor = formatDoctorSurname(profileActiveVisit.doctor);
      const eta = extractEtaMinutes(profileActiveVisit);
      return `${doctor} is on the way. Estimated arrival in ${eta} minutes.`;
    }
    if (profileNextAppointment) {
      const doctor = formatDoctorName(profileNextAppointment.doctor_name);
      const time = profileNextAppointment.time || "";
      if (isAppointmentWithin24Hours(profileNextAppointment)) {
        return `Your visit with ${doctor} is confirmed for today at ${time}.`;
      }
      const dateLabel = dayjs(profileNextAppointment.date).format("D MMMM");
      return `Your next visit with ${doctor} is confirmed for ${dateLabel} at ${time}.`;
    }
    return "A doctor is one tap away, any time of day.";
  })();

  const headline = isPrimaryProfile ? (
    <>
      {greeting},{" "}
      <span className="text-ocs-orange">{firstName}</span>
    </>
  ) : (
    <>
      Managing care for <span className="text-ocs-orange">{firstName}</span>.
    </>
  );

  return (
    <>
    {/* ───────── Desktop dashboard ───────── */}
    <div className="max-lg:hidden">
      {loading && isPrimaryProfile ? (
        <div className="desktop-dashboard">
          <div className="desktop-dashboard-greeting">
            <div className="h-10 w-72 animate-pulse rounded-lg bg-[rgba(0,0,0,0.04)]" />
            <div className="mt-3 h-5 w-96 animate-pulse rounded-lg bg-[rgba(0,0,0,0.03)]" />
          </div>
          <div className="desktop-dashboard-grid">
            <div className="desktop-dashboard-col">
              <div className="desktop-card h-56 animate-pulse" />
            </div>
            <div className="desktop-dashboard-col">
              <div className="desktop-card h-44 animate-pulse" />
              <div className="desktop-concierge-card h-52 animate-pulse opacity-80" />
            </div>
          </div>
        </div>
      ) : loadError && isPrimaryProfile ? (
        <div className="desktop-card px-8 py-16">
          <DashboardErrorState message={loadError} onRetry={handleRetryDashboard} />
        </div>
      ) : (
        <div key={activeProfileId} className="dashboard-profile-transition">
          <DesktopDashboardHome
            headline={headline}
            subline={subline}
            careTeamDoctorName={careTeamDoctorName}
            profileLastConsultation={profileLastConsultation}
            activeVisitSlot={
              profileActiveVisit ? (
                <ActiveVisitCard visit={profileActiveVisit} onCancelled={handleVisitCancelled} />
              ) : null
            }
          />
        </div>
      )}
    </div>

    {/* ───────── Mobile dashboard — native home experience ───────── */}
    <div key={`m-${activeProfileId}`} className="dashboard-profile-transition hidden max-lg:block">
      {loading && isPrimaryProfile ? (
        <div className="native-dashboard space-y-5 bg-[#f4f7f7]">
          <div className="squircle-outer h-20 animate-pulse bg-white/60" />
          <div className="squircle-outer h-32 animate-pulse bg-white/60" />
        </div>
      ) : loadError && isPrimaryProfile ? (
        <div className="native-dashboard min-h-full bg-[#f4f7f7]">
          <DashboardErrorState message={loadError} onRetry={handleRetryDashboard} className="min-h-[60vh]" />
        </div>
      ) : profileActiveVisit ? (
        <div
          className="px-[var(--native-pad-screen)]"
          style={{
            paddingTop: "var(--native-safe-top)",
          }}
        >
          <MobileActiveVisit visit={profileActiveVisit} onCancelled={handleVisitCancelled} />
        </div>
      ) : (
        <MobileDashboardHome firstName={isPrimaryProfile ? firstName : activeProfile.firstName} />
      )}
    </div>
    </>
  );
}

export default PatientDashboard;
