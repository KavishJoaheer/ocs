import {
  LayoutDashboard,
  LogOut,
  CircleUserRound,
  Heart,
  HousePlus,
  HeartPulse,
  CalendarCheck,
  ReceiptText,
} from "lucide-react";
import { NavLink, Link } from "react-router-dom";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import FamilyProfileSwitcher from "./FamilyProfileSwitcher.jsx";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/health-records", label: "Health Records", icon: HeartPulse },
  { to: "/appointments", label: "Review Appointments", icon: CalendarCheck },
  { to: "/billing", label: "Billing", icon: ReceiptText },
  { to: "/profile", label: "Profile", icon: CircleUserRound },
];

function SidebarLink({ item }) {
  const Icon = item.icon;

  return (
    <NavLink
      end={item.end}
      to={item.to}
      className={({ isActive }) =>
        [
          "group flex min-h-[44px] items-center gap-3 rounded-2xl px-4 text-sm transition-all",
          isActive
            ? "border-l-[3px] border-[#1a5c52] bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] font-medium text-white shadow-lg shadow-[rgba(45,143,152,0.22)]"
            : "border-l-[3px] border-transparent font-normal text-[#2a6a5e] hover:bg-white/70",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={`size-[18px] shrink-0 ${isActive ? "text-white" : "text-[#6B9E95]"}`}
            strokeWidth={1.5}
          />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function Sidebar() {
  const { logout } = usePatientAuth();

  return (
    <>
      {/* ─── Mobile top bar ─── */}
      <div className="relative flex h-14 shrink-0 items-center justify-between border-b border-[rgba(26,160,140,0.08)] bg-white px-4 lg:hidden">
        <img
          src="/ocs-medecins-mark.png"
          alt="OCS Care"
          className="size-7 shrink-0 object-contain"
        />
        <p className="absolute left-1/2 -translate-x-1/2 text-[12px] font-medium tracking-[2px] text-[#1a5c52]">
          OCS Care
        </p>
        <FamilyProfileSwitcher variant="avatar" />
      </div>

      {/* ─── Mobile bottom navigation ─── */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[rgba(26,160,140,0.08)] bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto flex h-[68px] max-w-md items-stretch justify-around px-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const shortLabel =
              item.to === "/health-records"
                ? "Records"
                : item.to === "/appointments"
                  ? "Appts"
                  : item.label.split(" ")[0];
            return (
              <NavLink
                key={item.to}
                end={item.end}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "relative flex min-h-[44px] min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors active:opacity-60",
                    isActive ? "text-[#1a5c52]" : "text-[#9ab0ab]",
                  ].join(" ")
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive ? (
                      <span
                        className="absolute top-1.5 h-4 w-[3px] rounded-full bg-[#1a5c52]"
                        aria-hidden="true"
                      />
                    ) : null}
                    <Icon className="size-[22px]" strokeWidth={1.5} />
                    <span className="leading-none">{shortLabel}</span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

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

          {/* Profile switcher */}
          <div className="relative mt-7 flex items-start justify-between gap-3">
            <FamilyProfileSwitcher />
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
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#e8a020] px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95"
          >
            <HousePlus className="size-5" />
            Request a Home Visit
          </Link>

          {/* Nav links */}
          <div className="mt-9">
            <p className="px-4 text-xs font-semibold uppercase tracking-[0.3em] text-[#6e949b]">
              Navigation
            </p>
            <nav className="mt-4 space-y-[26px]">
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
