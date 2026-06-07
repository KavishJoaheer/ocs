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
  MapPin,
  CalendarClock,
  Newspaper,
  HousePlus,
} from "lucide-react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { api } from "../lib/api.js";

const OCS_UPDATES = [
  {
    icon: MapPin,
    tag: "Network",
    title: "New home visit doctors available in your district",
    desc: "We've expanded our care team near you, so you can book a home visit even faster.",
    accent: "linear-gradient(135deg, #41c8c6, #2d8f98)",
  },
  {
    icon: CalendarClock,
    tag: "Operations",
    title: "Upcoming public holiday operating hours",
    desc: "Check our adjusted hotline and home visit schedule for the upcoming public holiday.",
    accent: "linear-gradient(135deg, #f2c14d, #e6a817)",
  },
  {
    icon: Newspaper,
    tag: "Health Tips",
    title: "Seasonal wellness: staying healthy this winter",
    desc: "Practical guidance from our physicians to keep you and your family well all season.",
    accent: "linear-gradient(135deg, #70ddd2, #41c8c6)",
  },
];

function StatCard({ icon: Icon, label, value, color, delay }) {
  return (
    <div
      className={`animate-fade-in-up stagger-${delay} rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-6 shadow-[0_16px_48px_rgba(34,72,91,0.08)] transition hover:shadow-[0_20px_56px_rgba(34,72,91,0.12)]`}
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

  const allZero =
    !loading &&
    (stats?.upcoming_appointments ?? 0) === 0 &&
    (stats?.pending_bills ?? 0) === 0 &&
    (stats?.total_visits ?? 0) === 0;

  return (
    <div className="space-y-8">
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

      {/* Stats cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-[24px] bg-[rgba(65,200,198,0.08)]" />
          ))}
        </div>
      ) : allZero ? (
        <div className="animate-fade-in-up stagger-1 relative overflow-hidden rounded-[28px] border border-[rgba(65,200,198,0.18)] bg-[linear-gradient(135deg,rgba(65,200,198,0.14),rgba(112,221,210,0.08))] p-8 shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
          <img
            src="/ocs-medecins-mark.png"
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute right-6 top-6 h-12 w-auto opacity-30"
          />
          <div className="relative z-10 max-w-2xl">
            <p className="font-display text-xl font-semibold tracking-tight text-[#22485b] sm:text-2xl">
              Welcome to OCS Care, {firstName}.
            </p>
            <p className="mt-3 text-base leading-relaxed text-[#4e7b83]">
              Your health space is ready. Request your first home visit and your records,
              history and care will all live here.
            </p>
            <Link
              to="/active-visit"
              className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-[#2d8f98] transition hover:gap-3 hover:text-[#1f6c74]"
            >
              Request a Home Visit <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
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

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        {/* Next Appointment */}
        <div className="animate-fade-in-up stagger-4 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-7 shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
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

          {loading ? (
            <div className="mt-4 h-28 animate-pulse rounded-[20px] bg-[rgba(65,200,198,0.06)]" />
          ) : nextAppointment ? (
            <div className="mt-4 rounded-[20px] border border-[rgba(65,200,198,0.14)] bg-white/80 p-5 shadow-[0_8px_24px_rgba(34,72,91,0.04)]">
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
          ) : (
            <div className="mt-4 flex flex-col items-center rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(65,200,198,0.06),rgba(255,255,255,0))] px-6 py-10 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(65,200,198,0.18),rgba(45,143,152,0.12))]">
                <HousePlus className="size-8 text-[#2d8f98]" strokeWidth={1.75} />
              </div>
              <h3 className="mt-5 font-display text-xl font-semibold tracking-tight text-[#22485b]">
                Your doctor, at your door.
              </h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-[#5b7f8a]">
                Request a home visit in seconds. A doctor will be with you wherever you are
                in Mauritius.
              </p>
              <Link
                to="/active-visit"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#2d8f98,#1f6c74)] px-6 py-3 text-sm font-bold text-white shadow-[0_14px_36px_rgba(31,108,116,0.35)] transition hover:gap-3 hover:brightness-110"
              >
                Request a Visit <ArrowRight className="size-4" />
              </Link>
            </div>
          )}
        </div>

        {/* Past Consultations */}
        <div className="animate-fade-in-up stagger-5 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-7 shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
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

          {loading ? (
            <div className="mt-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-2xl bg-[rgba(65,200,198,0.06)]" />
              ))}
            </div>
          ) : recentActivity.length > 0 ? (
            <div className="mt-4 space-y-3">
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
          ) : (
            <div className="mt-4 flex flex-col items-center rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(65,200,198,0.06),rgba(255,255,255,0))] px-6 py-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(65,200,198,0.18),rgba(45,143,152,0.12))]">
                <History className="size-7 text-[#2d8f98]" strokeWidth={1.75} />
              </div>
              <h3 className="mt-5 font-display text-lg font-semibold tracking-tight text-[#22485b]">
                Your health story starts here.
              </h3>
              <p className="mt-2 max-w-xs text-sm leading-relaxed text-[#5b7f8a]">
                Every visit, every record, every moment of care will be beautifully
                organised right here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* OCS Updates & Insights */}
      <div className="animate-fade-in-up stagger-6">
        <div className="flex items-center gap-2">
          <Newspaper className="size-4 text-[#2d8f98]" />
          <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            OCS Updates &amp; Insights
          </h2>
        </div>
        <div className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {OCS_UPDATES.map(({ icon: Icon, tag, title, desc, accent }) => (
            <article
              key={title}
              className="group flex flex-col rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-6 shadow-[0_8px_24px_rgba(34,72,91,0.04)] transition duration-300 ease-out hover:-translate-y-1 hover:scale-[1.01] hover:border-[rgba(65,200,198,0.28)] hover:shadow-[0_22px_50px_rgba(34,72,91,0.12)]"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl p-2.5" style={{ background: accent }}>
                  <Icon className="size-5 text-white" />
                </div>
                <span className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#5f9aa0]">
                  {tag}
                </span>
              </div>
              <h3 className="mt-4 font-display text-base font-semibold leading-snug text-[#22485b]">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#5b7f8a]">{desc}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#2d8f98] transition group-hover:gap-2">
                Discover <ArrowRight className="size-3" />
              </span>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PatientDashboard;
