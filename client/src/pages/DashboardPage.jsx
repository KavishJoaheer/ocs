import { useEffect, useState } from "react";
import dayjs from "dayjs";
import {
  Activity,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  ClipboardList,
  CreditCard,
  DollarSign,
  Package,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  UserRound,
  UsersRound,
} from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import ClinicalTwinMetricsCards from "../components/ClinicalTwinMetricsCards.jsx";
import LowStockBanner from "../components/LowStockBanner.jsx";
import DoctorMobileLowStockStrip from "../components/DoctorMobileLowStockStrip.jsx";
import HcmBulletinBanner from "../components/HcmBulletinBanner.jsx";
import { isHcmPostWithinBulletinWindow } from "../lib/hcmBulletin.js";
import { useDoctorBagInventory } from "../hooks/useDoctorBagInventory.js";
import { prefetchPatientOfflineDirectory } from "../lib/patientOfflineSync.js";
import { useDoctorSupplyRequests } from "../hooks/useDoctorSupplyRequests.js";
import EmptyState from "../components/EmptyState.jsx";
import MetricNavAnchor from "../components/MetricNavAnchor.jsx";
import LoadingState from "../components/LoadingState.jsx";
import OperationStatusSelector from "../components/OperationStatusSelector.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useOperatorDashboardMetrics } from "../hooks/useOperatorDashboardMetrics.js";
import { resolveClinicalTwinCounts } from "../lib/clinicalTwinMetrics.js";
import { formatReviewAppointmentTime } from "../lib/patientReview.js";
import { api } from "../lib/api.js";
import {
  closePreviewTab,
  openInlinePreviewTab,
  presentFileBlob,
} from "../lib/fileBlobViewer.js";
import { formatCurrency, formatDateTime, truncate } from "../lib/format.js";
import { cx } from "../lib/utils.js";

function buildDoctorMobileDateLabel() {
  return dayjs().format("dddd, MMMM D");
}

function DoctorMobileSplitCard({ to, label, icon: Icon, showLowStockLed = false, count = null }) {
  return (
    <Link
      to={to}
      className="group relative flex min-h-[7.5rem] flex-col justify-between rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition active:scale-[0.99] active:bg-slate-50/80"
    >
      {showLowStockLed ? (
        <span
          className="absolute right-3 top-3 size-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
          aria-label="Low stock alert"
        />
      ) : null}
      <div className="flex size-10 items-center justify-center rounded-xl border border-ocs-teal/15 bg-ocs-teal/5 text-ocs-teal">
        <Icon className="size-5" strokeWidth={2.25} />
      </div>
      <div className="mt-3 min-w-0">
        <p className="text-[15px] font-bold leading-snug tracking-tight text-slate-800">{label}</p>
        {count != null ? (
          <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{count}</p>
        ) : null}
      </div>
      <ArrowUpRight className="absolute bottom-3.5 right-3.5 size-4 text-ocs-teal/60" strokeWidth={2} />
    </Link>
  );
}

function DoctorMobileSupplyRequestsCard({ pendingCount = 0 }) {
  return (
    <Link
      to="/supply-requests"
      className="relative flex min-h-[110px] cursor-pointer flex-col justify-between rounded-2xl border border-slate-100 bg-white p-4 shadow-sm transition-all active:scale-[0.98] active:bg-slate-50/80"
    >
      <div className="flex items-start justify-between">
        <span className="text-xl" aria-hidden="true">
          📋
        </span>
        {pendingCount > 0 ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">
            {pendingCount} Pending
          </span>
        ) : null}
      </div>
      <div className="mt-4">
        <p className="text-sm font-bold text-slate-800">Supply Requests</p>
        <p className="text-[11px] font-semibold text-ocs-grey">Track, edit or cancel orders</p>
      </div>
    </Link>
  );
}

function DoctorMobileLauncher({ user, dashboard = null, latestHcmPost = null }) {
  const firstName = (user.full_name || "").split(" ")[0] || "Doctor";
  const { hasLowStockAlert, lowStockCount, loading } = useDoctorBagInventory();
  const showLowStockStrip = !loading && lowStockCount > 0;
  const { pendingCount: supplyPendingCount } = useDoctorSupplyRequests();
  const reviewCount = resolveClinicalTwinCounts("doctor", { dashboard }).longTermReviewCount;

  useEffect(() => {
    if (user?.role === "doctor" && user?.id) {
      void prefetchPatientOfflineDirectory(user.id);
    }
  }, [user?.id, user?.role]);

  return (
    <div className="mobile-dashboard-wrapper mx-auto w-full max-w-md min-w-0 px-1 py-4">
      <header className="shrink-0 pb-2">
        <h1 className="text-2xl font-bold tracking-tight text-ocs-slate">Hello, Dr. {firstName}</h1>
        <p className="mt-2 text-base text-ocs-grey">{buildDoctorMobileDateLabel()}</p>
      </header>

      {latestHcmPost ? <HcmBulletinBanner post={latestHcmPost} /> : null}

      {showLowStockStrip ? <DoctorMobileLowStockStrip lowStockCount={lowStockCount} /> : null}

      <nav className="doctor-mobile-action-grid flex flex-col gap-4" aria-label="Doctor quick actions">
        <div className="grid grid-cols-2 gap-4">
          <DoctorMobileSplitCard to="/visit-requests" label="Visit requests" icon={ClipboardList} />
          <DoctorMobileSplitCard
            to="/doctor/long-term-review"
            label="Review appointment"
            icon={Activity}
            count={reviewCount}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DoctorMobileSplitCard to="/patients" label="Patient Directory" icon={UserRound} />
          <DoctorMobileSplitCard
            to="/inventory"
            label="Inventory"
            icon={Package}
            showLowStockLed={hasLowStockAlert}
          />
        </div>

        <DoctorMobileSupplyRequestsCard pendingCount={supplyPendingCount} />

        <Link
          to="/patients/add"
          className="group flex w-full items-center gap-4 rounded-2xl border border-ocs-teal/20 bg-gradient-to-br from-ocs-teal to-[#22a8a1] px-4 py-3.5 text-left text-white shadow-sm transition active:scale-[0.99] active:opacity-95"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-white">
            <UserPlus className="size-5" strokeWidth={2.25} />
          </div>
          <p className="min-w-0 flex-1 text-[15px] font-bold tracking-tight text-white">Add Patient</p>
          <ArrowUpRight className="size-4 shrink-0 text-white/80" strokeWidth={2} />
        </Link>
      </nav>
    </div>
  );
}

function getOperatorBoardCounts(metrics) {
  return {
    visitRequests: Number(metrics?.visit_requests?.active_count ?? 0),
    unassignedRequests: Number(metrics?.visit_requests?.unassigned_count ?? 0),
    reviews: Number(metrics?.long_term_review?.active_followup_count ?? 0),
    unpaidThisWeek: Number(metrics?.pending_payment?.unpaid_this_week_count ?? 0),
    visitsThisWeek: Number(metrics?.scheduled_visits?.this_week ?? 0),
    healthPlans: Number(metrics?.health_plans?.active_subscribers_count ?? 0),
    doctorsThisWeek: Number(metrics?.coverage?.doctors_this_week ?? 0),
    onCall: Number(metrics?.coverage?.on_call_count ?? 0),
  };
}

function OperatorMobileLauncher({
  user,
  dashboard,
  operatorMetrics,
  latestHcmPost = null,
}) {
  const firstName = (user.full_name || "").split(" ")[0] || "there";
  const counts = getOperatorBoardCounts(operatorMetrics);
  const ocsLowStock = dashboard?.ocs_low_stock_alert;
  const ocsLowCount = Number(ocsLowStock?.total_items || 0);
  const monthLabel = dayjs().format("MMMM");

  const listCards = [
    {
      label: "This week's coverage",
      description:
        counts.doctorsThisWeek === 1
          ? "1 doctor on this week"
          : `${counts.doctorsThisWeek} doctors on this week`,
      icon: CalendarClock,
      to: "/operator/current-week-roster",
    },
    {
      label: `${monthLabel} roster`,
      description: "Open the full monthly doctor schedule.",
      icon: ClipboardList,
      to: "/operator/monthly-roster",
    },
    {
      label: "Patient Directory",
      description: "Search and open existing patient records.",
      icon: UsersRound,
      to: "/patients",
    },
    {
      label: "Add a Patient",
      description: "Register a new patient into the OCS system.",
      icon: UserPlus,
      to: "/patients/add",
    },
    {
      label: "Inventory",
      description: ocsLowStock?.triggered
        ? `${ocsLowCount} below min`
        : "Warehouse stock is at or above min.",
      icon: Package,
      to: "/inventory",
    },
  ];

  return (
    <div className="flex min-h-[60svh] w-full min-w-0 flex-col">
      <h1 className="text-[1.6rem] font-bold tracking-tight text-ocs-slate">
        Hello, {firstName}
      </h1>
      <p className="mt-1 text-sm text-ocs-grey">{buildDoctorMobileDateLabel()}</p>

      {latestHcmPost ? (
        <div className="mt-4">
          <HcmBulletinBanner post={latestHcmPost} />
        </div>
      ) : null}

      {ocsLowStock?.triggered ? (
        <div className="mt-4">
          <LowStockBanner alert={ocsLowStock} compact variant="ocs" />
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-4">
        <DoctorMobileSplitCard
          to="/visit-requests"
          label="Visit requests"
          icon={ClipboardList}
          count={counts.visitRequests}
        />
        <DoctorMobileSplitCard
          to="/operator/long-term-review"
          label="Reviews due"
          icon={Activity}
          count={counts.reviews}
        />
        <DoctorMobileSplitCard
          to="/operator/scheduled-visits"
          label="Visits this week"
          icon={CalendarClock}
          count={counts.visitsThisWeek}
        />
      </div>

      <div className="mt-6 flex flex-1 flex-col gap-3.5 overflow-y-auto">
        {listCards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              to={card.to}
              className="group flex w-full items-center gap-5 rounded-[24px] border border-slate-100 bg-white px-5 py-6 shadow-sm transition duration-150 active:scale-[0.97] active:bg-slate-50/80"
            >
              <div className="flex size-13 shrink-0 items-center justify-center rounded-2xl border border-ocs-teal/15 bg-ocs-teal/5 text-ocs-teal shadow-sm">
                <Icon className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[1.05rem] font-bold tracking-tight text-slate-800">
                  {card.label}
                </p>
                <p className="mt-0.5 text-sm leading-6 text-ocs-grey">{card.description}</p>
              </div>
              <ArrowUpRight className="size-5 shrink-0 text-ocs-teal/60 transition group-active:translate-x-0.5 group-active:-translate-y-0.5" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function MobileLauncher({
  user,
  dashboard,
  operatorMetrics,
  latestHcmPost = null,
}) {
  const firstName = (user.full_name || "").split(" ")[0] || "Doctor";
  const isDoctor = user.role === "doctor";

  if (isDoctor) {
    return (
      <DoctorMobileLauncher user={user} dashboard={dashboard} latestHcmPost={latestHcmPost} />
    );
  }

  if (user.role === "operator") {
    return (
      <OperatorMobileLauncher
        user={user}
        dashboard={dashboard}
        operatorMetrics={operatorMetrics}
        latestHcmPost={latestHcmPost}
      />
    );
  }

  const showClinicalTwin = user.role === "admin";
  const clinicalCounts = showClinicalTwin
    ? resolveClinicalTwinCounts(user.role, { dashboard, operatorMetrics })
    : null;

  const greeting = `Hello, ${firstName}`;

  const cards = [];

  if (user.role === "admin") {
    cards.push({
      label: "Visit requests",
      icon: ClipboardList,
      to: "/visit-requests",
      description: "Assign doctors and track home visits in progress.",
    });
  }

  if (["admin", "doctor"].includes(user.role)) {
    cards.push({
      label: "Patient Directory",
      icon: UsersRound,
      to: "/patients",
      description: "Search and open existing patient records.",
    });
  }

  if (["admin", "doctor"].includes(user.role)) {
    cards.push({
      label: "Add a Patient",
      icon: UserPlus,
      to: "/patients/add",
      description: "Register a new patient into the OCS system.",
    });
  }

  if (["admin", "doctor", "accountant"].includes(user.role)) {
    cards.push({
      label: "Billing",
      icon: CreditCard,
      to: "/billing",
      description: "Open bills, payments, and consultation finance.",
    });
  }

  if (["admin", "doctor"].includes(user.role)) {
    const ocsLowStock = dashboard?.ocs_low_stock_alert;
    const ocsLowCount = Number(ocsLowStock?.total_items || 0);

    cards.push({
      label: "Inventory",
      icon: Package,
      to: "/inventory",
      description:
        user.role === "admin" && ocsLowStock?.triggered
          ? `${ocsLowCount} item${ocsLowCount === 1 ? "" : "s"} at or below par level`
          : "Check supplies and restock your medical kit.",
    });
  }

  if (user.role === "lab_tech") {
    cards.push(
      { label: "Lab Queue", icon: ClipboardList, to: "/lab", description: "Open the active lab workspace and blood test queue." },
      { label: "Patient Directory", icon: UsersRound, to: "/patients", description: "Search and open existing patient records." },
      { label: "Consultations", icon: Stethoscope, to: "/consultations", description: "Review consultation notes linked to lab work." },
    );
  }

  return (
    <div className="flex min-h-[60svh] w-full min-w-0 flex-col">
      <h1 className="text-[1.6rem] font-bold tracking-tight text-ocs-slate">
        {greeting}
      </h1>
      <p className="mt-1 text-sm text-ocs-grey">What would you like to do?</p>

      {user.role === "admin" ? (
        <div className="mt-4">
          <LowStockBanner alert={dashboard?.ocs_low_stock_alert} variant="ocs" />
        </div>
      ) : null}

      {clinicalCounts ? (
        <ClinicalTwinMetricsCards
          role={user.role}
          longTermReviewCount={clinicalCounts.longTermReviewCount}
          healthPlansCount={clinicalCounts.healthPlansCount}
          showHealthPlans={user.role !== "admin"}
          className="mt-5"
        />
      ) : null}

      <div className="mt-6 flex flex-1 flex-col gap-3.5 overflow-y-auto">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              to={card.to}
              className="group flex w-full items-center gap-5 rounded-[24px] border border-slate-100 bg-white px-5 py-6 shadow-sm transition duration-150 active:scale-[0.97] active:bg-slate-50/80"
            >
              <div className="flex size-13 shrink-0 items-center justify-center rounded-2xl border border-ocs-teal/15 bg-ocs-teal/5 text-ocs-teal shadow-sm">
                <Icon className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[1.05rem] font-bold tracking-tight text-slate-800">
                  {card.label}
                </p>
                <p className="mt-0.5 text-sm leading-6 text-ocs-grey">
                  {card.description}
                </p>
              </div>
              <ArrowUpRight className="size-5 shrink-0 text-ocs-teal/60 transition group-active:translate-x-0.5 group-active:-translate-y-0.5" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="max-w-full min-w-0 rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-white/88 p-5 shadow-[0_24px_64px_rgba(34,72,91,0.08)]">
      <div className="flex min-h-[5.5rem] flex-col justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
        <div className="mt-3 min-w-0 max-w-full overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <p className="inline-block text-2xl font-bold tabular-nums tracking-tight text-slate-950 no-underline whitespace-nowrap md:text-3xl">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function DoctorDashboardTile({
  to,
  onClick,
  title,
  subtitle,
  eyebrow,
  icon: Icon,
  dark = false,
  size = "regular",
  flat = false,
  spacious = false,
  locked = false,
}) {
  const sizeClasses =
    size === "hero"
      ? spacious
        ? "min-h-[132px] px-8 py-7 md:px-10 md:py-8"
        : "min-h-[124px] px-6 py-6 md:px-7 md:py-7"
      : size === "compact"
        ? "min-h-[88px] px-5 py-4 md:px-6"
        : "min-h-[100px] px-5 py-5 md:px-6";

  const classes = cx(
    "group flex w-full rounded-[30px] border transition duration-200",
    sizeClasses,
    locked && "cursor-not-allowed opacity-50",
    !locked && (to || onClick) && "cursor-pointer",
    flat
      ? dark
        ? "border-white/25 bg-ocs-teal text-white hover:border-white/35"
        : size === "hero"
          ? "border-gray-100 bg-white text-ocs-slate shadow-sm hover:shadow-md"
          : "border-gray-200 bg-white text-ocs-slate hover:border-gray-300"
      : dark
        ? "border-ocs-teal/20 bg-ocs-teal text-white shadow-sm hover:bg-ocs-teal/90"
        : locked
          ? "border-[rgba(65,200,198,0.18)] bg-white text-ocs-slate shadow-sm"
          : size === "hero"
            ? "border-gray-100 bg-white text-ocs-slate shadow-sm hover:shadow-md"
            : "border-[rgba(65,200,198,0.18)] bg-white text-ocs-slate shadow-sm hover:border-ocs-teal/30",
  );

  const content = (
    <div className={cx("flex w-full items-center gap-4 md:gap-6", spacious && "justify-between")}>
      {Icon ? (
        <div
          className={cx(
            "flex size-12 shrink-0 items-center justify-center rounded-2xl border md:size-14",
            dark
              ? "border-white/16 bg-white/12 text-white"
              : size === "hero" && !dark
                ? "border-slate-200 bg-ocs-teal/10 text-ocs-teal"
                : "border-slate-200 bg-white text-ocs-teal",
          )}
        >
          <Icon className="size-5 md:size-6" />
        </div>
      ) : null}

      <div className="min-w-0 flex-1 text-left leading-tight">
        {eyebrow ? (
          <p
            className={cx(
              "text-xs font-semibold uppercase tracking-wider",
              dark ? "text-white/50" : size === "hero" ? "text-ocs-grey" : "text-ocs-grey",
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <p
          className={cx(
            "break-words text-base font-medium tracking-tight",
            eyebrow ? (size === "hero" ? "mt-2" : "mt-1") : size === "hero" ? "mt-2" : "mt-1",
            dark ? "text-white" : size === "hero" ? "text-ocs-slate" : "text-ocs-slate",
          )}
        >
          {title}
        </p>
        {locked ? (
          <p className="mt-2 text-sm font-medium text-slate-500">Feature Inactive</p>
        ) : subtitle ? (
          <p
            className={cx(
              "mt-2 break-words text-sm leading-6",
              dark ? "line-clamp-3 text-white/90" : size === "hero" ? "text-ocs-grey" : "text-ocs-grey",
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      {!locked ? (
        <div
          className={cx(
            "hidden rounded-full px-3 py-1 text-xs font-semibold md:inline-flex md:items-center md:gap-1.5",
            flat && !dark && "border border-gray-200 bg-slate-50",
            dark
              ? "bg-white/12 text-white/90"
              : "bg-[rgba(45,143,152,0.08)] text-[#2d8f98]",
          )}
        >
          Open
          <ArrowUpRight className="size-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
      ) : null}
    </div>
  );

  if (locked) {
    return (
      <div aria-disabled="true" className={classes}>
        {content}
      </div>
    );
  }

  if (to) {
    return (
      <Link className={classes} to={to}>
        {content}
      </Link>
    );
  }

  return (
    <button className={classes} onClick={onClick} type="button">
      {content}
    </button>
  );
}

function OperationsDashboardDesktopHeader({ title, subtitle, roleBadge, statusMarkup, beforeStatus }) {
  return (
    <div className="mb-2 hidden items-start justify-between gap-4 border-b border-[rgba(65,200,198,0.14)] pb-3 md:flex">
      <div className="min-w-0 flex-1 pr-4">
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-ocs-slate md:text-[2.125rem] md:leading-snug">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 shrink-0 flex-col items-end gap-2">
        {roleBadge ? (
          <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[rgba(65,200,198,0.18)] bg-white/78 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#2d8f98]">
            <ShieldCheck className="size-3.5 shrink-0" />
            <span className="truncate">{roleBadge}</span>
          </div>
        ) : null}
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2 rounded-2xl border border-[rgba(65,200,198,0.2)] bg-white/92 px-3 py-1.5 sm:gap-2.5 sm:px-3.5">
          {beforeStatus}
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Live status
          </span>
          <div className="min-w-0">{statusMarkup}</div>
        </div>
      </div>
    </div>
  );
}

function RoleDashboardStudio({
  roleBadge,
  title = "Operations Dashboard",
  statusMarkup,
  leftEyebrow,
  leftTitle,
  leftItems,
  promoItem,
  rightEyebrow,
  rightTitle,
  rightItems,
}) {
  return (
    <section className="relative mx-auto w-full min-w-0 max-w-[1180px] overflow-x-hidden overflow-y-hidden rounded-3xl border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(65,200,198,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(241,188,53,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(231,247,246,0.94)_100%)] p-3 shadow-[0_36px_100px_rgba(34,72,91,0.14)] md:rounded-[56px] md:p-5 lg:p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_14%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.52),transparent_20%),radial-gradient(circle_at_28%_82%,rgba(65,200,198,0.08),transparent_18%)]" />

      <div className="relative z-10">
        <OperationsDashboardDesktopHeader
          roleBadge={roleBadge}
          statusMarkup={statusMarkup}
          title={title}
        />

        <div className="mt-0 rounded-[24px] border border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(240,251,250,0.9))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.56)] md:mt-1 md:rounded-[42px] md:p-5">
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <div className="rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-white/74 p-5 shadow-[0_16px_34px_rgba(34,72,91,0.06)] md:p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {leftEyebrow}
                </p>
                <p className="mt-2 text-lg font-semibold tracking-tight text-ocs-slate md:text-xl">
                  {leftTitle}
                </p>

                <div className="mt-4 space-y-4">
                  {leftItems.map((item) => (
                    <DoctorDashboardTile key={item.title} {...item} />
                  ))}
                </div>
              </div>

              {promoItem ? <DoctorDashboardTile {...promoItem} dark /> : null}
            </div>

            <div className="rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-white/74 p-5 shadow-[0_16px_34px_rgba(34,72,91,0.06)] md:p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {rightEyebrow}
              </p>
              <p className="mt-2 text-lg font-semibold tracking-tight text-ocs-slate md:text-xl">
                {rightTitle}
              </p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {rightItems.map((item) => (
                  <DoctorDashboardTile key={item.title} {...item} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardSupportSections({ dashboard, upcomingTitle = "Upcoming appointments" }) {
  return (
    <>
      <DashboardSummaryCards dashboard={dashboard} />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div id="dashboard-upcoming">
          <UpcomingAppointmentsPanel dashboard={dashboard} upcomingTitle={upcomingTitle} />
        </div>

        <div id="dashboard-activity">
          <RecentActivityPanel dashboard={dashboard} />
        </div>
      </div>
    </>
  );
}

function DashboardSummaryCards({ dashboard }) {
  const showRevenue = dashboard.summary.totalRevenue != null;

  return (
    <div
      className={cx(
        "grid min-w-0 gap-4 md:grid-cols-2",
        showRevenue ? "xl:grid-cols-4" : "xl:grid-cols-3",
      )}
    >
      <SummaryCard label="Total patients" value={dashboard.summary.totalPatients} />
      <SummaryCard label="Today's appointments" value={dashboard.summary.todaysAppointments} />
      <SummaryCard label="Pending bills" value={dashboard.summary.pendingBills} />
      {showRevenue ? (
        <SummaryCard label="Total revenue" value={formatCurrency(dashboard.summary.totalRevenue)} />
      ) : null}
    </div>
  );
}

function UpcomingAppointmentsPanel({
  dashboard,
  upcomingTitle = "Upcoming appointments",
  subtitle = "The next seven days of scheduled home visits.",
  titleClassName,
}) {
  const upcomingAppointments = (dashboard.upcomingAppointments || []).filter(
    (appointment) => String(appointment.status || "").toLowerCase() !== "completed",
  );

  return (
    <SectionCard title={upcomingTitle} subtitle={subtitle || undefined} titleClassName={titleClassName}>
      {upcomingAppointments.length ? (
        <div className="space-y-4">
          {upcomingAppointments.map((appointment) => (
            <div
              key={appointment.id}
              className="flex flex-col gap-3 rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-4 lg:flex-row lg:items-center lg:justify-between"
            >
              <div>
                <p className="text-lg font-semibold text-slate-950">
                  {appointment.patient_name}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  with {appointment.doctor_name} - {appointment.specialization}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-medium text-slate-700">
                  {formatDateTime(
                    appointment.appointment_date,
                    appointment.appointment_time,
                  )}
                </p>
                <StatusBadge value={appointment.status} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No appointments in the next week"
          description="Once appointments are created, they will appear here with patient and doctor details."
        />
      )}
    </SectionCard>
  );
}

function RecentActivityPanel({ dashboard }) {
  return (
    <SectionCard
      title="Recent activity"
      subtitle="A quick feed of scheduling, consultation, and billing events."
    >
      {dashboard.recentActivity.length ? (
        <div className="space-y-4">
          {dashboard.recentActivity.map((activity, index) => (
            <div key={`${activity.type}-${index}`} className="flex gap-4">
              <div className="mt-1 h-3 w-3 shrink-0 rounded-full bg-sky-500" />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <p className="font-semibold text-slate-950">{activity.title}</p>
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {activity.type}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {activity.patient_name}
                  {activity.doctor_name ? ` - ${activity.doctor_name}` : ""}
                </p>
                <p className="mt-2 text-sm text-slate-500">{truncate(activity.detail, 96)}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No recent updates"
          description="Activity will appear here as appointments, consultations, and payments are recorded."
        />
      )}
    </SectionCard>
  );
}

function getDoctorVisitsToday(dashboard) {
  const today = dashboard?.doctorWorkspace?.periods?.today || dashboard?.periods?.today || "";
  const visits = dashboard?.doctorWorkspace?.scheduledVisits || dashboard?.scheduledVisits || [];

  return visits.filter((visit) => visit.appointment_date === today && visit.status === "scheduled");
}

function countDoctorScheduledVisitsToday(dashboard) {
  return getDoctorVisitsToday(dashboard).length;
}

const doctorMetricVariants = {
  scheduled: {
    card: "border-gray-100 bg-white shadow-sm hover:shadow-md",
    label: "text-slate-600",
    value: "text-ocs-teal",
    anchorTheme: "doctor-primary",
  },
  assigned: {
    card: "border border-[#e6ebd9] bg-[#f4f6f0] hover:bg-[#ebefe2]",
    label: "text-[#8fa382]",
    value: "text-[#3b4733]",
    anchorTheme: "doctor-olive",
  },
  longTerm: {
    card: "border border-[#f5e3d7] border-l-4 border-l-[#d9744b] bg-[#fcf3ee] hover:bg-[#f7e6db]",
    label: "text-[#ba5a32]",
    value: "text-[#6e2f14]",
    anchorTheme: "doctor-terracotta",
  },
};

function DoctorMetricCard({ to, label, value, variant }) {
  const styles = doctorMetricVariants[variant];

  return (
    <Link
      to={to}
      className={cx(
        "group relative flex cursor-pointer flex-col rounded-2xl p-6 transition-all duration-300 ease-in-out",
        styles.card,
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cx("text-xs font-bold uppercase tracking-widest", styles.label)}>{label}</span>
        <MetricNavAnchor theme={styles.anchorTheme} />
      </div>
      <p className={cx("mt-4 text-4xl font-black tabular-nums", styles.value)}>{value}</p>
    </Link>
  );
}

function DoctorMetricsRow({ dashboard }) {
  const visitsToday = countDoctorScheduledVisitsToday(dashboard);
  const longTermCount = resolveClinicalTwinCounts("doctor", { dashboard }).longTermReviewCount;
  const assignedCount = Number(
    dashboard?.doctorWorkspace?.summary?.activeAssignedPatientsCount ??
      dashboard?.doctorWorkspace?.assignedPatients?.filter((patient) => patient.status === "active")
        .length ??
      0,
  );

  return (
    <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
      <DoctorMetricCard
        to="/appointments"
        label="Visits today"
        value={visitsToday}
        variant="scheduled"
      />
      <DoctorMetricCard
        to="/patients?filter=my_assigned"
        label="Assigned Patients"
        value={assignedCount}
        variant="assigned"
      />
      <DoctorMetricCard
        to="/doctor/long-term-review"
        label="Reviews due"
        value={longTermCount}
        variant="longTerm"
      />
    </div>
  );
}

function DoctorDashboardTwinPanels({
  monthLabel,
  onOpenRosterPdf,
  lowStockAlert,
  visitsToday = [],
}) {
  const lowStockCount = Number(lowStockAlert?.total_items || 0);

  return (
    <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-5">
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-3">
        <div className="flex items-center justify-between gap-3 border-b border-gray-50 pb-3">
          <span className="text-sm font-semibold text-slate-800">Today’s visits</span>
          <button
            type="button"
            onClick={onOpenRosterPdf}
            className="text-xs font-semibold text-slate-500 transition hover:text-ocs-slate"
          >
            {monthLabel} roster
          </button>
        </div>
        {visitsToday.length ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {visitsToday.map((visit) => {
              const timeLabel =
                formatReviewAppointmentTime(visit.appointment_time) ||
                String(visit.appointment_time || "").slice(0, 5);
              const place = String(visit.location || "").trim();

              return (
                <li key={visit.id}>
                  <Link
                    to={`/patients/${visit.patient_id}`}
                    className="flex items-start justify-between gap-3 py-3 transition hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{timeLabel}</p>
                      <p className="mt-0.5 text-sm font-semibold leading-snug text-slate-800">
                        {visit.patient_name}
                      </p>
                      {place ? (
                        <p className="mt-0.5 truncate text-xs text-slate-500">{place}</p>
                      ) : null}
                    </div>
                    <span className="shrink-0 pt-0.5 text-xs font-semibold text-ocs-teal">Open</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-slate-500">No visits booked today.</p>
            <Link to="/appointments" className="text-xs font-semibold text-ocs-teal">
              Appointments
            </Link>
          </div>
        )}
      </div>

      {lowStockAlert?.triggered ? (
        <Link
          to="/inventory?context=my&restock=alert"
          className="flex min-h-[160px] flex-col justify-between rounded-2xl border border-gray-100 border-l-4 border-l-ocs-yellow bg-white p-6 shadow-sm transition-colors hover:shadow-md lg:col-span-2"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-600">Bag stock</span>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
              {lowStockCount} at or below par
            </span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="min-w-0 text-xs font-semibold leading-normal text-slate-700">
              {lowStockCount} item{lowStockCount === 1 ? "" : "s"} are currently low in your bag.
              Open inventory to restock.
            </p>
            <span className="shrink-0 text-xs font-semibold text-ocs-yellow-dark">Restock</span>
          </div>
        </Link>
      ) : (
        <div className="flex min-h-[160px] flex-col justify-between rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-50 pb-3">
            <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Bag stock</span>
            <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          </div>
          <p className="mt-4 text-xs font-medium leading-normal text-gray-400">
            All kit items at or above par level. No replenishment required.
          </p>
        </div>
      )}
    </div>
  );
}

function DoctorDashboardView({
  user,
  dashboard,
  onStatusChange,
  isSavingStatus,
  onOpenRosterPdf,
  lowStockAlert,
  latestHcmPost = null,
}) {
  const monthLabel = dayjs().format("MMMM");

  return (
    <section className="relative mx-auto w-full min-w-0 max-w-6xl overflow-x-hidden overflow-y-hidden rounded-3xl border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(65,200,198,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(241,188,53,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(231,247,246,0.94)_100%)] p-3 shadow-[0_36px_100px_rgba(34,72,91,0.14)] md:rounded-[56px] md:p-5 lg:p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_14%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.52),transparent_20%),radial-gradient(circle_at_28%_82%,rgba(65,200,198,0.08),transparent_18%)]" />

      <div className="relative z-10 space-y-6">
        <OperationsDashboardDesktopHeader
          statusMarkup={
            <OperationStatusSelector
              align="right"
              className="mt-0"
              disabled={isSavingStatus}
              onChange={onStatusChange}
              value={user.operation_status}
            />
          }
          subtitle={dayjs().format("dddd D MMMM")}
          title="Today"
        />

        {latestHcmPost ? <HcmBulletinBanner post={latestHcmPost} /> : null}

        <DoctorMetricsRow dashboard={dashboard} />

        <DoctorDashboardTwinPanels
          lowStockAlert={lowStockAlert}
          monthLabel={monthLabel}
          onOpenRosterPdf={onOpenRosterPdf}
          visitsToday={getDoctorVisitsToday(dashboard)}
        />
      </div>
    </section>
  );
}

const operatorMetricVariants = {
  requests: {
    card: "border border-gray-100 bg-white shadow-sm hover:shadow-md",
    label: "text-slate-600",
    value: "text-ocs-teal",
    anchorTheme: "doctor-primary",
  },
  reviews: {
    card: "border border-[#f5e3d7] border-l-4 border-l-[#d9744b] bg-[#fcf3ee] hover:bg-[#f7e6db]",
    label: "text-[#ba5a32]",
    value: "text-[#6e2f14]",
    anchorTheme: "doctor-terracotta",
  },
  unpaid: {
    card: "border border-rose-100 bg-rose-50/70 hover:bg-rose-50",
    label: "text-rose-500",
    value: "text-slate-900",
  },
  visits: {
    card: "border border-gray-100 bg-white shadow-sm hover:shadow-md",
    label: "text-slate-600",
    value: "text-ocs-teal",
    anchorTheme: "doctor-primary",
  },
};

function OperatorMetricCard({ to, label, value, variant }) {
  const styles = operatorMetricVariants[variant];

  return (
    <Link
      to={to}
      className={cx(
        "group relative flex cursor-pointer flex-col rounded-2xl p-6 transition-all duration-300 ease-in-out",
        styles.card,
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cx("text-xs font-bold uppercase tracking-widest", styles.label)}>{label}</span>
        {styles.anchorTheme ? <MetricNavAnchor theme={styles.anchorTheme} /> : null}
      </div>
      <p className={cx("mt-4 text-4xl font-black tabular-nums", styles.value)}>{value}</p>
    </Link>
  );
}

function OperatorMetricsRow({ counts }) {
  return (
    <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <OperatorMetricCard
        to="/visit-requests"
        label="Visit requests"
        value={counts.visitRequests}
        variant="requests"
      />
      <OperatorMetricCard
        to="/operator/long-term-review"
        label="Reviews due"
        value={counts.reviews}
        variant="reviews"
      />
      <OperatorMetricCard
        to="/operator/scheduled-visits"
        label="Visits this week"
        value={counts.visitsThisWeek}
        variant="visits"
      />
    </div>
  );
}

function OperatorTodayStrip({ metrics }) {
  const unassigned = Array.isArray(metrics?.visit_requests?.unassigned)
    ? metrics.visit_requests.unassigned
    : [];
  const upcoming = Array.isArray(metrics?.upcoming_visits) ? metrics.upcoming_visits : [];
  const unassignedCount = Number(metrics?.visit_requests?.unassigned_count ?? unassigned.length);

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-3">
      <div className="flex items-center justify-between gap-3 border-b border-gray-50 pb-3">
        <span className="text-sm font-semibold text-slate-800">Today</span>
        <Link to="/visit-requests" className="text-xs font-semibold text-slate-500 transition hover:text-ocs-slate">
          Visit requests
        </Link>
      </div>

      {unassigned.length ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {unassigned.map((request) => (
            <li key={`request-${request.id}`}>
              <Link
                to="/visit-requests"
                className="flex items-start justify-between gap-3 py-3 transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug text-slate-800">
                    {request.patient_name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {request.urgency === "emergency"
                      ? "Emergency · unassigned"
                      : request.urgency === "urgent"
                        ? "Urgent · unassigned"
                        : "Unassigned visit request"}
                  </p>
                </div>
                <span className="shrink-0 pt-0.5 text-xs font-semibold text-ocs-teal">Assign</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {unassignedCount === 0
              ? "No unassigned visit requests."
              : "No unassigned visit requests in this list."}
          </p>
          <Link to="/visit-requests" className="text-xs font-semibold text-ocs-teal">
            Board
          </Link>
        </div>
      )}

      <div className="mt-5 border-t border-gray-50 pt-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-slate-800">Next visits</span>
          <Link
            to="/operator/scheduled-visits"
            className="text-xs font-semibold text-slate-500 transition hover:text-ocs-slate"
          >
            Schedule
          </Link>
        </div>
        {upcoming.length ? (
          <ul className="mt-2 divide-y divide-slate-100">
            {upcoming.map((visit) => {
              const timeLabel =
                formatReviewAppointmentTime(visit.appointment_time) ||
                String(visit.appointment_time || "").slice(0, 5);
              const dateLabel = visit.appointment_date
                ? dayjs(visit.appointment_date).format("ddd D MMM")
                : "";

              return (
                <li key={`visit-${visit.id}`}>
                  <Link
                    to={visit.patient_id ? `/patients/${visit.patient_id}` : "/operator/scheduled-visits"}
                    className="flex items-start justify-between gap-3 py-3 transition hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">
                        {dateLabel}
                        {timeLabel ? ` · ${timeLabel}` : ""}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold leading-snug text-slate-800">
                        {visit.patient_name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {visit.doctor_name}
                        {visit.location ? ` · ${visit.location}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 pt-0.5 text-xs font-semibold text-ocs-teal">Open</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No upcoming scheduled visits.</p>
        )}
      </div>
    </div>
  );
}

function OperatorToolsColumn({
  counts,
  monthLabel,
  lowStockAlert,
  rosterMeta,
  onOpenRosterPdf,
  hcmUnreadCount = 0,
}) {
  const coverageLabel =
    counts.doctorsThisWeek === 1
      ? "1 doctor on this week"
      : `${counts.doctorsThisWeek} doctors on this week`;
  const onCallLabel =
    counts.onCall === 1 ? "1 on call" : `${counts.onCall} on call`;

  return (
    <div className="flex flex-col gap-4 lg:col-span-2">
      <Link
        to="/operator/current-week-roster"
        className="flex min-h-[132px] flex-col justify-between rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-colors hover:shadow-md"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-600">
            Doctor shifts
          </span>
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
            {onCallLabel}
          </span>
        </div>
        <p className="mt-4 text-sm font-semibold leading-normal text-slate-800">{coverageLabel}</p>
      </Link>

      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-slate-800">Follow-up</p>
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800">{monthLabel} roster</p>
              <Link
                to="/operator/monthly-roster"
                className="text-xs font-semibold text-slate-400 hover:text-ocs-slate"
              >
                Open roster
              </Link>
            </div>
            <button
              type="button"
              onClick={onOpenRosterPdf}
              disabled={!rosterMeta?.has_roster}
              className="shrink-0 rounded-xl bg-ocs-teal px-3 py-2 text-xs font-semibold text-white transition hover:bg-ocs-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download PDF
            </button>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="text-sm font-medium text-slate-800">Health plans</p>
            <Link
              to="/patients?filter=subscribed"
              className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
            >
              {counts.healthPlans} subscribed
            </Link>
          </div>
          {lowStockAlert?.triggered ? null : (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <p className="text-sm font-medium text-slate-800">Warehouse</p>
              <Link
                to="/inventory"
                className="text-xs font-semibold text-slate-400 hover:text-ocs-slate"
              >
                Stock is fine
              </Link>
            </div>
          )}
          {hcmUnreadCount > 0 ? (
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <p className="text-sm font-medium text-slate-800">HCM</p>
              <Link
                to="/hcm-news"
                className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
              >
                {hcmUnreadCount} unread
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OperatorDashboardView({
  user,
  dashboard,
  operatorMetrics,
  onStatusChange,
  isSavingStatus,
  latestHcmPost = null,
  rosterMeta = null,
  onOpenRosterPdf,
  hcmUnreadCount = 0,
}) {
  const monthLabel = dayjs().format("MMMM");
  const counts = getOperatorBoardCounts(operatorMetrics);
  const lowStockAlert = dashboard?.ocs_low_stock_alert;

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-ocs-slate md:text-[2.125rem]">
            Today
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">{dayjs().format("dddd D MMMM")}</p>
        </div>
        <OperationStatusSelector
          align="right"
          className="mt-0"
          disabled={isSavingStatus}
          onChange={onStatusChange}
          options={["active", "offline"]}
          value={user.operation_status}
        />
      </div>

      {latestHcmPost ? <HcmBulletinBanner post={latestHcmPost} /> : null}

      <LowStockBanner alert={lowStockAlert} compact variant="ocs" />

      <OperatorMetricsRow counts={counts} />

      <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <OperatorTodayStrip metrics={operatorMetrics} />
        <OperatorToolsColumn
          counts={counts}
          hcmUnreadCount={hcmUnreadCount}
          lowStockAlert={lowStockAlert}
          monthLabel={monthLabel}
          onOpenRosterPdf={onOpenRosterPdf}
          rosterMeta={rosterMeta}
        />
      </div>
    </div>
  );
}

function LabDashboardView({ dashboard, user, onStatusChange, isSavingStatus }) {
  return (
    <div className="space-y-6">
      <RoleDashboardStudio
        roleBadge="Lab workspace"
        title="Operations Dashboard"
        statusMarkup={
          <OperationStatusSelector
            align="right"
            className="mt-0"
            disabled={isSavingStatus}
            onChange={onStatusChange}
            options={["active", "offline"]}
            value={user.operation_status}
          />
        }
        leftEyebrow="Lab operations"
        leftTitle="Blood test workflow"
        leftItems={[
          {
            eyebrow: "Lab queue",
            icon: ClipboardList,
            title: "Blood test queue",
            size: "hero",
            to: "/lab",
          },
          {
            eyebrow: "Patient view",
            icon: UsersRound,
            title: "Patient records",
            size: "compact",
            to: "/patients",
          },
        ]}
        promoItem={{
          eyebrow: "Health care manager",
          icon: BellRing,
          title: "Updates from HCM",
          size: "hero",
          to: "/hcm-news",
        }}
        rightEyebrow="Lab coordination"
        rightTitle="Personal operation updates"
        rightItems={[
          {
            eyebrow: "Visit planning",
            icon: CalendarClock,
            title: "Scheduled visits",
            to: "/lab",
          },
          {
            eyebrow: "Consultation handoff",
            icon: Stethoscope,
            title: "Consultations",
            to: "/consultations",
          },
          {
            eyebrow: "Review appointment",
            icon: UsersRound,
            title: "Patient review",
            to: "/patients",
          },
        ]}
      />

      <DashboardSupportSections dashboard={dashboard} />
    </div>
  );
}

function AccountantDashboardView({ dashboard, user, onStatusChange, isSavingStatus }) {
  return (
    <div className="space-y-6">
      <RoleDashboardStudio
        roleBadge="Finance workspace"
        title="Operations Dashboard"
        statusMarkup={
          <OperationStatusSelector
            align="right"
            className="mt-0"
            disabled={isSavingStatus}
            onChange={onStatusChange}
            options={["active", "offline"]}
            value={user.operation_status}
          />
        }
        leftEyebrow="Billing operations"
        leftTitle="Collections workspace"
        leftItems={[
          {
            eyebrow: "Billing desk",
            icon: CreditCard,
            title: "Billing workspace",
            size: "hero",
            to: "/billing",
          },
          {
            eyebrow: "Revenue",
            icon: DollarSign,
            title: "Collected revenue",
            size: "compact",
            to: "/billing",
          },
        ]}
        promoItem={{
          eyebrow: "Health care manager",
          icon: BellRing,
          title: "Updates from HCM",
          size: "hero",
          to: "/hcm-news",
        }}
        rightEyebrow="Finance follow-up"
        rightTitle="Personal operation updates"
        rightItems={[
          {
            eyebrow: "Outstanding bills",
            icon: CreditCard,
            title: "Pending payment",
            to: "/billing",
          },
          {
            eyebrow: "Collection review",
            icon: DollarSign,
            title: "Payment review",
            to: "/billing",
          },
          {
            eyebrow: "Billing summary",
            icon: ClipboardList,
            title: "Patient billing",
            to: "/billing",
          },
          {
            eyebrow: "Operations news",
            icon: BellRing,
            title: "HCM news",
            to: "/hcm-news",
          },
        ]}
      />

      <DashboardSupportSections dashboard={dashboard} upcomingTitle="Upcoming operations" />
    </div>
  );
}



function getAdminVisitsToday(dashboard) {
  if (Array.isArray(dashboard?.todaysVisits)) return dashboard.todaysVisits;
  const today = dayjs().format("YYYY-MM-DD");
  return (dashboard?.upcomingAppointments || []).filter(
    (visit) =>
      String(visit.appointment_date || "").slice(0, 10) === today &&
      String(visit.status || "").toLowerCase() !== "cancelled",
  );
}

const adminMetricVariants = {
  visits: {
    card: "border border-gray-100 bg-white shadow-sm hover:shadow-md",
    label: "text-slate-600",
    value: "text-ocs-teal",
    anchorTheme: "doctor-primary",
  },
  unpaid: {
    card: "border border-rose-100 bg-rose-50/70 hover:bg-rose-50",
    label: "text-rose-500",
    value: "text-slate-900",
  },
  reviews: {
    card: "border border-[#f5e3d7] border-l-4 border-l-[#d9744b] bg-[#fcf3ee] hover:bg-[#f7e6db]",
    label: "text-[#ba5a32]",
    value: "text-[#6e2f14]",
    anchorTheme: "doctor-terracotta",
  },
};

function AdminMetricCard({ to, label, value, variant }) {
  const styles = adminMetricVariants[variant];

  return (
    <Link
      to={to}
      className={cx(
        "group relative flex cursor-pointer flex-col rounded-2xl p-6 transition-all duration-300 ease-in-out",
        styles.card,
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cx("text-xs font-bold uppercase tracking-widest", styles.label)}>{label}</span>
        <MetricNavAnchor theme={styles.anchorTheme} />
      </div>
      <p className={cx("mt-4 text-4xl font-black tabular-nums", styles.value)}>{value}</p>
    </Link>
  );
}

function AdminDashboardView({ dashboard, rosterMeta, onOpenRosterPdf }) {
  const counts = resolveClinicalTwinCounts("admin", { dashboard });
  const visitsToday = getAdminVisitsToday(dashboard);
  const unpaidCount = Number(dashboard?.summary?.pendingBills ?? 0);
  const totalPatients = Number(dashboard?.summary?.totalPatients ?? 0);
  const monthLabel = dayjs().format("MMMM");
  const visibleVisits = visitsToday.slice(0, 8);

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-ocs-slate md:text-[2.125rem]">
            Today
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">{dayjs().format("dddd D MMMM")}</p>
        </div>
        <Link to="/patients" className="shrink-0 text-right transition hover:opacity-90">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Live Patients</p>
          <p className="mt-1 text-3xl font-black tabular-nums tracking-tight text-ocs-teal">{totalPatients}</p>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-gray-400">Clinic wide</p>
        </Link>
      </div>

      <LowStockBanner alert={dashboard?.ocs_low_stock_alert} variant="ocs" />

      <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
        <AdminMetricCard
          to="/appointments"
          label="Visits today"
          value={visitsToday.length}
          variant="visits"
        />
        <AdminMetricCard
          to="/billing?status=unpaid"
          label="Unpaid bills"
          value={unpaidCount}
          variant="unpaid"
        />
        <AdminMetricCard
          to="/admin/long-term-review"
          label="Reviews due"
          value={counts.longTermReviewCount}
          variant="reviews"
        />
      </div>

      <div className="grid w-full grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm lg:col-span-3">
          <div className="flex items-center justify-between gap-3 border-b border-gray-50 pb-3">
            <span className="text-sm font-semibold text-slate-800">Today’s visits</span>
            <Link to="/appointments" className="text-xs font-semibold text-slate-500 transition hover:text-ocs-slate">
              Appointments
            </Link>
          </div>
          {visibleVisits.length ? (
            <ul className="mt-3 divide-y divide-slate-100">
              {visibleVisits.map((visit) => {
                const timeLabel =
                  formatReviewAppointmentTime(visit.appointment_time) ||
                  String(visit.appointment_time || "").slice(0, 5);
                const place = String(visit.location || "").trim();

                return (
                  <li key={visit.id}>
                    <Link
                      to={visit.patient_id ? `/patients/${visit.patient_id}` : "/appointments"}
                      className="flex items-start justify-between gap-3 py-3 transition hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold tabular-nums text-slate-900">{timeLabel}</p>
                        <p className="mt-0.5 text-sm font-semibold leading-snug text-slate-800">
                          {visit.patient_name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {visit.doctor_name}
                          {place ? ` · ${place}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 pt-0.5 text-xs font-semibold text-ocs-teal">Open</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-500">No visits booked today.</p>
              <Link to="/appointments" className="text-xs font-semibold text-ocs-teal">
                Appointments
              </Link>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Link
            to="/billing?status=unpaid"
            className="flex min-h-[160px] flex-col justify-between rounded-2xl border border-gray-100 border-l-4 border-l-ocs-teal bg-white p-6 shadow-sm transition-colors hover:shadow-md"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-600">Unpaid</span>
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {unpaidCount} bill{unpaidCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="min-w-0 text-xs font-semibold leading-normal text-slate-700">
                Open billing to collect. Not counted in doctor net until paid.
              </p>
              <span className="shrink-0 text-xs font-semibold text-ocs-teal">Open billing</span>
            </div>
          </Link>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <p className="text-sm font-semibold text-slate-800">Tools</p>
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{monthLabel} roster</p>
                  <Link to="/admin/roster" className="text-xs font-semibold text-slate-400 hover:text-ocs-slate">
                    Open roster
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={onOpenRosterPdf}
                  disabled={!rosterMeta?.has_roster}
                  className="shrink-0 rounded-xl bg-ocs-teal px-3 py-2 text-xs font-semibold text-white transition hover:bg-ocs-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Download PDF
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                <p className="text-sm font-medium text-slate-800">Health plans</p>
                <Link
                  to="/patients?filter=subscribed"
                  className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
                >
                  {counts.healthPlansCount} subscribed
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


function DashboardPage() {
  const { user, updateUser, hcmUnreadCount } = useAuth();
  const isMobile = useIsMobile();
  const isOperator = user.role === "operator";
  const { metrics: operatorMetrics } = useOperatorDashboardMetrics(isOperator);
  const [dashboard, setDashboard] = useState(null);
  const [latestHcmPost, setLatestHcmPost] = useState(null);
  const [rosterMeta, setRosterMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSavingStatus, setIsSavingStatus] = useState(false);

  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function loadDashboard() {
      try {
        const [data, rosterData, doctorWorkspace] = await Promise.all([
          api.get("/dashboard"),
          ["admin", "doctor", "operator"].includes(user.role)
            ? api.get("/dashboard/roster")
            : Promise.resolve(null),
          user.role === "doctor" ? api.get("/dashboard/doctor-workspace") : Promise.resolve(null),
        ]);

        let merged = data;
        if (doctorWorkspace) {
          merged = { ...merged, doctorWorkspace };
        }
        if (user.role === "operator") {
          try {
            const operatorWorkspace = await api.get("/dashboard/operator-workspace");
            merged = { ...data, operatorWorkspace };
          } catch (opError) {
            toast.error(opError.message || "Could not load operator workspace metrics.");
          }
        }

        let bulletinPost = null;
        if (user.role === "doctor" || user.role === "operator") {
          try {
            const hcm = await api.get("/hcm-news");
            const newestPost = hcm.posts?.[0] || null;
            bulletinPost = isHcmPostWithinBulletinWindow(newestPost) ? newestPost : null;
          } catch {
            bulletinPost = null;
          }
        }

        if (!ignore) {
          setDashboard(merged);
          setRosterMeta(rosterData);
          setLatestHcmPost(bulletinPost);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => {
      ignore = true;
    };
  }, [user.role, refreshKey]);

  async function handleOpenRosterPdf() {
    if (!rosterMeta?.has_roster) {
      toast.error("Roster PDF is not uploaded yet.");
      return;
    }

    const previewTab = openInlinePreviewTab();

    try {
      const file = await api.getBlob("/dashboard/roster/file");
      const mode = presentFileBlob({
        blob: file.blob,
        filename: file.filename || "roster.pdf",
        mimeType: file.contentType || "application/pdf",
        previewTab,
      });

      if (mode === "download") {
        toast.success("Roster saved to your device. Open it from your downloads.");
      }
    } catch (error) {
      closePreviewTab(previewTab);
      toast.error(error.message);
    }
  }

  async function handleStatusChange(nextStatus) {
    if (isSavingStatus || user.operation_status === nextStatus) {
      return;
    }

    setIsSavingStatus(true);

    try {
      const payload = await api.put("/dashboard/my-status", { status: nextStatus });
      updateUser(payload.user);
      toast.success("Live status updated.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSavingStatus(false);
    }
  }

  if (loading) {
    return <LoadingState label="Loading dashboard" />;
  }

  if (!dashboard) {
    return (
      <EmptyState
        title="Dashboard unavailable"
        description="The dashboard could not be loaded right now. Please refresh and try again."
      />
    );
  }

  if (isMobile) {
    return (
      <MobileLauncher
        user={user}
        dashboard={dashboard}
        operatorMetrics={operatorMetrics}
        latestHcmPost={latestHcmPost}
        onOpenRosterPdf={handleOpenRosterPdf}
      />
    );
  }

  if (user.role === "doctor") {
    return (
      <DoctorDashboardView
        dashboard={dashboard}
        isSavingStatus={isSavingStatus}
        latestHcmPost={latestHcmPost}
        lowStockAlert={dashboard.doctor_low_stock_alert}
        onOpenRosterPdf={handleOpenRosterPdf}
        onStatusChange={handleStatusChange}
        user={user}
      />
    );
  }

  if (user.role === "operator") {
    return (
      <OperatorDashboardView
        dashboard={dashboard}
        hcmUnreadCount={hcmUnreadCount}
        isSavingStatus={isSavingStatus}
        latestHcmPost={latestHcmPost}
        onOpenRosterPdf={handleOpenRosterPdf}
        onStatusChange={handleStatusChange}
        operatorMetrics={operatorMetrics}
        rosterMeta={rosterMeta}
        user={user}
      />
    );
  }

  if (user.role === "lab_tech") {
    return (
      <LabDashboardView
        dashboard={dashboard}
        isSavingStatus={isSavingStatus}
        onStatusChange={handleStatusChange}
        user={user}
      />
    );
  }

  if (user.role === "accountant") {
    return (
      <AccountantDashboardView
        dashboard={dashboard}
        isSavingStatus={isSavingStatus}
        onStatusChange={handleStatusChange}
        user={user}
      />
    );
  }

  return (
    <AdminDashboardView
      dashboard={dashboard}
      onOpenRosterPdf={handleOpenRosterPdf}
      rosterMeta={rosterMeta}
    />
  );
}

export default DashboardPage;
