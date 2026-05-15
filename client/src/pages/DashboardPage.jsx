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
  MapPinned,
  Package,
  PhoneCall,
  ShieldCheck,
  Stethoscope,
  Upload,
  UserPlus,
  UsersRound,
} from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import OperationStatusSelector from "../components/OperationStatusSelector.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { formatCurrency, formatDateTime, truncate } from "../lib/format.js";
import { cx } from "../lib/utils.js";

function MobileLauncher({ user }) {
  const firstName = (user.full_name || "").split(" ")[0] || "Doctor";
  const isDoctor = user.role === "doctor";
  const greeting = isDoctor ? `Hello, Dr. ${firstName}` : `Hello, ${firstName}`;

  const cards = [];

  if (["admin", "doctor", "operator"].includes(user.role)) {
    cards.push({
      label: "Patient Directory",
      icon: UsersRound,
      to: "/patients",
      description: "Search and open existing patient records.",
    });
  }

  if (["admin", "doctor", "operator"].includes(user.role)) {
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
  } else if (user.role === "operator") {
    cards.push({
      label: "Billing",
      icon: CreditCard,
      to: "/operator/billing-status",
      description: "Check billing status and payment follow-up.",
    });
  }

  if (["admin", "doctor", "operator"].includes(user.role)) {
    cards.push({
      label: "Inventory",
      icon: Package,
      to: "/inventory",
      description: "Check supplies and restock your medical kit.",
    });
  }

  if (user.role === "lab_tech") {
    cards.push(
      { label: "Lab Queue", icon: ClipboardList, to: "/lab", description: "Open the active lab workspace and blood test queue." },
      { label: "Patient Directory", icon: UsersRound, to: "/patients", description: "Search and open existing patient records." },
      { label: "Inventory", icon: Package, to: "/inventory", description: "Check supplies and internal stock visibility." },
    );
  }

  return (
    <div className="flex min-h-[60svh] w-full min-w-0 flex-col">
      <h1 className="text-[1.6rem] font-bold tracking-tight text-slate-950">
        {greeting}
      </h1>
      <p className="mt-1 text-sm text-[#51717b]">What would you like to do?</p>

      <div className="mt-6 flex flex-1 flex-col gap-3.5 overflow-y-auto">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              to={card.to}
              className="group flex w-full items-center gap-5 rounded-[24px] border border-[rgba(65,200,198,0.2)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,251,250,0.94))] px-5 py-6 shadow-[0_20px_50px_rgba(34,72,91,0.08)] transition duration-150 active:scale-[0.97] active:shadow-[0_10px_30px_rgba(34,72,91,0.12)]"
            >
              <div className="flex size-13 shrink-0 items-center justify-center rounded-2xl border border-[rgba(65,200,198,0.22)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(229,245,246,0.92))] text-[#2d8f98] shadow-sm transition group-active:bg-[#2d8f98] group-active:text-white">
                <Icon className="size-6" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[1.05rem] font-bold tracking-tight text-slate-950">
                  {card.label}
                </p>
                <p className="mt-0.5 text-sm leading-6 text-[#51717b]">
                  {card.description}
                </p>
              </div>
              <ArrowUpRight className="size-5 shrink-0 text-[#2d8f98] opacity-60 transition group-active:translate-x-0.5 group-active:-translate-y-0.5 group-active:opacity-100" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="max-w-full min-w-0 rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-white/88 p-5 shadow-[0_24px_64px_rgba(34,72,91,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-500">
            {label}
          </p>
          <p className="mt-3 break-words text-3xl font-bold tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-3xl p-4 ${accent}`}>
          <Icon className="size-6 text-white" />
        </div>
      </div>
    </div>
  );
}

function QuickLinkCard({ id, title, description, to, onClick }) {
  const cardClasses =
    "rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-white/88 p-5 text-left shadow-[0_24px_64px_rgba(34,72,91,0.08)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_70px_rgba(34,72,91,0.12)]";

  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">{title}</p>
      <p className="mt-3 text-base leading-7 text-[#486976]">{description}</p>
    </>
  );

  if (to) {
    return (
      <Link className={cardClasses} id={id} to={to}>
        {content}
      </Link>
    );
  }

  return (
    <button className={cardClasses} id={id} onClick={onClick} type="button">
      {content}
    </button>
  );
}

function scrollToSection(sectionId) {
  if (typeof document === "undefined") {
    return;
  }

  const element = document.getElementById(sectionId);
  if (!element) {
    return;
  }

  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

function DashboardPill({ children, dark = false, to, onClick }) {
  const classes = `block w-full rounded-[24px] border px-4 py-5 text-center transition ${
    dark
      ? "border-white/10 bg-[#678994] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-[#5f818b]"
      : "border-[rgba(58,84,92,0.18)] bg-[rgba(255,255,255,0.72)] text-slate-950 hover:bg-white"
  }`;

  const content = (
    <div
      className={`whitespace-pre-line text-[15px] leading-tight ${
        dark ? "font-semibold text-white" : "text-slate-950"
      }`}
    >
      {children}
    </div>
  );

  if (to) {
    return <Link className={classes} to={to}>{content}</Link>;
  }

  if (onClick) {
    return (
      <button className={classes} onClick={onClick} type="button">
        {content}
      </button>
    );
  }

  return (
    <div className={classes}>{content}</div>
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
}) {
  const sizeClasses =
    size === "hero"
      ? "min-h-[124px] px-6 py-6 md:px-7 md:py-7"
      : size === "compact"
        ? "min-h-[88px] px-5 py-4 md:px-6"
        : "min-h-[100px] px-5 py-5 md:px-6";

  const classes = cx(
    "group flex w-full rounded-[30px] border transition duration-200",
    sizeClasses,
    dark
      ? "border-[rgba(45,143,152,0.34)] bg-[linear-gradient(145deg,#2c9099_0%,#276f78_48%,#215f67_100%)] text-white shadow-[0_22px_50px_rgba(45,143,152,0.28)] hover:-translate-y-0.5 hover:shadow-[0_28px_60px_rgba(45,143,152,0.32)]"
      : "border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,251,250,0.94))] text-slate-950 shadow-[0_18px_42px_rgba(34,72,91,0.08)] hover:-translate-y-0.5 hover:border-[rgba(45,143,152,0.26)] hover:shadow-[0_24px_54px_rgba(34,72,91,0.12)]",
  );

  const content = (
    <div className="flex w-full items-center gap-4">
      {Icon ? (
        <div
          className={cx(
            "flex size-12 shrink-0 items-center justify-center rounded-2xl border md:size-14",
            dark
              ? "border-white/16 bg-white/12 text-white"
              : "border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(233,248,247,0.96))] text-[#2d8f98]",
          )}
        >
          <Icon className="size-5 md:size-6" />
        </div>
      ) : null}

      <div className="min-w-0 flex-1 text-left leading-tight">
        {eyebrow ? (
          <p
            className={cx(
              "text-[11px] font-semibold uppercase tracking-[0.26em]",
              dark ? "text-white/72" : "text-[#6a9297]",
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <p
          className={cx(
            "break-words font-semibold tracking-tight",
            size === "hero" ? "mt-2 text-[1.18rem] md:text-[1.45rem]" : "mt-1 text-[1.04rem] md:text-[1.18rem]",
            dark ? "text-white" : "text-slate-950",
          )}
        >
          {title}
        </p>
        {subtitle ? (
          <p
            className={cx(
              "mt-2 break-words text-sm leading-6",
              dark ? "text-white/84" : "text-[#51717b]",
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

      <div
        className={cx(
          "hidden rounded-full px-3 py-1 text-xs font-semibold md:inline-flex md:items-center md:gap-1.5",
          dark
            ? "bg-white/12 text-white/90"
            : "bg-[rgba(45,143,152,0.08)] text-[#2d8f98]",
        )}
      >
        Open
        <ArrowUpRight className="size-3.5 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </div>
  );

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

function RoleBoard({
  eyebrow = "OCS MEDECINS",
  title = "Operations Dashboard",
  statusMarkup,
  leftTitle,
  leftItems,
  rightTitle,
  rightItems,
}) {
  return (
    <section className="rounded-[38px] border border-[rgba(106,129,138,0.4)] bg-[#aebdc3] p-5 shadow-[0_36px_90px_rgba(34,72,91,0.12)]">
      <p className="pl-2 text-xs font-semibold uppercase tracking-[0.28em] text-[#2f646e]">
        {eyebrow}
      </p>
      <h2 className="mt-3 pl-2 font-display text-4xl tracking-tight text-slate-950">
        {title}
      </h2>

      <div className="mt-5 rounded-[34px] border border-[rgba(255,255,255,0.56)] bg-[#edf7f8] px-6 py-7">
        <div className="grid gap-5 xl:grid-cols-[1.02fr_0.98fr]">
          <div>
            <p className="text-2xl font-semibold uppercase tracking-tight text-[#2e5f68]">
              <span className="text-[#efbe39]">TOGETHER,</span> BRINGING HEALTHCARE TO EVERY
              DOORSTEP
            </p>
          </div>
          <div className="text-left text-[17px] font-semibold uppercase tracking-[0.08em] text-[#2e5f68] xl:text-right xl:pt-1">
            {statusMarkup}
          </div>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <div className="rounded-[30px] border border-[rgba(106,129,138,0.34)] bg-[rgba(255,255,255,0.38)] px-6 py-6">
            <p className="text-2xl font-semibold text-slate-950">{leftTitle}</p>
            <div className="mt-5 space-y-4">
              {leftItems.map((item, index) => (
                <DashboardPill
                  key={`${leftTitle}-${index}`}
                  dark={item.dark}
                  onClick={item.onClick}
                  to={item.to}
                >
                  {item.label}
                </DashboardPill>
              ))}
            </div>
          </div>

          <div className="rounded-[30px] border border-[rgba(106,129,138,0.34)] bg-[rgba(255,255,255,0.38)] px-6 py-6">
            <p className="text-2xl font-semibold text-slate-950">{rightTitle}</p>
            <div className="mt-5 space-y-4">
              {rightItems.map((item, index) => (
                <DashboardPill
                  key={`${rightTitle}-${index}`}
                  onClick={item.onClick}
                  to={item.to}
                >
                  {item.label}
                </DashboardPill>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function OperationsDashboardDesktopHeader({ title, roleBadge, statusMarkup }) {
  return (
    <div className="mb-2 hidden items-start justify-between gap-4 border-b border-[rgba(65,200,198,0.14)] pb-3 md:flex">
      <div className="min-w-0 flex-1 pr-4">
        <p className="text-[1rem] font-medium uppercase tracking-[0.12em] text-[#2f6670] md:text-[1.2rem]">
          OCS M&#201;DECINS
        </p>
        <h2 className="mt-2 font-display text-[2rem] leading-[0.98] tracking-tight text-slate-950 md:text-[2.65rem]">
          {title}
        </h2>
      </div>
      <div className="flex min-w-0 shrink-0 flex-col items-end gap-2">
        <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[rgba(65,200,198,0.18)] bg-white/78 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#2d8f98] shadow-sm">
          <ShieldCheck className="size-3.5 shrink-0" />
          <span className="truncate">{roleBadge}</span>
        </div>
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2 rounded-2xl border border-[rgba(65,200,198,0.2)] bg-white/92 px-3 py-2 shadow-[0_8px_22px_rgba(34,72,91,0.06)] sm:gap-3 sm:px-4">
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#6b9499]">
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
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6b9499]">
                  {leftEyebrow}
                </p>
                <p className="mt-2 text-[1.35rem] font-semibold tracking-tight text-slate-950 md:text-[1.65rem]">
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
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6b9499]">
                {rightEyebrow}
              </p>
              <p className="mt-2 text-[1.35rem] font-semibold tracking-tight text-slate-950 md:text-[1.65rem]">
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
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        icon={Activity}
        label="Total patients"
        value={dashboard.summary.totalPatients}
        accent="bg-gradient-to-br from-sky-500 to-blue-600"
      />
      <SummaryCard
        icon={CalendarClock}
        label="Today's appointments"
        value={dashboard.summary.todaysAppointments}
        accent="bg-gradient-to-br from-cyan-500 to-sky-600"
      />
      <SummaryCard
        icon={CreditCard}
        label="Pending bills"
        value={dashboard.summary.pendingBills}
        accent="bg-gradient-to-br from-amber-400 to-orange-500"
      />
      <SummaryCard
        icon={DollarSign}
        label="Total revenue"
        value={formatCurrency(dashboard.summary.totalRevenue)}
        accent="bg-gradient-to-br from-emerald-500 to-teal-600"
      />
    </div>
  );
}

function UpcomingAppointmentsPanel({
  dashboard,
  upcomingTitle = "Upcoming appointments",
}) {
  return (
    <SectionCard
      title={upcomingTitle}
      subtitle="The next seven days of scheduled home visits."
    >
      {dashboard.upcomingAppointments.length ? (
        <div className="space-y-4">
          {dashboard.upcomingAppointments.map((appointment) => (
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
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
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

function DashboardActionSections({ sections }) {
  if (!sections?.length) {
    return null;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sections.map((section) => (
        <QuickLinkCard
          key={section.id}
          id={section.id}
          title={section.title}
          description={section.description}
          to={section.to}
          onClick={section.onClick}
        />
      ))}
    </div>
  );
}

function DoctorStatusPanel({ doctors = [] }) {
  const availableCount = doctors.filter((doctor) => doctor.operation_status === "available").length;
  const activeCount = doctors.filter((doctor) => doctor.operation_status === "active").length;
  const offlineCount = doctors.filter((doctor) => doctor.operation_status === "offline").length;

  return (
    <div className="rounded-[34px] border border-[rgba(65,200,198,0.18)] bg-white/82 px-5 py-5 shadow-[0_20px_50px_rgba(34,72,91,0.08)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6b9499]">
            Doctors live status
          </p>
          <p className="mt-2 text-[1.25rem] font-semibold tracking-tight text-slate-950">
            Doctor availability overview
          </p>
          <p className="mt-2 text-sm leading-6 text-[#51717b]">
            A read-only view of each doctor account status across OCS Medecins.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
            Available {availableCount}
          </span>
          <span className="inline-flex rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-600/20">
            Active {activeCount}
          </span>
          <span className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-600/20">
            Offline {offlineCount}
          </span>
        </div>
      </div>

      <div className="mt-5 max-h-[280px] space-y-3 overflow-y-auto pr-1">
        {doctors.length ? (
          doctors.map((doctor) => (
            <div
              key={doctor.id}
              className="flex flex-col gap-3 rounded-[24px] border border-[rgba(65,200,198,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,251,250,0.9))] px-4 py-4 shadow-[0_10px_24px_rgba(34,72,91,0.05)] md:flex-row md:items-center md:justify-between"
            >
              <div className="min-w-0">
                <p className="font-semibold text-slate-950">{doctor.full_name}</p>
                <p className="mt-1 text-sm text-[#51717b]">
                  {doctor.specialization || "General practice"}
                </p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-400">
                  {doctor.username ? `@${doctor.username}` : "No linked login"}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge value={doctor.operation_status || "not linked"} />
                <span className="text-xs text-slate-500">
                  {doctor.operation_status_updated_at
                    ? `Updated ${dayjs(doctor.operation_status_updated_at).format("MMM D, h:mm A")}`
                    : "No status update yet"}
                </span>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            title="No doctor statuses available"
            description="Doctor live statuses will appear here once doctor accounts are linked."
          />
        )}
      </div>
    </div>
  );
}

function PersonalOperationOverviewCard({ title, subtitle, accent = false, to, icon: Icon }) {
  const classes = cx(
    "group relative overflow-hidden rounded-[30px] border px-5 py-5 shadow-[0_18px_42px_rgba(34,72,91,0.08)] transition duration-200 md:px-6 md:py-5",
    accent
      ? "border-[rgba(65,200,198,0.22)] bg-[linear-gradient(160deg,rgba(238,249,249,0.98),rgba(224,239,241,0.94))]"
      : "border-[rgba(106,129,138,0.2)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(246,251,251,0.95))]",
    to
      ? "block hover:-translate-y-1 hover:border-[rgba(45,143,152,0.28)] hover:shadow-[0_24px_54px_rgba(34,72,91,0.12)]"
      : "",
  );

  const content = (
    <>
      <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-[radial-gradient(circle,rgba(65,200,198,0.12),transparent_68%)] blur-2xl" />

      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <div
            className={cx(
              "flex size-12 shrink-0 items-center justify-center rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]",
              accent
                ? "border-[rgba(65,200,198,0.24)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(229,245,246,0.92))] text-[#2d8f98]"
                : "border-[rgba(106,129,138,0.18)] bg-white/90 text-[#5c7c86]",
            )}
          >
            {Icon ? <Icon className="size-5" /> : null}
          </div>

          {to ? (
            <span className="inline-flex size-9 items-center justify-center rounded-full border border-[rgba(65,200,198,0.18)] bg-white/84 text-[#2d8f98] shadow-[0_10px_24px_rgba(34,72,91,0.08)] transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
              <ArrowUpRight className="size-4" />
            </span>
          ) : null}
        </div>

        <p
          className={cx(
            "text-[1.12rem] font-semibold leading-[1.18] tracking-tight text-slate-950 md:text-[1.26rem]",
            subtitle ? "mt-7" : "mt-5",
          )}
        >
          {title}
        </p>
        {subtitle ? (
          <p className="mt-4 max-w-[14rem] text-sm leading-7 text-[#496773] md:text-[1.01rem]">{subtitle}</p>
        ) : null}

        <div
          className={cx(
            "h-[3px] w-16 rounded-full",
            subtitle ? "mt-6" : "mt-5",
            accent
              ? "bg-[linear-gradient(90deg,#41c8c6,#2d8f98)]"
              : "bg-[linear-gradient(90deg,rgba(241,188,53,0.78),rgba(65,200,198,0.5))]",
          )}
        />
      </div>
    </>
  );

  if (to) {
    return (
      <Link className={classes} to={to}>
        {content}
      </Link>
    );
  }

  return <div className={classes}>{content}</div>;
}

function DoctorPersonalOperationUpdates() {
  return (
    <div className="relative overflow-hidden rounded-[42px] border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.82),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(65,200,198,0.12),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.97),rgba(236,248,248,0.94))] p-5 shadow-[0_28px_70px_rgba(34,72,91,0.1)] md:p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_88%_16%,rgba(241,188,53,0.08),transparent_18%),radial-gradient(circle_at_70%_88%,rgba(65,200,198,0.08),transparent_18%)]" />

      <div className="relative z-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#7da2aa]">
          Clinical flow
        </p>
        <h3 className="mt-2 text-[1.65rem] font-semibold tracking-tight text-slate-950 md:text-[2rem]">
          Personal operation updates
        </h3>

        <div className="mt-4 h-px w-full bg-[linear-gradient(90deg,rgba(65,200,198,0.3),rgba(241,188,53,0.22),transparent)]" />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <PersonalOperationOverviewCard
            accent
            icon={CalendarClock}
            title="Scheduled visits"
            to="/doctor/scheduled-visits"
          />
          <PersonalOperationOverviewCard
            icon={CreditCard}
            title="Pending payment"
            to="/doctor/pending-payment"
          />
          <PersonalOperationOverviewCard
            icon={Activity}
            title="Total patients seen"
            to="/doctor/patients-seen-april"
          />
          <PersonalOperationOverviewCard
            accent
            icon={UsersRound}
            title="Assigned patients"
            to="/doctor/assigned-patients"
          />
        </div>
      </div>
    </div>
  );
}

function OperatorPersonalOperationUpdates() {
  return (
    <div className="relative overflow-hidden rounded-[42px] border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.82),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(65,200,198,0.12),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.97),rgba(236,248,248,0.94))] p-5 shadow-[0_28px_70px_rgba(34,72,91,0.1)] md:p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_88%_16%,rgba(241,188,53,0.08),transparent_18%),radial-gradient(circle_at_70%_88%,rgba(65,200,198,0.08),transparent_18%)]" />

      <div className="relative z-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#7da2aa]">
          Coordination flow
        </p>
        <h3 className="mt-2 text-[1.65rem] font-semibold tracking-tight text-slate-950 md:text-[2rem]">
          Personal operation updates
        </h3>

        <div className="mt-4 h-px w-full bg-[linear-gradient(90deg,rgba(65,200,198,0.3),rgba(241,188,53,0.22),transparent)]" />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <PersonalOperationOverviewCard
            accent
            icon={CalendarClock}
            title="Scheduled visits"
            to="/operator/scheduled-visits"
          />
          <PersonalOperationOverviewCard
            icon={CreditCard}
            title="Pending payment"
            to="/operator/pending-payment"
          />
          <PersonalOperationOverviewCard
            icon={Stethoscope}
            title="Long term review"
            to="/operator/long-term-review"
          />
          <PersonalOperationOverviewCard
            accent
            icon={UsersRound}
            title="Review appointment"
            to="/operator/review-appointments-april"
          />
        </div>
      </div>
    </div>
  );
}

function DoctorDashboardView({ user, onStatusChange, isSavingStatus, onOpenRosterPdf, lowStockAlert }) {
  const monthLabel = dayjs().format("MMMM");

  return (
    <section className="relative mx-auto w-full min-w-0 max-w-[1180px] overflow-x-hidden overflow-y-hidden rounded-3xl border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(65,200,198,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(241,188,53,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(231,247,246,0.94)_100%)] p-3 shadow-[0_36px_100px_rgba(34,72,91,0.14)] md:rounded-[56px] md:p-5 lg:p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_14%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.52),transparent_20%),radial-gradient(circle_at_28%_82%,rgba(65,200,198,0.08),transparent_18%)]" />

      <div className="relative z-10">
        <OperationsDashboardDesktopHeader
          roleBadge="Doctor workspace"
          statusMarkup={
            <OperationStatusSelector
              align="right"
              className="mt-0"
              disabled={isSavingStatus}
              onChange={onStatusChange}
              value={user.operation_status}
            />
          }
          title="Operations Dashboard"
        />

        {lowStockAlert?.triggered ? (
          <div className="mt-4 rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4 shadow-[0_18px_40px_rgba(153,27,27,0.08)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-700">Low stock alert</p>
                <p className="mt-1 text-sm font-semibold text-rose-900">
                  {lowStockAlert.total_items} item(s) below 50% par level in your kit.
                </p>
                <p className="mt-1 text-xs text-rose-700">
                  Open Inventory with pre-filled quantities to recover each item to 100% par.
                </p>
              </div>
              <Link
                to="/inventory?context=my&restock=alert"
                className="inline-flex items-center justify-center rounded-2xl bg-[#4FB8B3] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#3aa6a1]"
              >
                Restock Now
              </Link>
            </div>
          </div>
        ) : null}

        <div className="mt-0 rounded-[24px] border border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(240,251,250,0.9))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.56)] md:mt-3 md:rounded-[42px] md:p-5">
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[rgba(65,200,198,0.16)] bg-white/74 p-4 shadow-[0_16px_34px_rgba(34,72,91,0.06)] md:rounded-[34px] md:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6b9499]">
                  Shifts
                </p>
                <p className="mt-2 text-[1.35rem] font-semibold tracking-tight text-slate-950 md:text-[1.65rem]">
                  My shifts
                </p>

                <div className="mt-4 space-y-4">
                  <DoctorDashboardTile
                    eyebrow="Weekly schedule"
                    icon={CalendarClock}
                    size="hero"
                    title="Current week roster"
                    onClick={onOpenRosterPdf}
                  />
                  <DoctorDashboardTile
                    eyebrow="Monthly view"
                    icon={ClipboardList}
                    size="compact"
                    title={`${monthLabel} roster`}
                    onClick={onOpenRosterPdf}
                  />
                </div>
              </div>

              <DoctorDashboardTile
                dark
                eyebrow="Health care manager"
                icon={BellRing}
                size="hero"
                title="Updates from HCM"
                to="/hcm-news"
              />
            </div>

            <DoctorPersonalOperationUpdates />
          </div>
        </div>
      </div>
    </section>
  );
}

function OperatorDashboardView({ user, onStatusChange, isSavingStatus, onOpenRosterPdf }) {
  const monthLabel = dayjs().format("MMMM");

  return (
    <section className="relative mx-auto w-full min-w-0 max-w-[1180px] overflow-x-hidden overflow-y-hidden rounded-3xl border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(65,200,198,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(241,188,53,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(231,247,246,0.94)_100%)] p-3 shadow-[0_36px_100px_rgba(34,72,91,0.14)] md:rounded-[56px] md:p-5 lg:p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_14%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.52),transparent_20%),radial-gradient(circle_at_28%_82%,rgba(65,200,198,0.08),transparent_18%)]" />

      <div className="relative z-10">
        <OperationsDashboardDesktopHeader
          roleBadge="Operator workspace"
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
          title="Operations Dashboard"
        />

        <div className="mt-0 rounded-[24px] border border-[rgba(65,200,198,0.18)] bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(240,251,250,0.9))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.56)] md:mt-3 md:rounded-[42px] md:p-5">
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <div className="rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-white/74 p-5 shadow-[0_16px_34px_rgba(34,72,91,0.06)] md:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6b9499]">
                  Shared roster
                </p>
                <p className="mt-2 text-[1.35rem] font-semibold tracking-tight text-slate-950 md:text-[1.65rem]">
                  Doctors shifts
                </p>

                <div className="mt-4 space-y-4">
                  <DoctorDashboardTile
                    eyebrow="Weekly schedule"
                    icon={CalendarClock}
                    size="hero"
                    title="Current week roster"
                    onClick={onOpenRosterPdf}
                  />
                  <DoctorDashboardTile
                    eyebrow="Monthly view"
                    icon={ClipboardList}
                    size="compact"
                    title={`${monthLabel} roster`}
                    onClick={onOpenRosterPdf}
                  />
                </div>
              </div>

              <DoctorDashboardTile
                dark
                eyebrow="Health care manager"
                icon={BellRing}
                size="hero"
                title="Updates from HCM"
                to="/hcm-news"
              />
            </div>

            <OperatorPersonalOperationUpdates />
          </div>
        </div>
      </div>
    </section>
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
            eyebrow: "Inventory",
            icon: Activity,
            title: "Inventory",
            to: "/inventory",
          },
          {
            eyebrow: "Long-term review",
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

function AdminDashboardView({
  dashboard,
  rosterMeta,
  rosterUploadFile,
  setRosterUploadFile,
  isUploadingRoster,
  handleUploadRoster,
  operatorAccessData,
  operatorGrant,
  setOperatorGrant,
  isSavingOperatorAccess,
  handleGrantOperatorAccess,
  handleRevokeOperatorAccess,
}) {
  return (
    <div className="space-y-6">
      <section className="relative mx-auto w-full min-w-0 max-w-[1180px] overflow-x-hidden overflow-y-hidden rounded-3xl border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(65,200,198,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(241,188,53,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(231,247,246,0.94)_100%)] p-3 shadow-[0_36px_100px_rgba(34,72,91,0.14)] md:rounded-[56px] md:p-5 lg:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_14%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.52),transparent_20%),radial-gradient(circle_at_28%_82%,rgba(65,200,198,0.08),transparent_18%)]" />

        <div className="relative z-10">
          <div className="hidden justify-end md:flex">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-[rgba(65,200,198,0.18)] bg-white/78 px-4 py-2 text-xs font-semibold uppercase tracking-[0.24em] text-[#2d8f98] shadow-[0_12px_28px_rgba(34,72,91,0.08)]">
              <ShieldCheck className="size-4" />
              Admin workspace
            </div>
          </div>

          <div className="mt-3 hidden md:block">
            <div>
              <p className="text-[1.12rem] font-medium uppercase tracking-[0.12em] text-[#2f6670] md:text-[1.35rem]">
                OCS M&#201;DECINS
              </p>
              <h2 className="mt-2 font-display text-[2.4rem] leading-[0.96] tracking-tight text-slate-950 md:text-[3.25rem]">
                Operations Dashboard
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-[#51717b]">
                Keep the leadership view focused on doctor availability, the next visits in the queue,
                shared HCM updates, and live operational reporting.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-6 xl:grid-cols-[1fr_1fr] xl:items-start">
            <DoctorStatusPanel doctors={dashboard.doctorStatuses} />
            <UpcomingAppointmentsPanel dashboard={dashboard} />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <div className="rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-white/74 p-5 shadow-[0_16px_34px_rgba(34,72,91,0.06)] md:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6b9499]">
                Health care manager
              </p>
              <p className="mt-2 text-[1.45rem] font-semibold tracking-tight text-slate-950 md:text-[1.85rem]">
                Updates from HCM
              </p>

              <div className="mt-4">
                <DoctorDashboardTile
                  dark
                  eyebrow="Health care manager"
                  icon={BellRing}
                  size="hero"
                  title="Updates from HCM"
                  to="/hcm-news"
                />
              </div>
            </div>

            <div className="rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-white/74 p-5 shadow-[0_16px_34px_rgba(34,72,91,0.06)] md:p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6b9499]">
                Operational analytics
              </p>
              <p className="mt-2 text-[1.45rem] font-semibold tracking-tight text-slate-950 md:text-[1.85rem]">
                Live Report
              </p>

              <div className="mt-4">
                <DoctorDashboardTile
                  eyebrow="Admin report"
                  icon={Activity}
                  size="hero"
                  title="Live Report"
                  to="/live-report"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-white/74 p-5 shadow-[0_16px_34px_rgba(34,72,91,0.06)] md:p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#6b9499]">
              Roster management
            </p>
            <p className="mt-3 text-[1.45rem] font-semibold tracking-tight text-slate-950 md:text-[1.85rem]">
              Current roster PDF
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#51717b]">
              Upload a PDF roster to publish `current_roster.pdf` for doctors and operators.
            </p>

            <form className="mt-5 flex flex-col gap-3 md:flex-row md:items-center" onSubmit={handleUploadRoster}>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-white">
                <Upload className="size-4" />
                Select PDF
                <input
                  accept="application/pdf"
                  type="file"
                  className="hidden"
                  onChange={(event) => setRosterUploadFile(event.target.files?.[0] || null)}
                />
              </label>
              <button
                type="submit"
                disabled={!rosterUploadFile || isUploadingRoster}
                className="rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploadingRoster ? "Uploading..." : "Upload current_roster.pdf"}
              </button>
              <p className="text-sm text-slate-500">
                {rosterMeta?.has_roster
                  ? `Last updated ${dayjs(rosterMeta.updated_at).format("MMM D, YYYY [at] h:mm A")}`
                  : "No roster PDF uploaded yet"}
              </p>
            </form>
          </div>
        </div>
      </section>

      <DashboardSummaryCards dashboard={dashboard} />

      <div id="admin-operator-access">
      <SectionCard
        title="Operator access"
        subtitle="Grant or revoke temporary operator edit access across all patient records from one dashboard."
      >
        {operatorAccessData ? (
          <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
            <form className="space-y-4" onSubmit={handleGrantOperatorAccess}>
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Patient</span>
                <select
                  required
                  value={operatorGrant.patient_id}
                  onChange={(event) =>
                    setOperatorGrant((current) => ({
                      ...current,
                      patient_id: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
                >
                  <option value="">Select patient</option>
                  {operatorAccessData.patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patient.full_name} - {patient.patient_identifier || "No OCS care number"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Operator</span>
                <select
                  required
                  value={operatorGrant.operator_user_id}
                  onChange={(event) =>
                    setOperatorGrant((current) => ({
                      ...current,
                      operator_user_id: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
                >
                  <option value="">Select operator</option>
                  {operatorAccessData.operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {operator.full_name} - @{operator.username}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">Edit access until</span>
                <input
                  required
                  type="datetime-local"
                  value={operatorGrant.expires_at}
                  onChange={(event) =>
                    setOperatorGrant((current) => ({
                      ...current,
                      expires_at: event.target.value,
                    }))
                  }
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
                />
              </label>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingOperatorAccess}
                  className="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingOperatorAccess ? "Saving..." : "Grant temporary access"}
                </button>
              </div>
            </form>

            {operatorAccessData.access.length ? (
              <div className="space-y-3">
                {operatorAccessData.access.map((access) => (
                  <div
                    key={access.id}
                    className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-semibold text-slate-950">
                          {access.operator_name} - @{access.operator_username}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">
                          {access.patient_name} - {access.patient_identifier || "No OCS care number"}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          Active until {dayjs(access.expires_at).format("MMM D, YYYY [at] h:mm A")}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          Granted by {access.granted_by_name || "Admin"}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Link
                          to={`/patients/${access.patient_id}`}
                          className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-sky-300 hover:text-sky-700"
                        >
                          Open patient
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleRevokeOperatorAccess(access.id)}
                          className="rounded-2xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
                        >
                          Remove access
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No active operator approvals"
                description="Grant temporary access here when an operator needs to edit an existing patient record."
              />
            )}
          </div>
        ) : (
          <EmptyState
            title="Operator access unavailable"
            description="Reload the dashboard to retry loading the admin access controls."
          />
        )}
      </SectionCard>
      </div>
    </div>
  );
}

function DashboardPage() {
  const { user, updateUser } = useAuth();
  const isMobile = useIsMobile();
  const [dashboard, setDashboard] = useState(null);
  const [operatorAccessData, setOperatorAccessData] = useState(null);
  const [rosterMeta, setRosterMeta] = useState(null);
  const [rosterUploadFile, setRosterUploadFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSavingOperatorAccess, setIsSavingOperatorAccess] = useState(false);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isUploadingRoster, setIsUploadingRoster] = useState(false);
  const [operatorGrant, setOperatorGrant] = useState({
    patient_id: "",
    operator_user_id: "",
    expires_at: dayjs().add(24, "hour").format("YYYY-MM-DDTHH:mm"),
  });

  useEffect(() => {
    let ignore = false;

    async function loadDashboard() {
      try {
        const [data, accessData, rosterData] = await Promise.all([
          api.get("/dashboard"),
          user.role === "admin" ? api.get("/dashboard/operator-access") : Promise.resolve(null),
          ["admin", "doctor", "operator"].includes(user.role)
            ? api.get("/dashboard/roster")
            : Promise.resolve(null),
        ]);

        if (!ignore) {
          setDashboard(data);
          setOperatorAccessData(accessData);
          setRosterMeta(rosterData);
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
  }, [user.role]);

  async function handleUploadRoster(event) {
    event.preventDefault();
    if (!rosterUploadFile) {
      toast.error("Please choose a PDF roster file first.");
      return;
    }

    setIsUploadingRoster(true);
    try {
      const formData = new FormData();
      formData.append("roster", rosterUploadFile);
      const payload = await api.post("/dashboard/roster", formData);
      setRosterMeta(payload);
      setRosterUploadFile(null);
      toast.success("Roster PDF uploaded.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsUploadingRoster(false);
    }
  }

  async function handleOpenRosterPdf() {
    if (!rosterMeta?.has_roster) {
      toast.error("Roster PDF is not uploaded yet.");
      return;
    }

    try {
      const file = await api.getBlob("/dashboard/roster/file");
      const blobUrl = window.URL.createObjectURL(file.blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60 * 1000);
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function refreshOperatorAccess() {
    if (user.role !== "admin") {
      return;
    }

    const data = await api.get("/dashboard/operator-access");
    setOperatorAccessData(data);
  }

  async function handleGrantOperatorAccess(event) {
    event.preventDefault();
    setIsSavingOperatorAccess(true);

    try {
      await api.post("/dashboard/operator-access", {
        patient_id: Number(operatorGrant.patient_id),
        operator_user_id: Number(operatorGrant.operator_user_id),
        expires_at: new Date(operatorGrant.expires_at).toISOString(),
      });

      await refreshOperatorAccess();
      setOperatorGrant({
        patient_id: "",
        operator_user_id: "",
        expires_at: dayjs().add(24, "hour").format("YYYY-MM-DDTHH:mm"),
      });
      toast.success("Temporary operator access granted.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSavingOperatorAccess(false);
    }
  }

  async function handleRevokeOperatorAccess(accessId) {
    try {
      await api.delete(`/dashboard/operator-access/${accessId}`);
      await refreshOperatorAccess();
      toast.success("Operator access removed.");
    } catch (error) {
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
    return <MobileLauncher user={user} />;
  }

  if (user.role === "doctor") {
    return (
      <DoctorDashboardView
        dashboard={dashboard}
        isSavingStatus={isSavingStatus}
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
        isSavingStatus={isSavingStatus}
        onOpenRosterPdf={handleOpenRosterPdf}
        onStatusChange={handleStatusChange}
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
      rosterMeta={rosterMeta}
      rosterUploadFile={rosterUploadFile}
      setRosterUploadFile={setRosterUploadFile}
      isUploadingRoster={isUploadingRoster}
      handleUploadRoster={handleUploadRoster}
      isSavingStatus={isSavingStatus}
      onStatusChange={handleStatusChange}
      operatorAccessData={operatorAccessData}
      operatorGrant={operatorGrant}
      setOperatorGrant={setOperatorGrant}
      user={user}
      isSavingOperatorAccess={isSavingOperatorAccess}
      handleGrantOperatorAccess={handleGrantOperatorAccess}
      handleRevokeOperatorAccess={handleRevokeOperatorAccess}
    />
  );
}

export default DashboardPage;
