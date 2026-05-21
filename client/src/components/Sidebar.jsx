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
    to: "/doctor/assigned-patients?tab=under_review",
    label: "Long term review",
    icon: Activity,
    roles: ["doctor"],
    isActiveWhen: (location) => {
      if (location.pathname !== "/doctor/assigned-patients") return false;
      const params = new URLSearchParams(location.search);
      return params.get("tab") === "under_review" || params.get("filter") === "under_review";
    },
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

function SidebarLink({ item, mobile = false, drawer = false, drawerDeepTeal = false, badgeCount = 0 }) {
  const Icon = item.icon;
  const location = useLocation();

  return (
    <NavLink
      end={item.end}
      to={item.to}
      className={({ isActive: routerActive }) => {
        const isActive =
          typeof item.isActiveWhen === "function" ? item.isActiveWhen(location) : routerActive;

        if (drawerDeepTeal) {
          return cx(
            "group flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold tracking-wide transition-all duration-200",
            "text-white/90 hover:bg-white/5 hover:text-white",
            isActive && "bg-white/15 font-bold text-white shadow-sm",
          );
        }

        return cx(
          "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all",
          drawer && "min-h-12",
          mobile
            ? "min-w-fit border border-[rgba(65,200,198,0.16)] bg-white/80 text-slate-600 hover:bg-white"
            : drawer
              ? "text-[#4e7b83] hover:bg-[rgba(65,200,198,0.08)] hover:text-[#22485b]"
              : "text-[#4e7b83] hover:bg-white/70 hover:text-[#22485b]",
          isActive &&
            (mobile
              ? "border-[rgba(65,200,198,0.35)] bg-[#2d8f98] text-white shadow-lg shadow-[rgba(45,143,152,0.18)]"
              : drawer
                ? "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white shadow-lg shadow-[rgba(45,143,152,0.22)]"
                : "bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] text-white shadow-lg shadow-[rgba(45,143,152,0.22)]"),
        );
      }}
    >
      <Icon
        className={cx(
          "size-4 shrink-0",
          drawerDeepTeal ? "text-white/80" : mobile ? "text-current" : "text-[#66d7d0]",
        )}
      />
      <span>{item.label}</span>
      {badgeCount > 0 ? (
        <span
          className={cx(
            "ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-bold",
            drawerDeepTeal
              ? "bg-rose-500 text-white"
              : mobile
                ? "bg-white/90 text-[#2d8f98]"
                : "bg-rose-500 text-white",
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
            "absolute inset-y-0 left-0 flex h-full w-[280px] flex-col justify-between overflow-y-auto border-r border-[#445d5d]/40 bg-[#557373] text-white shadow-[5px_0_25px_rgba(0,0,0,0.15)] transition-transform duration-300",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
          style={{ paddingTop: `max(1rem, var(--sat))`, paddingBottom: `max(1rem, var(--sab))` }}
        >
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between px-5 py-3">
              <BrandMark maxWidth={150} size={36} />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="grid min-h-12 min-w-10 place-items-center rounded-xl text-white/80 transition hover:bg-white/10 hover:text-white active:scale-95"
                aria-label="Close menu"
              >
                <X className="size-5" strokeWidth={2.25} />
              </button>
            </div>

            <div className="mx-5 mb-6 rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/10 p-2 text-white">
                  <ShieldCheck className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#d1dede]">
                    {getRoleLabel(user.role)}
                  </p>
                  <p className="text-base font-bold tracking-wide text-white">{user.full_name}</p>
                  <p className="truncate text-xs text-[#d1dede]">
                    {user.email || `@${user.username}`}
                  </p>
                </div>
              </div>
            </div>

            <PushNotificationToggle alwaysShow role={user.role} variant="onDark" />

            {drawerNavItems.length > 0 ? (
              <div className="mt-2 px-3">
                <p className="px-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-[#d1dede]">
                  More
                </p>
                <nav className="mt-2 space-y-1">
                  {drawerNavItems.map((item) => (
                    <SidebarLink
                      key={item.to}
                      item={item}
                      drawer
                      drawerDeepTeal
                      badgeCount={item.to === "/hcm-news" ? hcmUnreadCount : 0}
                    />
                  ))}
                </nav>
              </div>
            ) : null}
          </div>

          <div className="mt-auto px-5 pb-4 pt-4">
            <button
              type="button"
              onClick={() => logout()}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-rose-500/20 hover:text-rose-200"
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
