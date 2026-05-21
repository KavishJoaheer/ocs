import {
  Activity,
  BellRing,
  CalendarDays,
  CreditCard,
  Home,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PieChart,
  RotateCw,
  ShieldCheck,
  Star,
  UsersRound,
  X,
} from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import BrandMark from "./BrandMark.jsx";
import PushNotificationToggle from "./PushNotificationToggle.jsx";
import { bottomNavItems } from "./BottomNav.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { getRoleLabel } from "../lib/access.js";
import { cx } from "../lib/utils.js";

const navItems = [
  {
    to: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    end: true,
    roles: ["admin", "doctor", "operator", "lab_tech", "accountant"],
  },
  {
    to: "/patients",
    label: "Patient",
    icon: UsersRound,
    roles: ["admin", "doctor", "operator", "lab_tech"],
    isActiveWhen: (location) => {
      if (location.pathname !== "/patients") return false;
      const params = new URLSearchParams(location.search);
      if (params.get("filter") === "subscribed") return false;
      if (params.get("tab") === "under_review" || params.get("filter") === "under_review") {
        return false;
      }
      return true;
    },
  },
  {
    to: "/patients?filter=subscribed",
    label: "Health plans",
    icon: Star,
    roles: ["admin"],
    isActiveWhen: (location) => {
      if (location.pathname !== "/patients") return false;
      return new URLSearchParams(location.search).get("filter") === "subscribed";
    },
  },
  {
    to: "/doctor/long-term-review",
    label: "Long term review",
    icon: Activity,
    roles: ["doctor"],
    isActiveWhen: (location) => location.pathname === "/doctor/long-term-review",
  },
  {
    to: "/hcm-news",
    label: "HCM news",
    icon: BellRing,
    roles: ["admin", "doctor", "operator", "lab_tech", "accountant"],
  },
  {
    to: "/operator/billing-status",
    label: "Billing status",
    icon: CreditCard,
    roles: ["operator"],
  },
  {
    to: "/appointments",
    label: "Appointments",
    icon: CalendarDays,
    roles: ["admin", "doctor"],
  },
  {
    to: "/billing",
    label: "Billing",
    icon: CreditCard,
    roles: ["admin", "doctor", "accountant"],
  },
  {
    to: "/live-report",
    label: "Live report",
    icon: PieChart,
    roles: ["admin", "doctor"],
  },
  {
    to: "/inventory",
    label: "Inventory",
    icon: Package,
    roles: ["admin", "doctor", "operator"],
  },
  {
    to: "/stock-history",
    label: "Live Activity",
    icon: RotateCw,
    roles: ["admin", "operator"],
  },
  {
    to: "/team-operations",
    label: "Team operations",
    icon: UsersRound,
    roles: ["admin"],
  },
];

function resolveNavTarget(to) {
  const [pathname, search = ""] = String(to || "").split("?");
  return search ? { pathname, search: `?${search}` } : pathname;
}

function SidebarLink({ item, mobile = false, drawer = false, badgeCount = 0, onNavigate }) {
  const Icon = item.icon;
  const location = useLocation();

  return (
    <NavLink
      end={item.end}
      to={resolveNavTarget(item.to)}
      onClick={() => onNavigate?.()}
      className={({ isActive: routerActive }) => {
        const isActive =
          typeof item.isActiveWhen === "function" ? item.isActiveWhen(location) : routerActive;

        return cx(
          "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all",
          drawer && "min-h-12",
          mobile
            ? "min-w-fit border border-[rgba(65,200,198,0.16)] bg-white/80 text-slate-600 hover:bg-white"
            : drawer
              ? "text-gray-600 hover:bg-[#557373]/10 hover:text-gray-900"
              : "text-[#4e7b83] hover:bg-white/70 hover:text-[#22485b]",
          isActive &&
            (mobile
              ? "border-[rgba(65,200,198,0.35)] bg-[#2d8f98] text-white shadow-lg shadow-[rgba(45,143,152,0.18)]"
              : drawer
                ? "bg-[#557373]/15 font-bold text-gray-900 shadow-sm"
                : "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white shadow-lg shadow-[rgba(45,143,152,0.22)]"),
        );
      }}
    >
      <Icon
        className={cx(
          "size-4 shrink-0",
          drawer ? "text-gray-500 group-hover:text-gray-800" : mobile ? "text-current" : "text-[#66d7d0]",
        )}
      />
      <span>{item.label}</span>
      {badgeCount > 0 ? (
        <span
          className={cx(
            "ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-bold",
            mobile ? "bg-white/90 text-[#2d8f98]" : "bg-rose-500 text-white",
          )}
        >
          {badgeCount > 9 ? "9+" : badgeCount}
        </span>
      ) : null}
    </NavLink>
  );
}

function Sidebar() {
  const { logout, user, hcmUnreadCount } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const visibleNavItems = useMemo(
    () => navItems.filter((item) => item.roles.includes(user.role)),
    [user.role],
  );

  const bottomPaths = useMemo(() => {
    const paths = bottomNavItems
      .filter((item) => item.roles.includes(user.role))
      .map((item) => item.to);
    return new Set(paths);
  }, [user.role]);

  const desktopOnlyPaths = new Set(["/appointments", "/live-report"]);

  const drawerNavItems = useMemo(
    () => visibleNavItems.filter((item) => !bottomPaths.has(item.to) && !desktopOnlyPaths.has(item.to)),
    [visibleNavItems, bottomPaths],
  );

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

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
    <div className="flex w-full min-w-0 shrink-0 flex-col lg:w-80 lg:shrink-0">
      {/* ─── Phone: slim top bar ─── */}
      <div
        className="sticky top-0 z-30 flex h-16 w-full min-w-0 items-center justify-between border-b border-[rgba(65,200,198,0.14)] bg-white/92 px-4 backdrop-blur-lg md:hidden"
        style={{ paddingTop: `max(0px, var(--sat))`, paddingLeft: `max(1rem, var(--sal))`, paddingRight: `max(1rem, var(--sar))` }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-xl p-2 text-[#2d8f98] transition hover:bg-gray-50 active:bg-gray-50"
          aria-label="Open menu"
        >
          <Menu className="h-6 w-6" strokeWidth={2.25} />
        </button>
        <BrandMark
          maxWidth={160}
          size={36}
          logoClassName="max-h-9 w-auto object-contain"
        />
        {location.pathname !== "/" ? (
          <Link
            to="/"
            className="rounded-xl p-2 text-[#2d8f98] transition hover:bg-gray-50 active:bg-gray-50"
            aria-label="Home"
          >
            <Home className="h-7 w-7" strokeWidth={2.25} />
          </Link>
        ) : (
          <div className="h-11 w-11 shrink-0" aria-hidden="true" />
        )}
      </div>

      {/* ─── Phone: slide-out drawer ─── */}
      <div className={cx("fixed inset-0 z-50 md:hidden", drawerOpen ? "" : "pointer-events-none")}>
        <div
          className={cx("absolute inset-0 bg-black/40 transition-opacity duration-300", drawerOpen ? "opacity-100" : "opacity-0")}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
        <div
          className={cx(
            "absolute inset-y-0 left-0 flex h-full w-[280px] flex-col justify-between overflow-y-auto border-r border-[#557373]/25 bg-white shadow-[5px_0_25px_rgba(0,0,0,0.12)] transition-transform duration-300",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
          style={{ paddingTop: `max(1rem, var(--sat))`, paddingBottom: `max(1rem, var(--sab))` }}
        >
          <div
            className="pointer-events-none absolute inset-0 bg-[#557373]/15"
            aria-hidden="true"
          />
          <div className="relative z-10 flex flex-1 flex-col">
            <div className="flex items-center justify-between px-5 py-3">
              <BrandMark maxWidth={150} size={36} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="grid min-h-12 min-w-10 place-items-center rounded-xl text-gray-500 transition hover:bg-[#557373]/10 hover:text-gray-800 active:scale-95"
                aria-label="Close menu"
              >
                <X className="size-5" strokeWidth={2.25} />
              </button>
            </div>

            <div className="mx-5 mb-6 rounded-2xl border border-[#557373]/20 bg-[#557373]/10 p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-[#557373]/20 bg-white p-2 text-[#557373]">
                  <ShieldCheck className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-gray-600">
                    {getRoleLabel(user.role)}
                  </p>
                  <p className="text-base font-bold text-gray-900">{user.full_name}</p>
                  <p className="truncate text-xs font-medium text-gray-600">
                    {user.email || `@${user.username}`}
                  </p>
                </div>
              </div>
            </div>

            <PushNotificationToggle alwaysShow role={user.role} />

            {drawerNavItems.length > 0 ? (
              <div className="mt-2 px-3">
                <p className="px-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-gray-500">
                  More
                </p>
                <nav className="mt-2 space-y-1">
                  {drawerNavItems.map((item) => (
                    <SidebarLink
                      key={item.to}
                      item={item}
                      drawer
                      onNavigate={() => setDrawerOpen(false)}
                      badgeCount={item.to === "/hcm-news" ? hcmUnreadCount : 0}
                    />
                  ))}
                </nav>
              </div>
            ) : null}
          </div>

          <div className="relative z-10 mt-auto px-5 pb-4 pt-4">
            <button
              type="button"
              onClick={() => logout()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-center text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-100 hover:text-rose-800"
            >
              <LogOut className="size-4 shrink-0" />
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* ─── Tablet: horizontal scroll nav (existing mobile layout) ─── */}
      <div
        className="hidden w-full min-w-0 border-b border-[rgba(65,200,198,0.14)] bg-white/88 px-4 py-4 backdrop-blur md:block lg:hidden"
        style={{ paddingTop: `max(1rem, var(--sat))`, paddingLeft: `max(1rem, var(--sal))`, paddingRight: `max(1rem, var(--sar))` }}
      >
        <div className="mb-4 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <BrandMark maxWidth={180} size={42} />
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-white/80 px-3 py-2 text-sm font-semibold text-[#2d8f98] transition hover:bg-white"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>

          <div className="rounded-[26px] border border-sky-200 bg-sky-50 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-white/85 p-2 text-[#2d8f98]">
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {getRoleLabel(user.role)}
                </p>
                <p className="text-sm font-semibold text-slate-900">{user.full_name}</p>
                <p className="text-xs text-[#5b7f8a]">@{user.username}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0 overflow-x-hidden">
          <nav
            className="flex gap-3 overflow-x-auto pb-2"
            style={{ paddingLeft: `max(1rem, var(--sal))`, paddingRight: `max(1rem, var(--sar))` }}
          >
          {visibleNavItems.map((item) => (
            <SidebarLink
              key={item.to}
              item={item}
              mobile
              badgeCount={item.to === "/hcm-news" ? hcmUnreadCount : 0}
            />
          ))}
        </nav>
        </div>
      </div>

      {/* ─── Desktop: full sidebar ─── */}
      <aside className="hidden w-full min-w-0 border-r border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,#fbfefe_0%,#eef9f8_100%)] text-[#22485b] lg:flex lg:w-80 lg:shrink-0 lg:flex-col">
        <div className="flex flex-1 flex-col px-6 py-6">
          <div className="inline-flex w-fit rounded-[22px] border border-[rgba(65,200,198,0.2)] bg-white p-4 shadow-[0_12px_32px_rgba(34,72,91,0.08)]">
            <BrandMark
              maxWidth={190}
              logoClassName="drop-shadow-[0_6px_18px_rgba(34,72,91,0.05)]"
              size={42}
            />
          </div>

          <div className="mt-5 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-white/92 p-5 text-[#22485b] shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6e949b]">
                  Signed in
                </p>
                <p className="mt-2 text-lg font-semibold text-[#22485b]">{user.full_name}</p>
                <p className="mt-1 text-sm text-[#5b7f8a]">
                  {getRoleLabel(user.role)} - @{user.username}
                </p>
              </div>
              <button
                type="button"
                onClick={() => logout()}
                className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-[rgba(65,200,198,0.08)] px-3 py-2 text-sm font-semibold text-[#2d8f98] transition hover:bg-[rgba(65,200,198,0.14)]"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </div>
          </div>

          <div className="mt-6">
            <p className="px-4 text-xs font-semibold uppercase tracking-[0.3em] text-[#6e949b]">
              Navigation
            </p>
            <nav className="mt-3 space-y-2">
              {visibleNavItems.map((item) => (
                <SidebarLink
                  key={item.to}
                  item={item}
                  badgeCount={item.to === "/hcm-news" ? hcmUnreadCount : 0}
                />
              ))}
            </nav>
          </div>

        </div>
      </aside>
    </div>
  );
}

export default Sidebar;
