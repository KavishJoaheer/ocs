import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import {
  Activity,
  ArrowUpRight,
  BellRing,
  CalendarClock,
  ClipboardList,
  CreditCard,
  DollarSign,
  HeartPulse,
  MapPinned,
  Package,
  PhoneCall,
  Search,
  ShieldCheck,
  Stethoscope,
  Upload,
  UserPlus,
  UserRound,
  UsersRound,
} from "lucide-react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import OperationStatusSelector from "../components/OperationStatusSelector.jsx";
import SectionCard from "../components/SectionCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { api } from "../lib/api.js";
import { formatCurrency, formatDateTime, statusLabel, truncate } from "../lib/format.js";
import { cx } from "../lib/utils.js";

function buildDoctorMobileSubtitle(dashboard) {
  const lowStock = dashboard?.doctor_low_stock_alert;
  const inventoryStamp = lowStock?.triggered
    ? `${Number(lowStock.total_items || 0)} Item${Number(lowStock.total_items || 0) === 1 ? "" : "s"} Low`
    : "Healthy";
  return `${dayjs().format("dddd, MMMM D")} — Bag Inventory: ${inventoryStamp}`;
}

function buildDoctorMobileCards(dashboard) {
  const summary = dashboard?.doctorWorkspace?.summary || {};
  const activePatients = Number(summary.activeAssignedPatientsCount ?? 0);
  const unpaidBills = Number(summary.pendingPaymentsCount ?? 0);
  const lowStock = dashboard?.doctor_low_stock_alert;
  const lowCount = Number(lowStock?.total_items || 0);

  return [
    {
      label: "Patient Directory",
      icon: UserRound,
      to: "/patients",
      meta: `${activePatients} Assigned Patient${activePatients === 1 ? "" : "s"}`,
    },
    {
      label: "Add a Patient",
      icon: UserPlus,
      to: "/patients/add",
      meta: null,
    },
    {
      label: "Billing & Finance",
      icon: CreditCard,
      to: "/billing",
      meta: `${unpaidBills} Unpaid ${unpaidBills === 1 ? "Entry" : "Entries"}`,
    },
    {
      label: "Inventory",
      icon: Package,
      to: "/inventory",
      meta: lowStock?.triggered ? `${lowCount} Item${lowCount === 1 ? "" : "s"} Low` : "Healthy",
    },
  ];
}

function DoctorMobileLauncher({ user, dashboard }) {
  const firstName = (user.full_name || "").split(" ")[0] || "Doctor";
  const cards = buildDoctorMobileCards(dashboard);

  return (
    <motion.div className="mx-auto flex w-full max-w-md min-w-0 flex-col px-1">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight text-gray-900">Hello, Dr. {firstName}</h1>
        <p className="mt-1.5 text-sm text-slate-600">{buildDoctorMobileSubtitle(dashboard)}</p>
      </header>

      <nav className="flex flex-col gap-2" aria-label="Doctor quick actions">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              to={card.to}
              className="group flex items-center gap-3 rounded-2xl border border-[rgba(65,200,198,0.18)] bg-white px-3.5 py-3 shadow-[0_8px_24px_rgba(34,72,91,0.06)] transition active:scale-[0.99] active:bg-slate-50/80"
            >
              <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-[#4FB8B3]/25 bg-[#ecf8f7] text-[#2d8f98]">
                <Icon className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-snug text-slate-900">{card.label}</p>
                {card.meta ? (
                  <p className="mt-0.5 text-xs font-medium text-teal-600">{card.meta}</p>
                ) : null}
              </div>
              <ArrowUpRight className="size-4 shrink-0 text-[#2d8f98]/70" />
            </Link>
          );
        })}
      </nav>
    </motion.div>
  );
}

function MobileLauncher({ user, dashboard }) {
  const firstName = (user.full_name || "").split(" ")[0] || "Doctor";
  const isDoctor = user.role === "doctor";

  if (isDoctor) {
    return <DoctorMobileLauncher user={user} dashboard={dashboard} />;
  }

  const greeting = `Hello, ${firstName}`;

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

function QuickLinkCard({ id, title, description, to, onClick }) {
  const cardClasses =
    "rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-white/88 p-5 text-left shadow-[0_24px_64px_rgba(34,72,91,0.08)] transition hover:-translate-y-0.5 hover:shadow-[0_28px_70px_rgba(34,72,91,0.12)]";

  const content = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>
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
  flat = false,
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
    flat
      ? dark
        ? "border-white/25 bg-[linear-gradient(145deg,#2c9099_0%,#276f78_48%,#215f67_100%)] text-white hover:border-white/35"
        : "border-gray-200 bg-white text-slate-950 hover:border-gray-300"
      : dark
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
              "text-xs font-semibold uppercase tracking-wider",
              dark ? "text-white/50" : "text-gray-400",
            )}
          >
            {eyebrow}
          </p>
        ) : null}
        <p
          className={cx(
            "break-words text-base font-medium tracking-tight",
            eyebrow ? (size === "hero" ? "mt-2" : "mt-1") : size === "hero" ? "mt-2" : "mt-1",
            dark ? "text-white" : "text-slate-950",
          )}
        >
          {title}
        </p>
        {subtitle ? (
          <p
            className={cx(
              "mt-2 break-words text-sm leading-6",
              dark ? "line-clamp-3 text-white/90" : "text-[#51717b]",
            )}
          >
            {subtitle}
          </p>
        ) : null}
      </div>

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
      <p className="pl-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
        {eyebrow}
      </p>
      <h2 className="mt-3 pl-2 font-display text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">
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
          <div className="text-left text-sm font-semibold uppercase tracking-[0.08em] text-[#2e5f68] xl:text-right xl:pt-1">
            {statusMarkup}
          </div>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-2">
          <div className="rounded-[30px] border border-[rgba(106,129,138,0.34)] bg-[rgba(255,255,255,0.38)] px-6 py-6">
            <p className="text-lg font-semibold text-slate-950 md:text-xl">{leftTitle}</p>
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
            <p className="text-lg font-semibold text-slate-950 md:text-xl">{rightTitle}</p>
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

function OperationsDashboardDesktopHeader({ title, roleBadge, statusMarkup, beforeStatus }) {
  return (
    <div className="mb-2 hidden items-start justify-between gap-4 border-b border-[rgba(65,200,198,0.14)] pb-3 md:flex">
      <div className="min-w-0 flex-1 pr-4">
        <h1 className="font-display text-3xl font-semibold leading-tight tracking-tight text-slate-950 md:text-[2.125rem] md:leading-snug">
          {title}
        </h1>
      </div>
      <div className="flex min-w-0 shrink-0 flex-col items-end gap-2">
        <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-[rgba(65,200,198,0.18)] bg-white/78 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#2d8f98]">
          <ShieldCheck className="size-3.5 shrink-0" />
          <span className="truncate">{roleBadge}</span>
        </div>
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
                <p className="mt-2 text-lg font-semibold tracking-tight text-slate-950 md:text-xl">
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
              <p className="mt-2 text-lg font-semibold tracking-tight text-slate-950 md:text-xl">
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
    <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard label="Total patients" value={dashboard.summary.totalPatients} />
      <SummaryCard label="Today's appointments" value={dashboard.summary.todaysAppointments} />
      <SummaryCard label="Pending bills" value={dashboard.summary.pendingBills} />
      <SummaryCard label="Total revenue" value={formatCurrency(dashboard.summary.totalRevenue)} />
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

function doctorOperationStatusDotClass(status) {
  switch (String(status || "").toLowerCase()) {
    case "available":
      return "bg-emerald-500";
    case "active":
      return "bg-amber-400 shadow-[0_0_0_2px_rgba(251,191,36,0.35)]";
    case "offline":
      return "bg-slate-300";
    default:
      return "bg-slate-200";
  }
}

function DoctorStatusPanel({ doctors = [] }) {
  const availableCount = doctors.filter((doctor) => doctor.operation_status === "available").length;
  const activeCount = doctors.filter((doctor) => doctor.operation_status === "active").length;
  const offlineCount = doctors.filter((doctor) => doctor.operation_status === "offline").length;

  return (
    <div className="rounded-[34px] border border-[rgba(65,200,198,0.18)] bg-white/82 px-4 py-4 shadow-[0_20px_50px_rgba(34,72,91,0.08)] backdrop-blur md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Doctors live status
          </p>
          <p className="mt-1.5 text-lg font-semibold tracking-tight text-slate-950 md:text-xl">
            Doctor availability overview
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            Available {availableCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="size-2.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_0_2px_rgba(251,191,36,0.35)]"
              aria-hidden
            />
            Active {activeCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-full bg-slate-300" aria-hidden />
            Offline {offlineCount}
          </span>
        </div>
      </div>

      <div className="mt-3 max-h-[280px] divide-y divide-slate-200/80 overflow-y-auto pr-0.5">
        {doctors.length ? (
          doctors.map((doctor) => {
            const status = doctor.operation_status || "not linked";
            const dotClass = doctorOperationStatusDotClass(status);
            const label = statusLabel(status);
            return (
              <div key={doctor.id} className="flex min-w-0 items-center gap-3 py-2.5">
                <span className="sr-only">
                  {doctor.full_name}
                  {label ? `, ${label}` : ""}
                  {doctor.operation_status_updated_at
                    ? `, updated ${dayjs(doctor.operation_status_updated_at).format("MMM D, YYYY [at] h:mm A")}`
                    : ""}
                </span>
                <div
                  className={cx("size-3 shrink-0 rounded-full", dotClass)}
                  title={label}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-semibold text-slate-950">{doctor.full_name}</span>
                <span className="shrink-0 text-xs font-normal text-gray-400">
                  {doctor.operation_status_updated_at
                    ? dayjs(doctor.operation_status_updated_at).format("MMM D, YYYY [at] h:mm A")
                    : "No update yet"}
                </span>
              </div>
            );
          })
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

function DoctorPatientQuickSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  function submit() {
    const trimmed = query.trim();
    navigate(trimmed ? `/patients?search=${encodeURIComponent(trimmed)}` : "/patients");
  }

  return (
    <div className="relative hidden min-w-0 max-w-[11rem] flex-1 md:block lg:max-w-[14rem]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        enterKeyHint="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Search patients…"
        aria-label="Search patients"
        className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#2d8f98]"
      />
    </div>
  );
}

function DoctorScheduledVisitsWidget({ today, visits, listPath }) {
  const todayRows = useMemo(() => {
    const rows = visits || [];
    return rows.filter((row) => row.appointment_date === today).slice(0, 3);
  }, [visits, today]);

  return (
    <div className="relative flex min-h-[140px] flex-col overflow-hidden rounded-[30px] border border-gray-200 bg-white px-5 py-5 md:px-6 md:py-5">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-slate-50 text-[#2d8f98]">
            <CalendarClock className="size-5" />
          </div>
          <p className="text-base font-medium leading-snug tracking-tight text-slate-950">Scheduled visits</p>
        </div>
        <Link
          to={listPath}
          className="shrink-0 text-xs font-semibold text-[#2d8f98] transition hover:text-[#236d75] hover:underline"
        >
          View all
        </Link>
      </div>
      <div className="mt-4 flex flex-1 flex-col gap-3">
        {todayRows.length === 0 ? (
          <p className="text-sm text-slate-500">No visits scheduled for today.</p>
        ) : (
          todayRows.map((row) => (
            <div key={row.id} className="min-w-0 border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
              <p className="truncate text-sm font-semibold text-slate-900">{row.patient_name}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                {formatDateTime(row.appointment_date, row.appointment_time)}
                {row.location ? (
                  <>
                    <span className="text-slate-300"> · </span>
                    <span className="inline-flex items-start gap-1">
                      <MapPinned className="mt-0.5 size-3 shrink-0 text-slate-400" aria-hidden />
                      <span>{row.location}</span>
                    </span>
                  </>
                ) : null}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function OperatorScheduledVisitsMetricCard({ summary, listPath }) {
  const pending = Number(summary?.pendingDispatchCount ?? 0);
  const today = Number(summary?.scheduledTodayCount ?? 0);
  const workloadLine = `${pending} pending dispatch · ${today} scheduled today`;

  return (
    <Link
      to={listPath}
      className="group relative flex min-h-[140px] flex-col overflow-hidden rounded-[30px] border border-gray-200 bg-white px-5 py-5 transition hover:border-[#2d8f98]/35 md:px-6 md:py-5"
    >
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 pb-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-slate-50 text-[#2d8f98]">
            <CalendarClock className="size-5" />
          </div>
          <p className="text-base font-medium leading-snug tracking-tight text-slate-950">Scheduled visits</p>
        </div>
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-[#2d8f98] transition group-hover:border-[#2d8f98]/30">
          <ArrowUpRight className="size-4" />
        </span>
      </div>
      <p className="mt-4 text-base font-semibold leading-snug tracking-tight text-[#1e3d44]">{workloadLine}</p>
      <p className="mt-2 text-xs font-medium text-slate-500">Across all doctors · live from appointments</p>
    </Link>
  );
}

function OperatorHealthPlansMetricCard({ activeCount, listPath }) {
  return (
    <Link
      to={listPath}
      className="group relative flex min-h-[140px] flex-col justify-between overflow-hidden rounded-[30px] border border-gray-200 bg-[linear-gradient(160deg,rgba(238,249,249,0.98),rgba(224,239,241,0.94))] px-5 py-5 transition hover:border-[#2d8f98]/40 md:px-6 md:py-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-white text-[#2d8f98]">
            <HeartPulse className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Subscription management</p>
            <p className="mt-1.5 text-base font-medium leading-snug tracking-tight text-slate-950">Health Plans</p>
          </div>
        </div>
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white/90 text-[#2d8f98] transition group-hover:border-[#2d8f98]/30">
          <ArrowUpRight className="size-4" />
        </span>
      </div>
      <div className="mt-6 flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="text-4xl font-semibold tabular-nums tracking-tight text-slate-950">{activeCount}</p>
        <p className="max-w-[12rem] pb-1 text-sm font-medium leading-snug text-slate-600">Active subscription patients</p>
      </div>
    </Link>
  );
}

function DoctorAssignedPatientsMetricCard({ activeCount, listPath }) {
  return (
    <Link
      to={listPath}
      className="group relative flex min-h-[140px] flex-col justify-between overflow-hidden rounded-[30px] border border-gray-200 bg-[linear-gradient(160deg,rgba(238,249,249,0.98),rgba(224,239,241,0.94))] px-5 py-5 transition hover:border-[#2d8f98]/40 md:px-6 md:py-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-white text-[#2d8f98]">
          <UsersRound className="size-5" />
        </div>
        <span className="inline-flex size-9 items-center justify-center rounded-full border border-gray-200 bg-white/90 text-[#2d8f98] transition group-hover:border-[#2d8f98]/30">
          <ArrowUpRight className="size-4" />
        </span>
      </div>
      <div className="mt-6 text-center">
        <p className="text-4xl font-semibold tabular-nums tracking-tight text-slate-950">{activeCount}</p>
        <p className="mt-1 text-sm font-medium text-slate-600">Active patients</p>
      </div>
    </Link>
  );
}

function PersonalOperationOverviewCard({ title, subtitle, accent = false, to, icon: Icon, metricLine }) {
  const classes = cx(
    "group relative overflow-hidden rounded-[30px] border border-gray-200 px-5 py-5 transition duration-200 md:px-6 md:py-5",
    accent
      ? "bg-[linear-gradient(160deg,rgba(238,249,249,0.98),rgba(224,239,241,0.94))]"
      : "bg-white",
    to ? "block hover:border-gray-300" : "",
  );

  const content = (
    <>
      <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-[radial-gradient(circle,rgba(65,200,198,0.12),transparent_68%)] blur-2xl" />

      <div className="relative z-10 flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <div
            className={cx(
              "flex size-12 shrink-0 items-center justify-center rounded-2xl border border-gray-200 bg-slate-50",
              accent ? "text-[#2d8f98]" : "text-[#5c7c86]",
            )}
          >
            {Icon ? <Icon className="size-5" /> : null}
          </div>

          {to ? (
            <span className="inline-flex size-9 items-center justify-center rounded-full border border-gray-200 bg-white text-[#2d8f98] transition group-hover:border-[#2d8f98]/30">
              <ArrowUpRight className="size-4" />
            </span>
          ) : null}
        </div>

        <p
          className={cx(
            "text-base font-medium leading-snug tracking-tight text-slate-950",
            metricLine ? "mt-4" : subtitle ? "mt-7" : "mt-5",
          )}
        >
          {title}
        </p>
        {metricLine ? (
          <p className="mt-2 text-sm font-semibold leading-snug text-[#2e5f68]">{metricLine}</p>
        ) : null}
        {subtitle ? (
          <p className="mt-4 max-w-[14rem] text-sm leading-7 text-[#496773] md:text-[1.01rem]">{subtitle}</p>
        ) : null}

        <div
          className={cx(
            "h-[3px] w-16 rounded-full",
            metricLine ? "mt-5" : subtitle ? "mt-6" : "mt-5",
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

function DoctorPersonalOperationUpdates({ dashboard }) {
  const today = dashboard?.periods?.today || "";
  const visits = dashboard?.scheduledVisits || [];
  const activeAssigned = Number(dashboard?.summary?.activeAssignedPatientsCount ?? 0);

  return (
    <div className="relative overflow-hidden rounded-[42px] border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.82),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(65,200,198,0.12),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.97),rgba(236,248,248,0.94))] p-5 md:p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_88%_16%,rgba(241,188,53,0.08),transparent_18%),radial-gradient(circle_at_70%_88%,rgba(65,200,198,0.08),transparent_18%)]" />

      <div className="relative z-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Clinical flow
        </p>
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-950 md:text-xl">
          Personal operation updates
        </h3>

        <div className="mt-4 h-px w-full bg-[linear-gradient(90deg,rgba(65,200,198,0.3),rgba(241,188,53,0.22),transparent)]" />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <DoctorScheduledVisitsWidget listPath="/doctor/scheduled-visits" today={today} visits={visits} />
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
          <DoctorAssignedPatientsMetricCard activeCount={activeAssigned} listPath="/doctor/assigned-patients" />
        </div>
      </div>
    </div>
  );
}

function OperatorPersonalOperationUpdates({ workspace }) {
  const summary = workspace?.summary || {};
  const pendingBills = Number(summary.pendingPaymentsCount ?? 0);
  const longTerm = Number(summary.longTermReviewCount ?? 0);
  const activeSubs = Number(summary.activeSubscriptionPatientsCount ?? 0);

  return (
    <div className="relative overflow-hidden rounded-[42px] border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.82),transparent_22%),radial-gradient(circle_at_bottom_right,rgba(65,200,198,0.12),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.97),rgba(236,248,248,0.94))] p-5 md:p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_88%_16%,rgba(241,188,53,0.08),transparent_18%),radial-gradient(circle_at_70%_88%,rgba(65,200,198,0.08),transparent_18%)]" />

      <div className="relative z-10">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Coordination flow
        </p>
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-slate-950 md:text-xl">
          Personal operation updates
        </h3>

        <div className="mt-4 h-px w-full bg-[linear-gradient(90deg,rgba(65,200,198,0.3),rgba(241,188,53,0.22),transparent)]" />

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <OperatorScheduledVisitsMetricCard summary={summary} listPath="/operator/scheduled-visits" />
          <PersonalOperationOverviewCard
            accent
            icon={CreditCard}
            metricLine={`${pendingBills} unpaid bill${pendingBills === 1 ? "" : "s"}`}
            title="Pending payment"
            to="/operator/pending-payment"
          />
          <PersonalOperationOverviewCard
            icon={Stethoscope}
            metricLine={`${longTerm} patient${longTerm === 1 ? "" : "s"} in active follow-up`}
            title="Long term review"
            to="/operator/long-term-review"
          />
          <OperatorHealthPlansMetricCard activeCount={activeSubs} listPath="/patients" />
        </div>
      </div>
    </div>
  );
}

function DoctorDashboardView({ user, dashboard, hcmLatestTitle, onStatusChange, isSavingStatus, onOpenRosterPdf, lowStockAlert }) {
  const monthLabel = dayjs().format("MMMM");

  return (
    <section className="relative mx-auto w-full min-w-0 max-w-[1180px] overflow-x-hidden overflow-y-hidden rounded-3xl border border-[rgba(65,200,198,0.18)] bg-[radial-gradient(circle_at_top_left,rgba(65,200,198,0.18),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(241,188,53,0.14),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.92)_0%,rgba(231,247,246,0.94)_100%)] p-3 shadow-[0_36px_100px_rgba(34,72,91,0.14)] md:rounded-[56px] md:p-5 lg:p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_14%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.52),transparent_20%),radial-gradient(circle_at_28%_82%,rgba(65,200,198,0.08),transparent_18%)]" />

      <div className="relative z-10">
        <OperationsDashboardDesktopHeader
          beforeStatus={<DoctorPatientQuickSearch />}
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
          <div className="mt-4 rounded-[28px] border border-rose-200 bg-rose-50 px-5 py-4">
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
              <div className="rounded-[24px] border border-gray-200 bg-white/90 p-4 md:rounded-[34px] md:p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Shifts
                </p>
                <p className="mt-2 text-lg font-semibold tracking-tight text-slate-950 md:text-xl">
                  My shifts
                </p>

                <div className="mt-4 space-y-4">
                  <DoctorDashboardTile
                    flat
                    eyebrow="Weekly schedule"
                    icon={CalendarClock}
                    size="hero"
                    title="Current week roster"
                    onClick={onOpenRosterPdf}
                  />
                  <DoctorDashboardTile
                    flat
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
                flat
                eyebrow="Health care manager"
                icon={BellRing}
                size="hero"
                subtitle={
                  hcmLatestTitle
                    ? truncate(hcmLatestTitle, 120)
                    : "No HCM announcements yet. Open news for updates."
                }
                title="Updates from HCM"
                to="/hcm-news"
              />
            </div>

            <DoctorPersonalOperationUpdates dashboard={dashboard} />
          </div>
        </div>
      </div>
    </section>
  );
}

function OperatorDashboardView({ user, dashboard, onStatusChange, isSavingStatus, onOpenRosterPdf }) {
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
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Shared roster
                </p>
                <p className="mt-2 text-lg font-semibold tracking-tight text-slate-950 md:text-xl">
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

            <OperatorPersonalOperationUpdates workspace={dashboard?.operatorWorkspace} />
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
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                OCS M&#201;DECINS
              </p>
              <h1 className="mt-1.5 font-display text-xl font-semibold leading-tight tracking-tight text-slate-950 md:text-2xl">
                Operations Dashboard
              </h1>
            </div>
          </div>

          <div className="mt-4">
            <DashboardSummaryCards dashboard={dashboard} />
          </div>

          <div className="mt-5 grid gap-6 xl:grid-cols-[1fr_1fr] xl:items-start">
            <DoctorStatusPanel doctors={dashboard.doctorStatuses} />
            <UpcomingAppointmentsPanel
              dashboard={dashboard}
              subtitle=""
              titleClassName="text-lg md:text-xl"
            />
          </div>

          <div className="mt-6 rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-white/74 p-5 shadow-[0_16px_34px_rgba(34,72,91,0.06)] md:p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Roster management
            </p>
            <p className="mt-2 text-lg font-semibold tracking-tight text-slate-950 md:text-xl">
              Current roster PDF
            </p>

            <form className="mt-4 flex flex-col gap-3 md:flex-row md:items-center" onSubmit={handleUploadRoster}>
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

      <div id="admin-operator-access">
        <SectionCard title="Operator access" subtitle="" titleClassName="text-lg md:text-xl">
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
                compact
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
  const [doctorHcmHeadline, setDoctorHcmHeadline] = useState(null);
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
        const [data, accessData, rosterData, doctorWorkspace] = await Promise.all([
          api.get("/dashboard"),
          user.role === "admin" ? api.get("/dashboard/operator-access") : Promise.resolve(null),
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

        let headline = null;
        if (user.role === "doctor") {
          try {
            const hcm = await api.get("/hcm-news");
            headline = String(hcm.posts?.[0]?.title || "").trim() || null;
          } catch {
            headline = null;
          }
        }

        if (!ignore) {
          setDashboard(merged);
          setOperatorAccessData(accessData);
          setRosterMeta(rosterData);
          setDoctorHcmHeadline(headline);
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
    return <MobileLauncher user={user} dashboard={dashboard} />;
  }

  if (user.role === "doctor") {
    return (
      <DoctorDashboardView
        dashboard={dashboard}
        hcmLatestTitle={doctorHcmHeadline}
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
        dashboard={dashboard}
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
