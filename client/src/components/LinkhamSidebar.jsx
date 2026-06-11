import { LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import BrandMark from "./BrandMark.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { getRoleLabel } from "../lib/access.js";
import { cx } from "../lib/utils.js";

const linkhamNavItems = [
  { id: "dashboard", to: "/linkham/dashboard", label: "Dashboard", end: true },
  { id: "insured_patients", to: "/linkham/patients", label: "Insured Patient" },
  { id: "claims_clearance", to: "/linkham/claims-clearance", label: "Claims Clearance" },
  { id: "reports", to: "/linkham/reports", label: "Report" },
];

function LinkhamNavIcon({ id, active, darkSidebar = false }) {
  const strokeClass = active
    ? "stroke-ocs-teal"
    : darkSidebar
      ? "stroke-slate-500 group-hover:stroke-slate-700"
      : "stroke-slate-500 group-hover:stroke-slate-700";

  const iconProps = {
    className: cx("size-4 fill-none stroke-2", strokeClass),
    viewBox: "0 0 24 24",
    "aria-hidden": true,
  };

  switch (id) {
    case "dashboard":
      return (
        <svg {...iconProps}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "insured_patients":
      return (
        <svg {...iconProps}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "claims_clearance":
      return (
        <svg {...iconProps}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      );
    case "reports":
      return (
        <svg {...iconProps}>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    default:
      return null;
  }
}

function LinkhamNavButton({ item, onNavigate, darkSidebar = false }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          "group flex w-full items-center gap-3.5 rounded-xl px-4 py-3 text-xs font-bold transition-all duration-200",
          darkSidebar
            ? isActive
              ? "bg-ocs-teal/10 font-semibold text-ocs-teal"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            : isActive
              ? "bg-ocs-teal/10 font-semibold text-ocs-teal"
              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
        )
      }
    >
      {({ isActive }) => (
        <>
          <LinkhamNavIcon id={item.id} active={isActive} darkSidebar={darkSidebar} />
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

function LinkhamSidebarNav({ onNavigate, className, darkSidebar = false }) {
  return (
    <nav className={cx("mt-4 flex w-full flex-col gap-1 px-3", className)}>
      {linkhamNavItems.map((item) => (
        <LinkhamNavButton key={item.id} item={item} onNavigate={onNavigate} darkSidebar={darkSidebar} />
      ))}
    </nav>
  );
}

export default function LinkhamSidebar() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [lastPathname, setLastPathname] = useState(location.pathname);

  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname);
    setDrawerOpen(false);
  }

  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawerOpen]);

  return (
    <div className="flex w-full min-w-0 shrink-0 flex-col lg:w-64 lg:shrink-0">
      <div
        className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-white/10 bg-ocs-slate px-4 shadow-md lg:hidden"
        style={{
          paddingTop: "max(0px, var(--sat))",
          paddingLeft: "max(1rem, var(--sal))",
          paddingRight: "max(1rem, var(--sar))",
        }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-xl p-2 text-white transition hover:bg-white/10"
          aria-label="Open menu"
        >
          <Menu className="size-6" strokeWidth={2.25} />
        </button>
        <BrandMark maxWidth={150} size={34} />
        <div className="size-10 shrink-0" aria-hidden="true" />
      </div>

      <div className={cx("fixed inset-0 z-50 lg:hidden", drawerOpen ? "" : "pointer-events-none")}>
        <div
          className={cx(
            "absolute inset-0 bg-black/40 transition-opacity duration-300",
            drawerOpen ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
        <div
          className={cx(
            "fixed inset-y-0 left-0 z-50 flex h-full w-64 flex-col justify-between overflow-y-auto border-r border-gray-100 bg-white p-4 shadow-[8px_0_30px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-in-out",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div>
            <div className="mb-4 flex items-center justify-between">
              <BrandMark maxWidth={140} size={32} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-xl p-2 text-gray-500 hover:bg-gray-50"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            <LinkhamSidebarNav onNavigate={() => setDrawerOpen(false)} className="mt-0 px-0" />
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-600"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </div>

      <aside className="hidden min-h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="border-b border-slate-200 bg-white px-4 py-5">
          <BrandMark maxWidth={150} size={34} />
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="rounded-xl border border-slate-200 bg-white p-2 text-ocs-teal">
              <ShieldCheck className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ocs-slate">{user.full_name}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ocs-grey">
                {getRoleLabel(user.role)}
              </p>
            </div>
          </div>
        </div>

        <LinkhamSidebarNav className="flex-1" darkSidebar />

        <div className="border-t border-slate-200 p-4">
          <button
            type="button"
            onClick={() => logout()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:border-ocs-teal hover:text-ocs-teal"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>
    </div>
  );
}
