import { useEffect, useState } from "react";
import dayjs from "dayjs";
import {
  Activity,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  DollarSign,
  MapPin,
  Package,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  UsersRound,
  UserSearch,
} from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import ClinicalTwinMetricsCards from "../components/ClinicalTwinMetricsCards.jsx";
import LowStockBanner from "../components/LowStockBanner.jsx";
import HcmBulletinBanner from "../components/HcmBulletinBanner.jsx";
import { isHcmPostWithinBulletinWindow } from "../lib/hcmBulletin.js";
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
import PatientWorkspaceHeader from "../components/patient-workspace/PatientWorkspaceHeader.jsx";
import { useOperationalTaskCount } from "../hooks/useOperationalTaskCount.js";
import DoctorDashboard from "../components/doctor-dashboard/DoctorDashboard.jsx";
import AppUpdateBanner from "../components/AppUpdateBanner.jsx";
import OperatorCommandCentre from "../components/operator-dashboard/OperatorCommandCentre.jsx";
import OperatorPolicyVerifier from "../components/operator-dashboard/OperatorPolicyVerifier.jsx";
import OperatorMobileLiveRequests from "../components/operator-dashboard/OperatorMobileLiveRequests.jsx";
import { getTimeOfDayGreeting } from "../components/operator-dashboard/operatorDashboardCopy.js";
import Modal from "../components/Modal.jsx";
import { formatCurrency, formatDateTime, truncate } from "../lib/format.js";
import { cx } from "../lib/utils.js";

function getOperatorBoardCounts(metrics) {
  return {
    visitRequests: Number(metrics?.visit_requests?.active_count ?? 0),
    unassignedRequests: Number(metrics?.visit_requests?.unassigned_count ?? 0),
    reviews: Number(metrics?.long_term_review?.active_followup_count ?? 0),
    overdueReviews: Number(metrics?.long_term_review?.overdue_count ?? 0),
    unpaidThisWeek: Number(metrics?.pending_payment?.unpaid_this_week_count ?? 0),
    doctorsThisWeek: Number(metrics?.coverage?.doctors_this_week ?? 0),
    availableNow: Number(
      metrics?.coverage?.available_now_count ?? metrics?.coverage?.on_call_count ?? 0,
    ),
  };
}

function OperatorMobileLauncher({ user, dashboard }) {
  const firstName = (user.full_name || "").split(" ")[0] || "there";
  const [policyOpen, setPolicyOpen] = useState(false);

  return (
    <div className="flex min-h-[70svh] w-full min-w-0 flex-col pb-4 pt-2">
      <div className="flex items-start justify-between gap-3"><h1 className="text-[1.65rem] font-bold leading-tight tracking-tight text-[#173f4a]">
        {getTimeOfDayGreeting()}, {firstName}
      </h1><AppUpdateBanner compact /></div>
      <p className="mt-1.5 text-sm text-[#485e65]">{dayjs().format("dddd, D MMMM")}</p>

      <div className="mt-6">
        <OperatorMobileLiveRequests visits={dashboard?.liveVisitRequests} readOnly={Boolean(user.is_read_only)} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <Link to="/patients" className="inline-flex min-h-[68px] items-center justify-center gap-2 rounded-full border border-[#9dc5c4] bg-white/75 px-2 py-3 text-sm font-semibold text-[#173f4a] transition active:bg-[#e6f5f2]">
          <UserSearch className="size-6 shrink-0" strokeWidth={1.7} aria-hidden="true" />Find patient
        </Link>
        <button type="button" onClick={() => setPolicyOpen(true)} className="inline-flex min-h-[68px] items-center justify-center gap-2 rounded-full border border-[#9dc5c4] bg-white/75 px-2 py-3 text-sm font-semibold text-[#173f4a] transition active:bg-[#e6f5f2]">
          <ShieldCheck className="size-6 shrink-0" strokeWidth={1.7} aria-hidden="true" />Verify policy
        </button>
      </div>

      <Modal open={policyOpen} onClose={() => setPolicyOpen(false)} title="Verify policy" description="Enter a policy number or Mauritius ID. Use both to confirm they belong to the same policy." size="sm">
        <OperatorPolicyVerifier embedded />
      </Modal>
    </div>
  );
}

function MobileLauncher({
  user,
  dashboard,
  operatorMetrics,
  onStatusChange,
  isSavingStatus,
  latestHcmPost = null,
}) {
  const firstName = (user.full_name || "").split(" ")[0] || "Doctor";
  const isDoctor = user.role === "doctor";

  if (isDoctor) {
    return (
      <DoctorDashboard user={user} dashboard={dashboard} latestHcmPost={latestHcmPost} onStatusChange={onStatusChange} isSavingStatus={isSavingStatus} mobile />
    );
  }

  if (user.role === "operator") {
    return (
      <OperatorMobileLauncher user={user} dashboard={dashboard} />
    );
  }

  if (user.role === "admin") return <AdminDashboardView dashboard={dashboard} user={user} mobile />;

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
      label: user.role === "doctor" ? "Billing" : "Finance",
      icon: CreditCard,
      to: user.role === "doctor" ? "/billing" : "/admin/finance",
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

function OperatorDashboardView({
  user,
  dashboard,
  operatorMetrics,
  onStatusChange,
  isSavingStatus,
  latestHcmPost = null,
}) {
  const counts = getOperatorBoardCounts(operatorMetrics);

  return (
    <OperatorCommandCentre
      counts={counts}
      isSavingStatus={isSavingStatus}
      latestHcmPost={latestHcmPost}
      lowStockAlert={dashboard?.ocs_low_stock_alert}
      onStatusChange={onStatusChange}
      liveVisits={dashboard?.liveVisitRequests}
      user={user}
    />
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
            showLabel={false}
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
            showLabel={false}
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
            to: "/admin/finance",
          },
          {
            eyebrow: "Revenue",
            icon: DollarSign,
            title: "Collected revenue",
            size: "compact",
            to: "/admin/finance",
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
            to: "/admin/finance",
          },
          {
            eyebrow: "Collection review",
            icon: DollarSign,
            title: "Payment review",
            to: "/admin/finance",
          },
          {
            eyebrow: "Billing summary",
            icon: ClipboardList,
            title: "Patient billing",
            to: "/admin/finance",
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
    card: "border border-[#eedcad] bg-[#fff8e8] hover:bg-[#fff2d4]",
    label: "text-[#795519]",
    value: "text-slate-900",
  },
  reviews: {
    card: "border border-[#eedcad] bg-[#fff8e8] hover:bg-[#fff2d4]",
    label: "text-[#795519]",
    value: "text-[#795519]",
    anchorTheme: "doctor-terracotta",
  },
};

function AdminMetricCard({ to, label, value, variant }) {
  const styles = Number(value) > 0 ? adminMetricVariants[variant] : adminMetricVariants.visits;

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

function AdminDashboardView({ dashboard, user, mobile = false }) {
  const counts = resolveClinicalTwinCounts("admin", { dashboard });
  const visitsToday = getAdminVisitsToday(dashboard);
  const actionCount = useOperationalTaskCount(user);
  const firstName = String(user?.full_name || "").replace(/^dr\.?\s+/i, "").trim().split(/\s+/)[0] || "there";
  return (
    <div className="admin-dashboard mx-auto w-full min-w-0 max-w-6xl space-y-5">
      <PatientWorkspaceHeader title={`${getTimeOfDayGreeting()}, ${firstName}`} subtitle={`${dayjs().format("dddd D MMMM")} · Clinic overview`} role="admin"
        actions={!mobile ? <Link to="/patients/add" className="patient-control patient-control-primary"><UserPlus className="size-4" />Add patient</Link> : null}>
        <Link to="/patients?tab=pending_approval" className={cx("patient-control", Number(dashboard?.pendingPatientApprovalCount) > 0 && "border-amber-300 bg-amber-50 text-amber-900")}>Patient approvals{dashboard?.pendingPatientApprovalCount != null ? ` · ${dashboard.pendingPatientApprovalCount}` : ""}</Link>
      </PatientWorkspaceHeader>
      <LowStockBanner alert={dashboard?.ocs_low_stock_alert} variant="ocs" />
      <div className="admin-dashboard-metrics grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminMetricCard to="/appointments" label="Visits today" value={visitsToday.length} variant="visits" />
        <AdminMetricCard to="/admin/finance?section=receivables&status=unpaid" label="Unpaid bills" value={Number(dashboard?.summary?.pendingBills || 0)} variant="unpaid" />
        <AdminMetricCard to="/admin/long-term-review" label="Review appointments" value={counts.longTermReviewCount} variant="reviews" />
        <AdminMetricCard to="/action-inbox" label="Pending actions" value={actionCount} variant="reviews" />
      </div>
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-2">
        <OperatorMobileLiveRequests visits={dashboard?.liveVisitRequests} readOnly />
        <section className="min-w-0 rounded-[28px] border border-[#d5e4e1] bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold text-[#173f4a]">Today’s appointments</h2><Link to="/appointments" className="patient-control">View schedule</Link></div>
          {visitsToday.length ? <ul className="mt-3 divide-y divide-[#e3eeeb]">{visitsToday.slice(0, 8).map(visit => <li key={visit.id}><Link to={visit.patient_id ? `/patients/${visit.patient_id}` : "/appointments"} className="flex min-h-16 items-start gap-3 py-3 text-sm"><span className="shrink-0 rounded-full bg-[#edf5f2] px-3 py-1 font-semibold text-[#137b80]">{formatReviewAppointmentTime(visit.appointment_time) || String(visit.appointment_time || "").slice(0, 5)}</span><span className="min-w-0"><strong className="block break-words text-[#173f4a]">{visit.patient_name}</strong><span className="mt-1 block break-words text-[#526d75]">{visit.doctor_name}{visit.location ? ` · ${visit.location}` : ""}</span></span></Link></li>)}</ul> : <p className="py-5 text-sm text-[#526d75]">No appointments today.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e3eeeb] pt-4"><Link to="/team-operations" className="patient-control">Team accounts</Link>{mobile ? <Link to="/patients/add" className="patient-control">Add patient</Link> : null}</div>
        </section>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { user, updateUser } = useAuth();
  const isMobile = useIsMobile();
  const isOperator = user.role === "operator";
  const { metrics: operatorMetrics } = useOperatorDashboardMetrics(isOperator);
  const [dashboard, setDashboard] = useState(null);
  const [latestHcmPost, setLatestHcmPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSavingStatus, setIsSavingStatus] = useState(false);

  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function loadDashboard() {
      try {
        const [data, doctorWorkspace, liveVisitRequests, patientApprovals] = await Promise.all([
          api.get("/dashboard"),
          user.role === "doctor" ? api.get("/dashboard/doctor-workspace") : Promise.resolve(null),
          ["operator", "admin"].includes(user.role)
            ? api.get("/visit-requests?status=active").catch(() => null)
            : Promise.resolve(null),
          user.role === "admin" ? api.get("/patients?pendingApproval=1&page=1&limit=1").catch(() => null) : Promise.resolve(null),
        ]);

        let merged = patientApprovals ? { ...data, pendingPatientApprovalCount: patientApprovals.pagination?.total ?? 0 } : data;
        if (doctorWorkspace) {
          merged = { ...merged, doctorWorkspace };
        }
        if (liveVisitRequests) {
          merged = { ...merged, liveVisitRequests };
        }
        if (user.role === "operator") {
          try {
            const operatorWorkspace = await api.get("/dashboard/operator-workspace");
            merged = { ...merged, operatorWorkspace };
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
  }, [user.role, refreshKey, isMobile]);

  useEffect(() => {
    if (!isOperator && user.role !== "admin") return undefined;
    let ignore = false;
    const timer = window.setInterval(async () => {
      try {
        const liveVisitRequests = await api.get("/visit-requests?status=active");
        if (!ignore) setDashboard((current) => current ? { ...current, liveVisitRequests } : current);
      } catch {
        // Keep the last live snapshot while the realtime connection recovers.
      }
    }, 15_000);
    return () => {
      ignore = true;
      window.clearInterval(timer);
    };
  }, [isOperator, isMobile, user.role]);

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
        onStatusChange={handleStatusChange}
        isSavingStatus={isSavingStatus}
        user={user}
        dashboard={dashboard}
        operatorMetrics={operatorMetrics}
        latestHcmPost={latestHcmPost}
      />
    );
  }

  if (user.role === "doctor") {
    return (
      <DoctorDashboard
        dashboard={dashboard}
        isSavingStatus={isSavingStatus}
        latestHcmPost={latestHcmPost}
        onStatusChange={handleStatusChange}
        user={user}
      />
    );
  }

  if (user.role === "operator") {
    return (
      <OperatorDashboardView
        dashboard={dashboard}
        isSavingStatus={isSavingStatus}
        latestHcmPost={latestHcmPost}
        onStatusChange={handleStatusChange}
        operatorMetrics={operatorMetrics}
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

  return <AdminDashboardView dashboard={dashboard} user={user} />;
}

export default DashboardPage;
