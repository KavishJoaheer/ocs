import {
  LayoutDashboard,
  LogOut,
  CircleUserRound,
  HousePlus,
  HeartPulse,
  CalendarCheck,
  ReceiptText,
} from "lucide-react";
import { NavLink, Link, useLocation } from "react-router-dom";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import FamilyProfileSwitcher from "./FamilyProfileSwitcher.jsx";
import MobileBottomNav from "./MobileBottomNav.jsx";

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
          "group -mx-6 flex min-h-[44px] items-center gap-3 border-l-[3px] px-6 text-sm transition-colors",
          isActive
            ? "border-[#e8a020] bg-[rgba(26,160,140,0.08)] font-semibold text-[#1a5c52]"
            : "border-transparent font-normal text-[#2a6a5e] hover:bg-[rgba(26,160,140,0.04)]",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={`size-[18px] shrink-0 ${isActive ? "text-[#2d8f98]" : "text-[#6B9E95]"}`}
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
  const { pathname } = useLocation();
  const isNativeDashboard = pathname === "/dashboard";
  const isVisitSummary = pathname.startsWith("/health-records/visits/");
  const isVisitStatus = pathname === "/request-visit/tracking";
  const isProfile = pathname === "/profile";
  const hideMobileTopBar = isNativeDashboard || isVisitSummary || isVisitStatus || isProfile;

  return (
    <>
      {/* ─── Mobile top bar (hidden on native dashboard — header is in-page) ─── */}
      <div
        className={`mobile-top-bar relative flex min-h-14 items-center justify-between border-b border-[rgba(26,160,140,0.1)] bg-white px-4 lg:hidden ${hideMobileTopBar ? "hidden" : ""}`}
      >
        <img
          src="/ocs-medecins-mark.png"
          alt="OCS Care"
          className="h-8 w-8 shrink-0 object-contain"
        />
        <p className="absolute left-1/2 -translate-x-1/2 text-[11px] font-semibold uppercase tracking-[2px] text-[#2d8f98]">
          OCS Care
        </p>
        <FamilyProfileSwitcher variant="avatar" />
      </div>

      {/* ─── Mobile bottom navigation — floating pill bar ─── */}
      <MobileBottomNav />

      {/* ─── Desktop sidebar ─── */}
      <aside className="hidden w-80 shrink-0 border-r border-[rgba(0,0,0,0.06)] bg-white shadow-[4px_0_24px_-8px_rgba(0,0,0,0.04)] lg:flex lg:flex-col">
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
              className="inline-flex shrink-0 items-center justify-center rounded-[16px] border border-[rgba(65,200,198,0.22)] bg-[rgba(65,200,198,0.08)] p-2 text-[#2d8f98] transition hover:bg-[rgba(65,200,198,0.16)]"
            >
              <LogOut className="size-4" />
            </button>
          </div>

          {/* Request a home visit — primary action */}
          <Link
            to="/request-visit"
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[16px] bg-[#e8a020] px-5 py-3.5 text-sm font-bold text-white shadow-[0_8px_24px_-6px_rgba(232,160,32,0.45)] transition hover:brightness-105 hover:shadow-[0_10px_28px_-6px_rgba(232,160,32,0.5)] active:scale-[0.98]"
          >
            <HousePlus className="size-5" />
            Request a Home Visit
          </Link>

          {/* Nav links */}
          <div className="mt-9">
            <p className="px-4 text-xs font-semibold uppercase tracking-[0.3em] text-[#6e949b]">
              Navigation
            </p>
            <nav className="mt-4 space-y-0.5">
              {navItems.map((item) => (
                <SidebarLink key={item.to} item={item} />
              ))}
            </nav>
          </div>

          <div className="mt-auto" aria-hidden="true" />
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
