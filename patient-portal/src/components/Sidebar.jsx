import { LogOut, HousePlus } from "lucide-react";
import { NavLink } from "react-router-dom";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { PATIENT_NAV_ITEMS } from "../lib/navConfig.js";
import FamilyProfileSwitcher from "./FamilyProfileSwitcher.jsx";
import MobileBottomNav from "./MobileBottomNav.jsx";
import RequestVisitCta from "./request-visit/RequestVisitCta.jsx";

function SidebarLink({ item }) {
  const Icon = item.icon;

  return (
    <NavLink
      end={item.end}
      to={item.to}
      className={({ isActive }) =>
        [
          "sidebar-nav-link group relative flex min-h-[44px] items-center gap-3 rounded-xl px-3.5 text-sm outline-none transition-colors focus:outline-none focus-visible:outline-none",
          isActive
            ? "sidebar-nav-link-active font-semibold text-brand-teal lg:text-white"
            : "font-normal text-brand-cool-grey hover:bg-[rgba(43,204,196,0.06)]",
        ].join(" ")
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span
              className="absolute left-0 top-0 bottom-0 w-1 bg-brand-teal shadow-[0_0_12px_rgba(43,204,196,0.45)] lg:hidden"
              aria-hidden="true"
            />
          ) : null}
          <Icon
            className={`size-[18px] shrink-0 ${isActive ? "text-brand-teal lg:text-white" : "text-brand-cool-grey"}`}
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
      {/* ─── Mobile bottom navigation — command center bar ─── */}
      <MobileBottomNav />

      {/* ─── Desktop sidebar ─── */}
      <aside className="hidden w-72 shrink-0 border-r border-[rgba(0,0,0,0.04)] bg-white shadow-[2px_0_20px_-6px_rgba(0,0,0,0.03)] lg:flex lg:flex-col">
        <div className="flex flex-1 flex-col px-5 py-6">
          {/* Brand */}
          <div className="flex flex-col items-start gap-2">
            <img
              src="/ocs-medecins-logo.png"
              alt="OCS Médecins"
              className="h-10 w-auto drop-shadow-[0_8px_24px_rgba(34,72,91,0.08)]"
            />
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.32em] text-brand-teal">
              OCS Care
            </p>
          </div>

          {/* Profile switcher */}
          <div className="relative mt-6 flex items-start justify-between gap-3">
            <FamilyProfileSwitcher />
            <button
              type="button"
              onClick={() => logout()}
              aria-label="Sign out"
              className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-[16px] border border-brand-teal/20 bg-brand-teal/10 p-2 text-brand-teal transition hover:bg-brand-teal/20"
            >
              <LogOut className="size-4" />
            </button>
          </div>

          {/* Request a home visit — primary action */}
          <RequestVisitCta
            className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[14px] bg-brand-gold px-4 py-3 text-sm font-bold text-brand-dark-grey shadow-[0_8px_24px_-6px_rgba(var(--ocs-brand-gold-rgb),0.35)] transition hover:brightness-105 hover:shadow-[0_10px_28px_-6px_rgba(var(--ocs-brand-gold-rgb),0.45)] active:scale-[0.98] lg:bg-ocs-yellow lg:text-slate-900"
            leading={<HousePlus className="size-5" />}
          />

          {/* Nav links */}
          <div className="mt-7">
            <p className="px-3 text-[10px] font-bold uppercase tracking-[0.24em] text-brand-cool-grey">
              Navigation
            </p>
            <nav className="mt-3 space-y-1">
              {PATIENT_NAV_ITEMS.map((item) => (
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
