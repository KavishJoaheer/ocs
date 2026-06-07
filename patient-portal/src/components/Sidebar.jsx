import {
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  UserCircle,
  X,
  Heart,
  History,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { useState } from "react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/consultations", label: "Consultation History", icon: History },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/profile", label: "Profile", icon: UserCircle },
];

function SidebarLink({ item, mobile = false, onClick }) {
  const Icon = item.icon;

  return (
    <NavLink
      end={item.end}
      to={item.to}
      onClick={onClick}
      className={({ isActive }) =>
        [
          "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all",
          mobile
            ? "min-w-fit border border-[rgba(65,200,198,0.16)] bg-white/80 text-slate-600 hover:bg-white"
            : "text-[#4e7b83] hover:bg-white/70 hover:text-[#22485b]",
          isActive &&
            (mobile
              ? "border-[rgba(65,200,198,0.35)] bg-[#2d8f98] text-white shadow-lg shadow-[rgba(45,143,152,0.18)]"
              : "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white shadow-lg shadow-[rgba(45,143,152,0.22)]"),
        ]
          .filter(Boolean)
          .join(" ")
      }
    >
      <Icon className={mobile ? "size-4 text-current" : "size-4 text-[#66d7d0]"} />
      <span>{item.label}</span>
    </NavLink>
  );
}

function Sidebar() {
  const { logout, user } = usePatientAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <>
      {/* ─── Mobile top bar ─── */}
      <div className="border-b border-[rgba(65,200,198,0.14)] bg-white/88 px-4 py-4 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/ocs-medecins-mark.png" alt="OCS" className="h-8 w-auto" />
            <div>
              <p className="font-display text-sm font-bold tracking-tight text-[#22485b]">
                Patient Portal
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-white/80 p-2 text-[#2d8f98] transition hover:bg-white"
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {mobileOpen && (
          <div className="mt-4 animate-fade-in space-y-3">
            <div className="rounded-[26px] border border-sky-200 bg-sky-50 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-xs font-bold text-white">
                  {initials}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{user?.full_name}</p>
                  <p className="text-xs text-[#5b7f8a]">{user?.email}</p>
                </div>
              </div>
            </div>

            <nav className="flex flex-wrap gap-2">
              {navItems.map((item) => (
                <SidebarLink
                  key={item.to}
                  item={item}
                  mobile
                  onClick={() => setMobileOpen(false)}
                />
              ))}
            </nav>

            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-white/80 px-3 py-2.5 text-sm font-semibold text-[#2d8f98] transition hover:bg-white"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* ─── Desktop sidebar ─── */}
      <aside className="hidden w-80 shrink-0 border-r border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,#fbfefe_0%,#eef9f8_100%)] lg:flex lg:flex-col">
        <div className="flex flex-1 flex-col px-6 py-8">
          {/* Brand card */}
          <div className="relative overflow-hidden rounded-[38px] border border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,#a9b8bf_0%,#9aaab2_100%)] p-5 shadow-[0_32px_80px_rgba(34,72,91,0.16)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.38),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.12),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.08),rgba(26,56,68,0.08))]" />
            <div className="relative z-10 flex flex-col">
              <div className="inline-flex self-center rounded-[20px] bg-white px-4 py-3 shadow-[0_16px_40px_rgba(34,72,91,0.14)]">
                <img
                  src="/ocs-medecins-logo.png"
                  alt="OCS Médecins"
                  className="h-10 w-auto drop-shadow-[0_8px_24px_rgba(34,72,91,0.06)]"
                />
              </div>

              <h1 className="mt-8 max-w-[15rem] font-display text-[1.65rem] leading-[1.1] tracking-tight text-[#f3c438]">
                Your health, your portal.
              </h1>
            </div>
          </div>

          {/* User card */}
          <div className="mt-6 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-white/92 px-5 py-7 text-[#22485b] shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-sm font-bold text-white shadow-lg shadow-[rgba(45,143,152,0.22)]">
                  {initials}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6e949b]">
                    Patient
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-[#22485b]">{user?.full_name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => logout()}
                className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-[rgba(65,200,198,0.08)] px-3 py-2 text-sm font-semibold text-[#2d8f98] transition hover:bg-[rgba(65,200,198,0.14)]"
              >
                <LogOut className="size-4" />
                <span className="hidden xl:inline">Sign out</span>
              </button>
            </div>
          </div>

          {/* Nav links */}
          <div className="mt-8">
            <p className="px-4 text-xs font-semibold uppercase tracking-[0.3em] text-[#6e949b]">
              Navigation
            </p>
            <nav className="mt-4 space-y-2">
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
            <div className="mt-4 rounded-[24px] bg-[linear-gradient(90deg,rgba(65,200,198,0.14),rgba(242,193,77,0.14))] px-4 py-3">
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
