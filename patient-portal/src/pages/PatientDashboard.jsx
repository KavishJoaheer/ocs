import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import dayjs from "dayjs";
import {
  CalendarDays,
  CreditCard,
  UserCircle,
  Clock,
  TrendingUp,
  ArrowRight,
  CalendarCheck,
  Stethoscope,
  Activity,
  Sparkles,
} from "lucide-react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { api } from "../lib/api.js";

function StatCard({ icon: Icon, label, value, color, delay }) {
  return (
    <div
      className={`animate-fade-in-up stagger-${delay} rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-5 shadow-[0_16px_48px_rgba(34,72,91,0.08)] transition hover:shadow-[0_20px_56px_rgba(34,72,91,0.12)]`}
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
        <p className="mt-2 text-base text-[#5b7f8a]">
          Here&apos;s an overview of your health portal activity.
        </p>
      </div>

      {/* Stats cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-[24px] bg-[rgba(65,200,198,0.08)]" />
          ))}
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
        <div className="animate-fade-in-up stagger-4 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-6 shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
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
            <div className="mt-4 rounded-[20px] border border-dashed border-[rgba(65,200,198,0.25)] bg-[rgba(65,200,198,0.04)] p-8 text-center">
              <CalendarDays className="mx-auto size-10 text-[rgba(65,200,198,0.4)]" />
              <p className="mt-3 text-sm font-semibold text-[#5b7f8a]">No upcoming appointments</p>
              <p className="mt-1 text-xs text-[#6e949b]">
                Contact our team to schedule your next visit.
              </p>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="animate-fade-in-up stagger-5 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(241,251,250,0.88))] p-6 shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-[#2d8f98]" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
              Recent Activity
            </h2>
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
            <div className="mt-4 rounded-[20px] border border-dashed border-[rgba(65,200,198,0.25)] bg-[rgba(65,200,198,0.04)] p-6 text-center">
              <Activity className="mx-auto size-8 text-[rgba(65,200,198,0.4)]" />
              <p className="mt-2 text-sm font-semibold text-[#5b7f8a]">No recent activity</p>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="animate-fade-in-up stagger-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6e949b]">
          Quick Actions
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            { to: "/appointments", icon: CalendarDays, label: "View Appointments", desc: "Check your schedule" },
            { to: "/billing", icon: CreditCard, label: "View Bills", desc: "Payment history" },
            { to: "/profile", icon: UserCircle, label: "Update Profile", desc: "Personal details" },
          ].map(({ to, icon: Icon, label, desc }) => (
            <Link
              key={to}
              to={to}
              className="group rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-white/80 p-5 shadow-[0_8px_24px_rgba(34,72,91,0.04)] transition hover:border-[rgba(65,200,198,0.3)] hover:shadow-[0_16px_40px_rgba(34,72,91,0.1)]"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-[rgba(65,200,198,0.1)] p-2.5 transition group-hover:bg-[rgba(65,200,198,0.16)]">
                  <Icon className="size-5 text-[#2d8f98]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#22485b]">{label}</p>
                  <p className="text-xs text-[#6e949b]">{desc}</p>
                </div>
                <ArrowRight className="ml-auto size-4 text-[rgba(65,200,198,0.4)] transition group-hover:text-[#2d8f98]" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export default PatientDashboard;
