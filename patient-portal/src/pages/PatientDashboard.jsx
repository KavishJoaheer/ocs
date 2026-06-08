import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import {
  CreditCard,
  TrendingUp,
  ArrowRight,
  CalendarCheck,
  History,
  Sparkles,
  HousePlus,
  Home,
  Clock,
} from "lucide-react";
import { useFamilyProfile } from "../hooks/useFamilyProfile.jsx";
import { api } from "../lib/api.js";
import { getActiveVisit } from "../lib/activeVisit.js";
import { DEPENDENT_DASHBOARD } from "../lib/familyProfiles.js";
import { getLastConsultation } from "../lib/consultations.js";

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
      className={`animate-fade-in-up stagger-${delay} rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-8 shadow-[0_16px_48px_rgba(34,72,91,0.08)] transition hover:shadow-[0_20px_56px_rgba(34,72,91,0.12)] max-md:p-4`}
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
    <div className="flex flex-col items-start py-6">
      <HousePlus className="size-8 text-[#7fd1ca]" strokeWidth={1.5} />
      <h3 className="mt-6 font-display text-xl font-semibold tracking-tight text-[#22485b]">
        No active visit
      </h3>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#5b7f8a]">
        Your next home visit will appear here once confirmed.
      </p>
    </div>
  );
}

function ActiveVisitCard({ visit }) {
  const [showCancel, setShowCancel] = useState(false);

  return (
    <div className="rounded-2xl bg-[rgba(26,160,140,0.04)] p-6 max-md:p-4">
      {showCancel && (
        <div className="mb-5 rounded-xl bg-[rgba(207,91,80,0.08)] p-4">
          <p className="text-sm leading-relaxed text-[#5b6b6b]">
            To cancel your visit please call our team directly. Tap below to call now.
          </p>
          <a
            href="tel:52522234"
            className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-[#cf5b50] text-sm font-bold text-white transition hover:brightness-105"
          >
            Call OCS to Cancel
          </a>
          <button
            type="button"
            onClick={() => setShowCancel(false)}
            className="mt-2 w-full text-center text-xs font-semibold text-[#2d8f98] transition hover:text-[#23767f]"
          >
            Keep my visit
          </button>
        </div>
      )}

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
        {visit.status || "Doctor en route · Est. arrival 25 min"}
      </p>

      {/* 4-step horizontal progress */}
      <div className="mt-5 grid grid-cols-4 gap-1.5">
        {VISIT_STEPS.map((step, i) => (
          <div key={step} className="flex flex-col gap-2">
            <div className="flex h-[6px] items-center">
              {i === ACTIVE_STEP_INDEX ? (
                <span className="size-2 rounded-full bg-[#1a5c52] animate-visit-step-pulse" />
              ) : (
                <span className="size-2 rounded-full bg-transparent" aria-hidden="true" />
              )}
            </div>
            <span
              className={`h-[6px] rounded-full ${
                i <= ACTIVE_STEP_INDEX ? "bg-[#2d8f98]" : "bg-[rgba(100,116,139,0.2)]"
              }`}
            />
            <span
              className={`text-[0.55rem] leading-tight ${
                i === ACTIVE_STEP_INDEX
                  ? "font-semibold text-[#1a5c52]"
                  : i < ACTIVE_STEP_INDEX
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

      <div>
        <button
          type="button"
          onClick={() => setShowCancel(true)}
          className="mt-3 text-xs font-medium text-[#cf8079] transition hover:text-[#cf5b50]"
        >
          Cancel this visit
        </button>
      </div>
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
    <section className="animate-fade-in-up stagger-5 w-full rounded-2xl border border-[rgba(26,160,140,0.12)] bg-white p-[28px] max-md:p-4">
      <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-start max-md:gap-2">
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

      <div className="mt-5 max-md:mt-4">
        <p className="text-base font-bold text-[#1a5c52]">
          {formatDoctorName(consultation.doctor_name)}
        </p>
        <p className="mt-1 text-sm font-light text-[#5b7f8a] max-md:text-[13px]">
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

function PatientDashboard() {
  const { activeProfile, activeProfileId } = useFamilyProfile();
  const [stats, setStats] = useState(null);
  const [nextAppointment, setNextAppointment] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [lastConsultation, setLastConsultation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [primaryActiveVisit] = useState(() => getActiveVisit());

  useEffect(() => {
    let ignore = false;

    async function fetchDashboard() {
      try {
        const data = await api.get("/patient-portal/dashboard");
        if (!ignore) {
          setStats(data.stats || { upcoming_appointments: 0, pending_bills: 0, total_visits: 0 });
          setNextAppointment(data.next_appointment || null);
          setRecentActivity(data.recent_activity || []);
          setLastConsultation(data.last_consultation || null);
        }
      } catch {
        if (!ignore) {
          setStats({ upcoming_appointments: 0, pending_bills: 0, total_visits: 0 });
          setNextAppointment(null);
          setRecentActivity([]);
          setLastConsultation(null);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchDashboard();
    return () => { ignore = true; };
  }, []);

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
  const profileRecentActivity = isPrimaryProfile
    ? recentActivity
    : dependentDashboard?.recentActivity ?? [];
  const profileLastConsultation = isPrimaryProfile
    ? getLastConsultation() ?? lastConsultation
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
    <div className="space-y-12 max-md:space-y-4">
      {/* Welcome header */}
      <div className="relative -mx-6 px-6 pt-12 max-md:-mx-4 max-md:px-4 max-md:pt-0 sm:-mx-10 sm:px-10 lg:-mx-12 lg:px-12">
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
            <Sparkles className="size-5 text-[#f2c14d] max-md:size-4" />
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98] max-md:text-[10px] max-md:tracking-[2px]">
              Patient Dashboard
            </p>
          </div>
          <h1 className="mt-3 font-display text-3xl tracking-tight text-slate-950 max-md:mt-2 max-md:text-[28px] sm:text-4xl">
            {headline}
          </h1>
          <p className="mt-2 max-w-2xl text-base leading-relaxed text-[#5b7f8a] max-md:text-sm">
            {subline}
          </p>
        </div>
      </div>

      <div key={activeProfileId} className="dashboard-profile-transition space-y-12 max-md:space-y-4">
      {/* Stats cards — only shown when at least one value is greater than zero */}
      {hasStats && (
        <div className="grid gap-5 max-md:gap-4 sm:grid-cols-3">
          <StatCard
            icon={CalendarCheck}
            label="Upcoming"
            value={profileStats?.upcoming_appointments ?? 0}
            color="linear-gradient(135deg, #41c8c6, #2d8f98)"
            delay={1}
          />
          <StatCard
            icon={CreditCard}
            label="Pending Bills"
            value={profileStats?.pending_bills ?? 0}
            color="linear-gradient(135deg, #f2c14d, #e6a817)"
            delay={2}
          />
          <StatCard
            icon={TrendingUp}
            label="Total Visits"
            value={profileStats?.total_visits ?? 0}
            color="linear-gradient(135deg, #70ddd2, #41c8c6)"
            delay={3}
          />
        </div>
      )}

      {loading && isPrimaryProfile ? (
        <div className="h-44 animate-pulse rounded-2xl bg-[rgba(65,200,198,0.06)]" />
      ) : (
        <>
          <section className="animate-fade-in-up stagger-4">
            {profileActiveVisit ? (
              <ActiveVisitCard visit={profileActiveVisit} />
            ) : (
              <>
                {/* Desktop — centred empty state */}
                <div className="rounded-2xl bg-[rgba(26,160,140,0.05)] p-10 max-md:hidden">
                  <NoActiveVisit />
                </div>
                {/* Mobile — compact single row */}
                <div className="hidden items-center gap-4 rounded-2xl bg-[rgba(26,160,140,0.05)] p-4 max-md:flex">
                  <Home className="size-5 shrink-0 text-[#7fd1ca]" strokeWidth={1.5} />
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-[#22485b]">No active visit</h3>
                    <p className="mt-0.5 text-xs text-[#5b7f8a]">Confirmed visits appear here.</p>
                  </div>
                </div>
              </>
            )}
          </section>

          {profileLastConsultation ? (
            <LastConsultationCard consultation={profileLastConsultation} />
          ) : null}

          {profileRecentActivity.length > 0 ? (
            <section className="animate-fade-in-up stagger-6 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="size-4 text-[#2d8f98]" />
                  <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
                    Past Consultations
                  </h2>
                </div>
                <Link
                  to="/consultations"
                  className="flex items-center gap-1 text-xs font-semibold text-[#2d8f98] transition hover:text-[#277f88]"
                >
                  View all <ArrowRight className="size-3" />
                </Link>
              </div>
              <div className="mt-5 space-y-3">
                {profileRecentActivity.slice(0, 5).map((activity, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-2xl border border-[rgba(65,200,198,0.1)] bg-white/70 px-4 py-3"
                  >
                    <div className="h-2 w-2 rounded-full bg-[#41c8c6]" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#22485b]">{activity.description}</p>
                      <p className="text-xs text-[#6e949b]">
                        {dayjs(activity.date).format("MMM D, YYYY")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
      </div>
    </div>
  );
}

export default PatientDashboard;
