import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import {
  CreditCard,
  TrendingUp,
  ArrowRight,
  CalendarCheck,
  Sparkles,
  HousePlus,
  Clock,
} from "lucide-react";
import { useFamilyProfile } from "../hooks/useFamilyProfile.jsx";
import { api } from "../lib/api.js";
import { DEPENDENT_DASHBOARD } from "../lib/familyProfiles.js";
import VisitCancelPrompt from "../components/VisitCancelPrompt.jsx";
import MobileDashboardHome from "../components/dashboard/MobileDashboardHome.jsx";

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

function StatCard({ icon: Icon, label, value, color, delay }) {
  return (
    <div
      className={`animate-fade-in-up stagger-${delay} rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-8 shadow-[0_16px_48px_rgba(34,72,91,0.08)] transition hover:shadow-[0_20px_56px_rgba(34,72,91,0.12)]`}
    >
      <div className="flex items-center gap-3">
        <div className="rounded-2xl p-2.5" style={{ background: color }}>
          <Icon className="size-5 text-white" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#6e949b]">{label}</p>
          <p className="mt-1 font-display text-2xl font-bold tracking-tight text-[#22485b]">{value}</p>
        </div>
      </div>
    </div>
  );
}

function NoActiveVisit() {
  return (
    <div className="flex h-14 max-h-14 items-center gap-3 rounded-[10px] bg-[rgba(26,160,140,0.04)] px-5">
      <HousePlus className="size-5 shrink-0 text-[#2d8f98]" strokeWidth={1.5} />
      <p className="shrink-0 text-sm font-bold text-[#1a5c52]">No active visit</p>
      <p className="text-[13px] text-[#5b7f8a]">
        Request a visit and your doctor&apos;s details will appear here.
      </p>
    </div>
  );
}

function ActiveVisitCard({ visit, onCancelled }) {
  const activeStepIndex = Number.isInteger(visit.stepIndex) ? visit.stepIndex : ACTIVE_STEP_INDEX;

  return (
    <div className="rounded-2xl bg-[rgba(26,160,140,0.04)] p-6">
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

function LastConsultationCard({ consultation }) {
  return (
    <section className="animate-fade-in-up stagger-5 w-full rounded-2xl border border-[rgba(26,160,140,0.12)] bg-white p-[28px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Clock className="size-3.5 text-[#2d8f98]" strokeWidth={1.75} />
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[#2d8f98]">
            Your Last Visit
          </p>
        </div>
        <Link
          to="/health-records"
          className="text-[13px] font-medium text-[#5f9aa0] transition hover:text-[#2d8f98]"
        >
          View your full health timeline →
        </Link>
      </div>

      <div className="mt-5">
        <p className="text-base font-bold text-[#1a5c52]">
          {formatDoctorName(consultation.doctor_name)}
        </p>
        <p className="mt-1 text-sm font-light text-[#5b7f8a]">
          {dayjs(consultation.date).format("D MMMM YYYY")}
        </p>
        {consultation.diagnosis ? (
          <span className="mt-3 inline-flex rounded-[20px] bg-[rgba(26,160,140,0.1)] px-4 py-1 text-[13px] text-[#2d8f98]">
            {consultation.diagnosis}
          </span>
        ) : null}
      </div>

      <div className="mt-6 border-t border-[rgba(26,160,140,0.12)] pt-4">
        <Link
          to="/consultations"
          className="text-[13px] font-normal text-[#2d8f98] transition hover:text-[#23767f]"
        >
          View full consultation record →
        </Link>
      </div>
    </section>
  );
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
  const [stats, setStats] = useState(null);
  const [nextAppointment, setNextAppointment] = useState(null);
  const [lastConsultation, setLastConsultation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeVisit, setActiveVisit] = useState(null);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function fetchDashboard() {
      try {
        const [data, visitData] = await Promise.all([
          api.get("/patient-portal/dashboard"),
          api.get("/patient-portal/visit-requests/active").catch(() => ({ visit_request: null })),
        ]);
        if (!ignore) {
          setStats(data.stats || { upcoming_appointments: 0, pending_bills: 0, total_visits: 0 });
          setNextAppointment(data.next_appointment || null);
          setLastConsultation(data.last_consultation || null);
          setActiveVisit(visitData.visit_request || null);
        }
      } catch {
        if (!ignore) {
          setStats({ upcoming_appointments: 0, pending_bills: 0, total_visits: 0 });
          setNextAppointment(null);
          setLastConsultation(null);
          setActiveVisit(null);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchDashboard();
    return () => { ignore = true; };
  }, [refreshKey]);

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

  const profileStats = isPrimaryProfile ? stats : dependentDashboard?.stats ?? null;
  const profileNextAppointment = isPrimaryProfile
    ? nextAppointment
    : dependentDashboard?.nextAppointment ?? null;
  const profileLastConsultation = isPrimaryProfile
    ? lastConsultation
    : dependentDashboard?.lastConsultation ?? null;
  const profileActiveVisit = isPrimaryProfile
    ? primaryActiveVisit
    : dependentDashboard?.activeVisit ?? null;

  const subline = (() => {
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

  const hasStats =
    !loading &&
    isPrimaryProfile &&
    ((profileStats?.upcoming_appointments ?? 0) > 0 ||
      (profileStats?.pending_bills ?? 0) > 0 ||
      (profileStats?.total_visits ?? 0) > 0);

  const headline = isPrimaryProfile ? (
    <>
      {greeting}, <span className="text-[#2d8f98]">{firstName}</span>
    </>
  ) : (
    <>
      Managing care for <span className="text-[#2d8f98]">{firstName}</span>.
    </>
  );

  return (
    <>
    {/* ───────── Desktop dashboard ───────── */}
    <div className="space-y-5 max-md:hidden">
      {/* Welcome header */}
      <div className="relative -mx-6 px-6 pt-12 sm:-mx-10 sm:px-10 lg:-mx-12 lg:px-12">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[140px]"
          style={{
            background:
              "linear-gradient(180deg, rgba(26, 160, 140, 0.07) 0%, rgba(26, 160, 140, 0) 100%)",
          }}
          aria-hidden="true"
        />
        <div className="relative animate-fade-in-up">
          <div className="flex items-center gap-3">
            <Sparkles className="size-5 text-[#f2c14d]" />
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
              Patient Dashboard
            </p>
          </div>
          <h1 className="mt-3 font-display text-3xl tracking-tight text-slate-950 sm:text-4xl">
            {headline}
          </h1>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-[#5b7f8a]">
            {subline}
          </p>
        </div>
      </div>

      <div key={activeProfileId} className="dashboard-profile-transition space-y-5">
      {/* Stats cards — only shown when value is greater than zero */}
      {hasStats && (
        <div className="grid gap-5 sm:grid-cols-3">
          {(profileStats?.upcoming_appointments ?? 0) > 0 ? (
            <StatCard
              icon={CalendarCheck}
              label="Upcoming"
              value={profileStats.upcoming_appointments}
              color="linear-gradient(135deg, #41c8c6, #2d8f98)"
              delay={1}
            />
          ) : null}
          {(profileStats?.pending_bills ?? 0) > 0 ? (
            <StatCard
              icon={CreditCard}
              label="Pending Bills"
              value={profileStats.pending_bills}
              color="linear-gradient(135deg, #f2c14d, #e6a817)"
              delay={2}
            />
          ) : null}
          {(profileStats?.total_visits ?? 0) > 0 ? (
            <StatCard
              icon={TrendingUp}
              label="Total Visits"
              value={profileStats.total_visits}
              color="linear-gradient(135deg, #70ddd2, #41c8c6)"
              delay={3}
            />
          ) : null}
        </div>
      )}

      {loading && isPrimaryProfile ? (
        <div className="h-14 animate-pulse rounded-[10px] bg-[rgba(65,200,198,0.06)]" />
      ) : (
        <>
          <section className="animate-fade-in-up stagger-4">
            {profileActiveVisit ? (
              <ActiveVisitCard visit={profileActiveVisit} onCancelled={handleVisitCancelled} />
            ) : (
              <NoActiveVisit />
            )}
          </section>

          {profileLastConsultation ? (
            <LastConsultationCard consultation={profileLastConsultation} />
          ) : null}
        </>
      )}
      </div>
    </div>

    {/* ───────── Mobile dashboard — native home experience ───────── */}
    <div key={`m-${activeProfileId}`} className="dashboard-profile-transition hidden max-md:block">
      {loading && isPrimaryProfile ? (
        <div className="native-dashboard -mx-4 space-y-4 bg-[#f4f7f7] px-4 pt-[max(env(safe-area-inset-top),12px)]">
          <div className="h-20 animate-pulse rounded-2xl bg-white/60" />
          <div className="h-28 animate-pulse rounded-[24px] bg-white/60" />
        </div>
      ) : profileActiveVisit ? (
        <div className="px-0 pt-[max(env(safe-area-inset-top),12px)]">
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
