import {
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  LogOut,
  UserCircle,
  Heart,
  History,
  HousePlus,
  Plus,
} from "lucide-react";
import { NavLink, Link } from "react-router-dom";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/appointments", label: "Review Appointments", icon: CalendarDays },
  { to: "/consultations", label: "Consultation History", icon: History },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/profile", label: "Profile", icon: UserCircle },
];

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function SidebarLink({ item }) {
  const Icon = item.icon;

  return (
    <NavLink
      end={item.end}
      to={item.to}
      className={({ isActive }) =>
        [
          "group flex items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-semibold transition-all",
          "text-[#4e7b83] hover:bg-white/70 hover:text-[#22485b]",
          isActive &&
            "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white shadow-lg shadow-[rgba(45,143,152,0.22)]",
        ]
          .filter(Boolean)
          .join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <Icon className={isActive ? "size-4 text-current" : "size-4 text-[#66d7d0]"} />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const { logout, user } = usePatientAuth();

  const firstName = user?.full_name?.split(" ")[0] || "there";
  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";
  const sinceYear = user?.created_at ? new Date(user.created_at).getFullYear() : 2026;

  return (
    <>
      {/* ─── Mobile top bar ─── */}
      <div className="flex items-center justify-between gap-4 border-b border-[rgba(65,200,198,0.14)] bg-white/88 px-4 py-3.5 backdrop-blur lg:hidden">
        <div className="flex items-center gap-3">
          <img src="/ocs-medecins-mark.png" alt="OCS Care" className="h-8 w-auto" />
          <div>
            <p className="text-[0.6rem] font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
              OCS Care
            </p>
            <p className="font-display text-sm font-bold leading-tight tracking-tight text-[#22485b]">
              {timeGreeting()}, {firstName}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          aria-label="Sign out"
          className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-white/80 p-2 text-[#2d8f98] transition hover:bg-white"
        >
          <LogOut className="size-5" />
        </button>
      </div>

      {/* ─── Mobile bottom navigation ─── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[rgba(65,200,198,0.16)] bg-white/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-md items-end justify-around px-2 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                end={item.end}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "flex min-w-[56px] flex-col items-center gap-1 rounded-2xl px-2 py-1.5 text-[0.6rem] font-semibold transition-all",
                    isActive ? "text-[#2d8f98]" : "text-[#7c9aa1]",
                  ].join(" ")
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={isActive ? "size-5" : "size-5 opacity-80"} />
                    <span className="leading-none">{item.label.split(" ")[0]}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* ─── Mobile floating action button ─── */}
      <Link
        to="/request-visit"
        aria-label="Request a home visit"
        className="fixed bottom-[4.75rem] left-1/2 z-50 inline-flex size-14 -translate-x-1/2 items-center justify-center rounded-full bg-[linear-gradient(135deg,#2d8f98,#1f6c74)] text-white shadow-[0_14px_36px_rgba(31,108,116,0.45)] transition hover:brightness-110 lg:hidden"
      >
        <Plus className="size-7" strokeWidth={2.5} />
      </Link>

      {/* ─── Desktop sidebar ─── */}
      <aside className="hidden w-80 shrink-0 border-r border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,#fbfefe_0%,#eef9f8_100%)] lg:flex lg:flex-col">
        <div className="flex flex-1 flex-col px-6 py-8">
          {/* Brand */}
          <div className="flex flex-col items-start gap-2">
            <img
              src="/ocs-medecins-logo.png"
              alt="OCS Médecins"
              className="h-11 w-auto drop-shadow-[0_8px_24px_rgba(34,72,91,0.08)]"
            />
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.32em] text-[#2d8f98]">
              OCS Care
            </p>
          </div>

          {/* Profile */}
          <div className="mt-7 flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-base font-bold text-white shadow-lg shadow-[rgba(45,143,152,0.22)]">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-semibold tracking-tight text-[#22485b]">
                {user?.full_name || "Patient"}
              </p>
              <p className="mt-0.5 text-xs text-[#6e949b]">Patient since {sinceYear}</p>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              aria-label="Sign out"
              className="inline-flex shrink-0 items-center justify-center rounded-2xl border border-[rgba(65,200,198,0.22)] bg-[rgba(65,200,198,0.08)] p-2 text-[#2d8f98] transition hover:bg-[rgba(65,200,198,0.16)]"
            >
              <LogOut className="size-4" />
            </button>
          </div>

          {/* Request a home visit — primary action */}
          <Link
            to="/request-visit"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#e8a020] px-5 py-3.5 text-sm font-bold text-white shadow-[0_16px_40px_rgba(232,160,32,0.38)] transition hover:brightness-105"
          >
            <HousePlus className="size-5" />
            Request a Home Visit
          </Link>

          {/* Nav links */}
          <div className="mt-9">
            <p className="px-4 text-xs font-semibold uppercase tracking-[0.3em] text-[#6e949b]">
              Navigation
            </p>
            <nav className="mt-4 space-y-5">
              {navItems.map((item) => (
                <SidebarLink key={item.to} item={item} />
              ))}
            </nav>
          </div>

          {/* Bottom card */}
          <div className="mt-auto rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-white/92 p-5 text-[#22485b] shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6e949b]">
              Need help?
            </p>
            <p className="mt-3 text-sm font-semibold text-[#22485b]">Contact our care team</p>
            <p className="mt-2 text-sm leading-6 text-[#5b7f8a]">
              Reach out any time for appointment changes, billing questions, or medical inquiries.
            </p>
            <div className="mt-4 rounded-[24px] bg-[rgba(65,200,198,0.10)] px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#2d8f98]">
                Hotline
              </p>
              <div className="mt-1 flex items-center gap-3">
                <Heart className="size-4 shrink-0 text-[#f2c14d]" />
                <p className="pl-1 text-xl font-bold tracking-tight text-[#22485b]">
                  52 52 22 34
                </p>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
