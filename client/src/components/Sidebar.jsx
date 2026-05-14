import {
  BellRing,
  CalendarDays,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PieChart,
  RotateCw,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import BrandMark from "./BrandMark.jsx";
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

function SidebarLink({ item, mobile = false, drawer = false, badgeCount = 0 }) {
  const Icon = item.icon;

  return (
    <NavLink
      end={item.end}
      to={item.to}
      className={({ isActive }) =>
        cx(
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
        )
      }
    >
      <Icon className={cx("size-4", mobile ? "text-current" : "text-[#66d7d0]")} />
      <span>{item.label}</span>
      {badgeCount > 0 ? (
        <span
          className={cx(
            "ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-bold",
            mobile
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

  const drawerNavItems = useMemo(
    () => visibleNavItems.filter((item) => !bottomPaths.has(item.to)),
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
    <>
      {/* ─── Phone: slim top bar ─── */}
      <div
        className="sticky top-0 z-30 flex items-center justify-between border-b border-[rgba(65,200,198,0.14)] bg-white/92 px-4 py-2.5 backdrop-blur-lg md:hidden"
        style={{ paddingTop: `max(0.625rem, var(--sat))`, paddingLeft: `max(1rem, var(--sal))`, paddingRight: `max(1rem, var(--sar))` }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="grid min-h-12 min-w-10 place-items-center rounded-xl text-[#2d8f98] transition active:bg-[rgba(65,200,198,0.1)]"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <BrandMark maxWidth={140} size={34} />
        <div className="min-w-10" />
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
            "absolute inset-y-0 left-0 flex w-[280px] flex-col overflow-y-auto bg-[linear-gradient(180deg,#fbfefe_0%,#eef9f8_100%)] shadow-2xl transition-transform duration-300",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
          style={{ paddingTop: `max(1rem, var(--sat))`, paddingBottom: `max(1rem, var(--sab))` }}
        >
          <div className="flex items-center justify-between px-5 py-3">
            <BrandMark maxWidth={150} size={36} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="grid min-h-12 min-w-10 place-items-center rounded-xl text-slate-500 transition active:bg-slate-100"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="mx-5 mt-3 rounded-[22px] border border-sky-200 bg-sky-50 px-4 py-3">
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

          {drawerNavItems.length > 0 ? (
            <div className="mt-5 px-4">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-[#6e949b]">
                More
              </p>
              <nav className="mt-3 space-y-1.5">
                {drawerNavItems.map((item) => (
                  <SidebarLink
                    key={item.to}
                    item={item}
                    drawer
                    badgeCount={item.to === "/hcm-news" ? hcmUnreadCount : 0}
                  />
                ))}
              </nav>
            </div>
          ) : null}

          <div className="mt-auto px-5 pb-4 pt-6">
            <button
              type="button"
              onClick={() => logout()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.22)] bg-white/80 px-4 py-3 text-sm font-semibold text-[#2d8f98] transition hover:bg-white"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* ─── Tablet: horizontal scroll nav (existing mobile layout) ─── */}
      <div
        className="hidden border-b border-[rgba(65,200,198,0.14)] bg-white/88 px-4 py-4 backdrop-blur md:block lg:hidden"
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

        <nav className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2" style={{ paddingLeft: `max(1rem, var(--sal))`, paddingRight: `max(1rem, var(--sar))` }}>
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

      {/* ─── Desktop: full sidebar ─── */}
      <aside className="hidden w-80 shrink-0 border-r border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,#fbfefe_0%,#eef9f8_100%)] text-white lg:flex lg:flex-col">
        <div className="flex flex-1 flex-col px-6 py-8">
          <div className="relative overflow-hidden rounded-[38px] border border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,#a9b8bf_0%,#9aaab2_100%)] p-5 shadow-[0_32px_80px_rgba(34,72,91,0.16)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.38),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.12),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.08),rgba(26,56,68,0.08))]" />
            <div className="relative z-10 flex min-h-[370px] flex-col">
              <div className="inline-flex self-center rounded-[20px] bg-white px-4 py-3 shadow-[0_16px_40px_rgba(34,72,91,0.14)]">
                <BrandMark
                  maxWidth={190}
                  logoClassName="drop-shadow-[0_8px_24px_rgba(34,72,91,0.06)]"
                  size={42}
                />
              </div>

              <div className="mt-12 max-w-[15rem] space-y-5">
                <h1 className="font-display text-[2.05rem] leading-[1.02] tracking-tight text-[#f3c438]">
                  Every visit is a team effort.
                </h1>
                <p className="text-[1.05rem] font-semibold leading-8 text-white">
                  Our coordination is the key to our success and quality care.
                </p>
                <p className="text-[1.02rem] font-semibold leading-8 text-[#224f5a]">
                  Let&apos;s make every SOS Alert count today.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[30px] border border-[rgba(65,200,198,0.16)] bg-white/92 p-5 text-[#22485b] shadow-[0_18px_52px_rgba(34,72,91,0.08)]">
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

          <div className="mt-8">
            <p className="px-4 text-xs font-semibold uppercase tracking-[0.3em] text-[#6e949b]">
              Navigation
            </p>
            <nav className="mt-4 space-y-2">
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
    </>
  );
}

export default Sidebar;
