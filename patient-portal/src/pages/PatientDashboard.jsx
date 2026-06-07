import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import {
  CalendarDays,
  CreditCard,
  Clock,
  TrendingUp,
  ArrowRight,
  CalendarCheck,
  Stethoscope,
  History,
  Sparkles,
  HousePlus,
} from "lucide-react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { api } from "../lib/api.js";

function StatCard({ icon: Icon, label, value, color, delay }) {
  return (
    <div
      className={`animate-fade-in-up stagger-${delay} rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-8 shadow-[0_16px_48px_rgba(34,72,91,0.08)] transition hover:shadow-[0_20px_56px_rgba(34,72,91,0.12)]`}
    >
      <div className="flex items-center gap-3">
        <div
          className="rounded-2xl p-2.5"
          style={{ background: color }}
        >
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

function NextAppointmentEmpty() {
  return (
    <div className="flex flex-col items-start">
      <HousePlus className="size-8 text-[#7fd1ca]" strokeWidth={1.5} />
      <h3 className="mt-6 font-display text-xl font-semibold tracking-tight text-[#22485b]">
        Your doctor, at your door.
      </h3>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#5b7f8a]">
        Request a home visit in seconds. A doctor will be with you wherever you are in Mauritius.
      </p>
      <Link
        to="/active-visit"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#e8a020] px-6 py-3 text-sm font-bold text-white shadow-[0_14px_36px_rgba(232,160,32,0.35)] transition hover:gap-3 hover:brightness-105"
      >
        Request a Visit <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

function PastConsultationsEmpty() {
  return (
    <div className="flex flex-col items-start">
      <History className="size-8 text-[#7fd1ca]" strokeWidth={1.5} />
      <h3 className="mt-6 font-display text-xl font-semibold tracking-tight text-[#22485b]">
        Your health story starts here.
      </h3>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-[#5b7f8a]">
        Every visit, every record, every moment of care will be beautifully organised right here.
      </p>
      <Link
        to="/consultations"
        className="mt-4 inline-flex items-center gap-1 text-sm font-normal text-[#5f9aa0] transition hover:gap-2 hover:text-[#2d8f98]"
      >
        View your health records <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

function PatientDashboard() {
  const { user } = usePatientAuth();
  const [stats, setStats] = useState(null);
  const [nextAppointment, setNextAppointment] = useState(null);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function fetchDashboard() {
      try {
        const data = await api.get("/patient-portal/dashboard");
        if (!ignore) {
          setStats(data.stats || { upcoming_appointments: 0, pending_bills: 0, total_visits: 0 });
          setNextAppointment(data.next_appointment || null);
          setRecentActivity(data.recent_activity || []);
        }
      } catch {
        if (!ignore) {
          setStats({ upcoming_appointments: 0, pending_bills: 0, total_visits: 0 });
          setNextAppointment(null);
          setRecentActivity([]);
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

  const firstName = user?.full_name?.split(" ")[0] || "there";

  const upcomingLabel = (() => {
    if (!nextAppointment?.date) return null;
    const d = dayjs(nextAppointment.date);
    if (d.isSame(dayjs(), "day")) return "today";
    if (d.isSame(dayjs().add(1, "day"), "day")) return "tomorrow";
    return d.format("dddd, MMMM D");
  })();

  const subline = (() => {
    if (loading) return "Loading your health portal\u2026";
    if (nextAppointment) {
      const doctor = nextAppointment.doctor_name || "your doctor";
      const time = nextAppointment.time ? ` at ${nextAppointment.time}` : "";
      return `Your next visit with ${doctor} is confirmed for ${upcomingLabel}${time}.`;
    }
    return `You're all caught up, ${firstName}. Need a doctor at home? We're one tap away.`;
  })();

  const hasStats =
    !loading &&
    ((stats?.upcoming_appointments ?? 0) > 0 ||
      (stats?.pending_bills ?? 0) > 0 ||
      (stats?.total_visits ?? 0) > 0);

  const bothEmpty = !loading && !nextAppointment && recentActivity.length === 0;

  return (
    <div className="space-y-12">
      {/* Welcome header */}
      <div className="animate-fade-in-up">
        <div className="flex items-center gap-3">
          <Sparkles className="size-5 text-[#f2c14d]" />
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Patient Dashboard
          </p>
        </div>
        <h1 className="mt-3 font-display text-3xl tracking-tight text-slate-950 sm:text-4xl">
          {greeting}, <span className="text-[#2d8f98]">{firstName}</span>
        </h1>
        <p className="mt-2 max-w-2xl text-base leading-relaxed text-[#5b7f8a]">
          {subline}
        </p>
      </div>

      {/* Stats cards — only shown when at least one value is greater than zero */}
      {hasStats && (
        <div className="grid gap-5 sm:grid-cols-3">
          <StatCard
            icon={CalendarCheck}
            label="Upcoming"
            value={stats?.upcoming_appointments ?? 0}
            color="linear-gradient(135deg, #41c8c6, #2d8f98)"
            delay={1}
          />
          <StatCard
            icon={CreditCard}
            label="Pending Bills"
            value={stats?.pending_bills ?? 0}
            color="linear-gradient(135deg, #f2c14d, #e6a817)"
            delay={2}
          />
          <StatCard
            icon={TrendingUp}
            label="Total Visits"
            value={stats?.total_visits ?? 0}
            color="linear-gradient(135deg, #70ddd2, #41c8c6)"
            delay={3}
          />
        </div>
      )}

      {loading ? (
        <div className="grid gap-12 lg:grid-cols-2">
          <div className="h-40 animate-pulse rounded-[24px] bg-[rgba(65,200,198,0.06)]" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-2xl bg-[rgba(65,200,198,0.06)]" />
            ))}
          </div>
        </div>
      ) : bothEmpty ? (
        /* Both empty — one cohesive, soft panel with a single divider */
        <div className="animate-fade-in-up stagger-4 rounded-2xl bg-[rgba(26,160,140,0.05)] p-10 pb-4">
          <div className="grid gap-y-10 sm:grid-cols-2 sm:gap-x-0">
            <div className="sm:border-r sm:border-[rgba(26,160,140,0.15)] sm:pr-10">
              <NextAppointmentEmpty />
            </div>
            <div className="sm:pl-10">
              <PastConsultationsEmpty />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-12 lg:grid-cols-2">
          {/* Next Appointment */}
          <section className="animate-fade-in-up stagger-4 py-2">
            {nextAppointment ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Stethoscope className="size-4 text-[#2d8f98]" />
                    <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
                      Next Appointment
                    </h2>
                  </div>
                  <Link
                    to="/appointments"
                    className="flex items-center gap-1 text-xs font-semibold text-[#2d8f98] transition hover:text-[#277f88]"
                  >
                    View all <ArrowRight className="size-3" />
                  </Link>
                </div>
                <div className="mt-5 rounded-[24px] border border-[rgba(65,200,198,0.12)] bg-white/80 p-6 shadow-[0_8px_24px_rgba(34,72,91,0.04)]">
                  <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-[linear-gradient(135deg,rgba(65,200,198,0.15),rgba(45,143,152,0.1))] p-3">
                      <CalendarDays className="size-6 text-[#2d8f98]" />
                    </div>
                    <div className="flex-1">
                      <p className="font-display text-lg font-semibold text-[#22485b]">
                        {nextAppointment.doctor_name || "Doctor"}
                      </p>
                      <p className="mt-1 text-sm text-[#5b7f8a]">
                        {dayjs(nextAppointment.date).format("dddd, MMMM D, YYYY")}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <Clock className="size-3.5 text-[#6e949b]" />
                        <span className="text-sm font-medium text-[#496773]">
                          {nextAppointment.time || "Time TBD"}
                        </span>
                      </div>
                    </div>
                    <span className="rounded-full bg-[rgba(65,200,198,0.12)] px-3 py-1 text-xs font-bold text-[#2d8f98]">
                      {nextAppointment.status || "Scheduled"}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div className="py-6">
                <NextAppointmentEmpty />
              </div>
            )}
          </section>

          {/* Past Consultations */}
          <section className="animate-fade-in-up stagger-5 py-2">
            {recentActivity.length > 0 ? (
              <>
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
                  {recentActivity.slice(0, 5).map((activity, idx) => (
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
              </>
            ) : (
              <div className="py-6">
                <PastConsultationsEmpty />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default PatientDashboard;
