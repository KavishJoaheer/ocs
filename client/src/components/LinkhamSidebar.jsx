import { LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import BrandMark from "./BrandMark.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { getRoleLabel } from "../lib/access.js";
import { cx } from "../lib/utils.js";

const linkhamNavItems = [
  { id: "dashboard", to: "/linkham/dashboard", label: "Dashboard", emoji: "📊", end: true },
  { id: "insured_patients", to: "/linkham/patients", label: "Insured Patient", emoji: "👥" },
  { id: "claims_clearance", to: "/linkham/claims-clearance", label: "Claims Clearance", emoji: "💳" },
  { id: "reports", to: "/linkham/reports", label: "Report", emoji: "📈" },
];

function LinkhamNavButton({ item, onNavigate }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-3 rounded-xl px-4 py-3 text-xs font-bold transition-all",
          isActive
            ? "bg-[#557373] text-white shadow-sm"
            : "text-gray-500 hover:bg-gray-50",
        )
      }
    >
      <span aria-hidden="true">{item.emoji}</span>
      <span>{item.label}</span>
    </NavLink>
  );
}

function LinkhamSidebarNav({ onNavigate, className }) {
  return (
    <nav className={cx("flex flex-col gap-1.5", className)}>
      {linkhamNavItems.map((item) => (
        <LinkhamNavButton key={item.id} item={item} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

export default function LinkhamSidebar() {
  const { logout, user } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

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
        className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-gray-100 bg-white px-4 lg:hidden"
        style={{
          paddingTop: "max(0px, var(--sat))",
          paddingLeft: "max(1rem, var(--sal))",
          paddingRight: "max(1rem, var(--sar))",
        }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-xl p-2 text-[#557373] transition hover:bg-gray-50"
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
            <LinkhamSidebarNav onNavigate={() => setDrawerOpen(false)} />
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

      <aside className="hidden min-h-screen w-64 shrink-0 flex-col border-r border-gray-100 bg-white lg:flex">
        <div className="border-b border-gray-100 px-4 py-5">
          <BrandMark maxWidth={150} size={34} />
          <div className="mt-4 flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
            <div className="rounded-xl border border-gray-100 bg-white p-2 text-[#557373]">
              <ShieldCheck className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-gray-900">{user.full_name}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                {getRoleLabel(user.role)}
              </p>
            </div>
          </div>
        </div>

        <LinkhamSidebarNav className="flex-1 p-4" />

        <div className="border-t border-gray-100 p-4">
          <button
            type="button"
            onClick={() => logout()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-bold text-gray-600 transition hover:bg-gray-50"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>
    </div>
  );
}

export { linkhamNavItems };
