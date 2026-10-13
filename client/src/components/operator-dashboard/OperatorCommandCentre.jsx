import dayjs from "dayjs";
import {
  ArrowUpRight,
  CalendarClock,
  ClipboardList,
  Package,
  ReceiptText,
  UserPlus,
} from "lucide-react";
import { Link } from "react-router-dom";
import HcmBulletinBanner from "../HcmBulletinBanner.jsx";
import OperationStatusSelector from "../OperationStatusSelector.jsx";
import { cx } from "../../lib/utils.js";
import OperatorPolicyVerifier from "./OperatorPolicyVerifier.jsx";
import OperatorTeleconsultationPanel from "./OperatorTeleconsultationPanel.jsx";
import {
  formatReviewCardSupport,
  getOperatorDisplayName,
  getTimeOfDayGreeting,
} from "./operatorDashboardCopy.js";
import "./operatorDashboard.css";

function OperatorWorkflowCard({
  to,
  title,
  status,
  support,
  action,
  icon: Icon,
  value = null,
  variant = "default",
}) {
  return (
    <Link to={to} className={cx("ocs-cc-card px-3.5 py-3", variant !== "default" && `ocs-cc-card--${variant}`)}>
      <span
        className={cx(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          variant === "create"
            ? "bg-[#1a7f7a] text-white"
            : variant === "amber"
              ? "bg-[#f7ba24]/18 text-[#8a6a12]"
              : variant === "live"
                ? "bg-[#2bccc4]/16 text-[#1a7f7a]"
                : "border border-[#2bccc4]/20 bg-[#2bccc4]/10 text-[#1a7f7a]",
        )}
      >
        <Icon className="size-5" strokeWidth={2.15} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[0.95rem] font-semibold tracking-tight text-[#203f42]">{title}</p>
        {status ? <p className="mt-0.5 text-sm font-medium text-[#203f42]">{status}</p> : null}
        {support ? <p className="mt-0.5 text-xs leading-5 text-[#5f7476]">{support}</p> : null}
        <span
          className={cx(
            "mt-2 inline-flex items-center gap-1 text-xs font-semibold",
            variant === "amber" ? "text-[#8a6a12]" : "text-[#1a7f7a]",
          )}
        >
          {action}
          <ArrowUpRight className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
        </span>
      </div>
      {value != null ? (
        <p className="shrink-0 font-display text-2xl font-semibold tabular-nums leading-none text-[#203f42]">{value}</p>
      ) : null}
    </Link>
  );
}

function OperatorLiveMonitoringPanel({ metrics }) {
  const unassigned = Array.isArray(metrics?.visit_requests?.unassigned)
    ? metrics.visit_requests.unassigned
    : [];
  const unassignedCount = Number(metrics?.visit_requests?.unassigned_count ?? unassigned.length);
  const empty = unassigned.length === 0;

  return (
    <section className="ocs-cc-panel flex flex-col px-5 py-4" aria-labelledby="ocs-cc-live-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="ocs-cc-live-heading"
            className="flex items-center gap-2 font-display text-base font-semibold text-[#203f42]"
          >
            <span className="ocs-cc-pulse" aria-hidden="true" />
            Live visit requests
          </h2>
          <p className="mt-0.5 text-xs text-[#5f7476]">Monitoring OCS Care</p>
        </div>
        <Link
          to="/visit-requests"
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-[#1a7f7a] transition hover:text-[#203f42]"
        >
          Open live board
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>

      {empty ? (
        <div className="mt-4">
          <p className="font-display text-base font-semibold text-[#203f42]">No requests waiting</p>
          <p className="mt-1 text-sm leading-6 text-[#5f7476]">
            {unassignedCount === 0
              ? "New requests from OCS Care will appear here automatically."
              : "No unassigned visit requests in this list."}
          </p>
          <p className="mt-1 text-xs text-[#5f7476]">Monitoring in real time</p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {unassigned.map((request) => (
            <li key={`request-${request.id}`}>
              <Link
                to="/visit-requests"
                className="flex items-start justify-between gap-3 py-2.5 transition hover:bg-slate-50"
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
      )}
    </section>
  );
}

function OperatorPulseRow({ to = null, icon: Icon, label, value, tone = "default" }) {
  const content = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#2bccc4]/10 text-[#1a7f7a]">
        <Icon className="size-4" strokeWidth={2.1} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium text-[#203f42]">{label}</span>
      <span
        className={cx(
          "shrink-0 font-display text-lg font-semibold tabular-nums",
          tone === "warning" ? "text-[#b47b08]" : "text-[#203f42]",
        )}
      >
        {value}
      </span>
      {to ? <ArrowUpRight className="size-3.5 shrink-0 text-[#5f7476]" aria-hidden="true" /> : null}
    </>
  );

  if (!to) {
    return <div className="ocs-cc-pulse-row ocs-cc-pulse-row--static px-1.5 py-1">{content}</div>;
  }

  return (
    <Link to={to} className="ocs-cc-pulse-row px-1.5 py-1">
      {content}
    </Link>
  );
}

function OperatorOperationalPulse({ counts, lowStockAlert }) {
  const lowStockCount = Number(lowStockAlert?.total_items || 0);

  return (
    <section className="ocs-cc-side-card px-4 py-4" aria-labelledby="ocs-cc-pulse-heading">
      <h2 id="ocs-cc-pulse-heading" className="font-display text-base font-semibold text-[#203f42]">
        Operational pulse
      </h2>
      <div className="mt-3 space-y-1">
        <OperatorPulseRow
          icon={Package}
          label="Low stock alert"
          tone={lowStockAlert?.triggered ? "warning" : "default"}
          to="/inventory"
          value={lowStockCount}
        />
        <OperatorPulseRow
          icon={ReceiptText}
          label="Payment follow-up"
          to="/operator/pending-payment"
          value={counts.unpaidThisWeek}
        />
      </div>
    </section>
  );
}

export default function OperatorCommandCentre({
  user,
  counts,
  operatorMetrics,
  onStatusChange,
  isSavingStatus,
  latestHcmPost = null,
  lowStockAlert = null,
}) {
  const firstName = getOperatorDisplayName(user);
  const greeting = getTimeOfDayGreeting();
  const reviews = Number(counts.reviews || 0);
  const overdueReviews = Number(counts.overdueReviews || 0);
  const reviewSupport = [
    formatReviewCardSupport(reviews),
    overdueReviews > 0 ? `${overdueReviews} overdue` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="ocs-cc space-y-4">
      <header className="ocs-cc-header" aria-label="Operator overview">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#203f42]">
            {greeting}, {firstName}.
          </h1>
          <p className="mt-1 text-sm text-[#5f7476]">{dayjs().format("dddd D MMMM")}</p>
        </div>
        <div className="ocs-cc-header-tools">
          <div className="ocs-cc-availability">
            <span className="font-display text-2xl font-semibold tabular-nums text-[#203f42]">{counts.availableNow}</span>
            <span className="text-xs text-[#5f7476]">Doctors available now</span>
          </div>
          <OperationStatusSelector
            align="left"
            disabled={isSavingStatus}
            onChange={onStatusChange}
            options={["active", "offline"]}
            showLabel={false}
            value={user.operation_status}
          />
        </div>
      </header>

      <section aria-label="Operator workflows" className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <OperatorWorkflowCard
          action="Start intake"
          icon={UserPlus}
          status="Start a new care record"
          title="Add a patient"
          to="/patients/add"
          variant="create"
        />
        <OperatorWorkflowCard
          action="Manage calls"
          icon={ClipboardList}
          title="Manage teleconsultations"
          to="/teleconsultations"
        />
        <OperatorWorkflowCard
          action="Review now"
          icon={CalendarClock}
          status={reviews > 0 ? null : "Review queue clear"}
          support={reviewSupport}
          title="Review appointments"
          to="/operator/long-term-review"
          value={reviews > 0 ? reviews : null}
          variant={reviews > 0 ? "amber" : "default"}
        />
      </section>

      <div className="grid w-full grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <OperatorLiveMonitoringPanel metrics={operatorMetrics} />
        <OperatorTeleconsultationPanel readOnly={Boolean(user.is_read_only)} />
      </div>

      <div className="grid w-full grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,0.9fr)]">
        <OperatorPolicyVerifier />
        <OperatorOperationalPulse counts={counts} lowStockAlert={lowStockAlert} />
      </div>

      {latestHcmPost ? <HcmBulletinBanner post={latestHcmPost} /> : null}

    </div>
  );
}
