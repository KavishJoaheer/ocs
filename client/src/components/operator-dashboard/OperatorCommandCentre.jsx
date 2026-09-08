import dayjs from "dayjs";
import {
  ArrowUpRight,
  BellRing,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  Package,
  ReceiptText,
  Star,
  UserPlus,
} from "lucide-react";
import { Link } from "react-router-dom";
import HcmBulletinBanner from "../HcmBulletinBanner.jsx";
import OperationStatusSelector from "../OperationStatusSelector.jsx";
import { cx } from "../../lib/utils.js";
import {
  formatHealthPlanCount,
  formatHcmUnread,
  formatReviewCardSupport,
  getOperatorDisplayName,
  getTimeOfDayGreeting,
} from "./operatorDashboardCopy.js";
import "./operatorDashboard.css";

const CARE_NETWORK_C_NODES = [
  [51, 8],
  [22, 17],
  [6, 45],
  [12, 76],
  [39, 93],
  [68, 84],
  [83, 60],
];

const CARE_NETWORK_X_NODES = [
  [66.5, 7.5],
  [90.5, 7.5],
  [67.5, 31.5],
  [91.5, 31.5],
];

function OperatorCareNetworkArtwork() {
  return (
    <div className="ocs-cc-network-art" aria-hidden="true">
      <img
        alt=""
        className="ocs-cc-network-island"
        decoding="async"
        src="/ocs-mauritius-cinematic-v1.webp"
      />
      <div className="ocs-cc-network-mark">
        <span className="ocs-cc-network-mark-texture ocs-cc-network-mark-texture--c" />
        <svg className="ocs-cc-network-routes ocs-cc-network-routes--c" viewBox="0 0 100 100">
          <path
            className="ocs-cc-network-route ocs-cc-network-route--c"
            d="M 51 8 C 24 8, 6 25, 6 51 C 6 78, 25 94, 48 93 C 68 92, 80 79, 83 60"
          />
        </svg>
        {CARE_NETWORK_C_NODES.map(([left, top], index) => (
          <span
            className="ocs-cc-network-node ocs-cc-network-node--c"
            key={`c-node-${left}-${top}`}
            style={{ "--node-delay": `${0.64 + index * 0.08}s`, left: `${left}%`, top: `${top}%` }}
          />
        ))}
        <div className="ocs-cc-network-x">
          <span className="ocs-cc-network-mark-texture ocs-cc-network-mark-texture--x" />
          <svg className="ocs-cc-network-routes ocs-cc-network-routes--x" viewBox="0 0 100 100">
            <path className="ocs-cc-network-route ocs-cc-network-route--x" d="M 66.5 7.5 L 91.5 31.5" />
            <path className="ocs-cc-network-route ocs-cc-network-route--x" d="M 90.5 7.5 L 67.5 31.5" />
          </svg>
          {CARE_NETWORK_X_NODES.map(([left, top], index) => (
            <span
              className="ocs-cc-network-node ocs-cc-network-node--x"
              key={`x-node-${left}-${top}`}
              style={{ "--node-delay": `${1.48 + index * 0.07}s`, left: `${left}%`, top: `${top}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

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
      </div>
      <div className="flex shrink-0 flex-col items-end justify-center gap-1 text-right">
        {value != null ? (
          <p className="font-display text-2xl font-semibold tabular-nums leading-none text-[#203f42]">{value}</p>
        ) : null}
        <span
          className={cx(
            "inline-flex items-center gap-1 text-xs font-semibold",
            variant === "amber" ? "text-[#8a6a12]" : "text-[#1a7f7a]",
          )}
        >
          {action}
          <ArrowUpRight className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
        </span>
      </div>
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
          icon={CalendarClock}
          label="Review appointments due"
          to="/operator/long-term-review"
          value={counts.reviews}
        />
        <OperatorPulseRow
          icon={Package}
          label="Low stock alert"
          tone={lowStockAlert?.triggered ? "warning" : "default"}
          to="/inventory"
          value={lowStockCount}
        />
        <OperatorPulseRow
          icon={ReceiptText}
          label="Pending claims"
          value={counts.pendingClaims}
        />
      </div>
    </section>
  );
}

function OperatorUtilityBar({
  counts,
  monthLabel,
  rosterMeta,
  onOpenRosterPdf,
  hcmUnreadCount = 0,
}) {
  const hasRoster = Boolean(rosterMeta?.has_roster);

  return (
    <div className="ocs-cc-utility p-3">
      <div className="flex min-w-0 items-center gap-3 px-2 py-1.5">
        <CalendarDays className="size-4 shrink-0 text-[#5f7476]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[#203f42]">{monthLabel} roster</p>
          <Link
            to="/operator/monthly-roster"
            className="text-xs font-semibold text-[#1a7f7a] hover:text-[#203f42]"
          >
            Open roster
          </Link>
        </div>
        <button
          type="button"
          onClick={onOpenRosterPdf}
          disabled={!hasRoster}
          className="ocs-cc-pdf shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
          title={hasRoster ? "Download roster PDF" : "Roster PDF is not uploaded yet"}
        >
          PDF
        </button>
      </div>

      <Link
        to="/patients?filter=subscribed"
        className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-[#f3f7f4]"
      >
        <Star className="size-4 shrink-0 text-[#5f7476]" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-[#203f42]">Health plans</p>
        <span className="shrink-0 text-xs font-semibold text-[#5f7476]">
          {formatHealthPlanCount(counts.healthPlans)}
        </span>
      </Link>

      {hcmUnreadCount > 0 ? (
        <Link
          to="/hcm-news"
          className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 transition hover:bg-[#f3f7f4]"
        >
          <BellRing className="size-4 shrink-0 text-[#5f7476]" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-[#203f42]">HCM</p>
          <span className="shrink-0 text-xs font-semibold text-[#5f7476]">
            {formatHcmUnread(hcmUnreadCount)}
          </span>
        </Link>
      ) : null}
    </div>
  );
}

export default function OperatorCommandCentre({
  user,
  counts,
  operatorMetrics,
  onStatusChange,
  isSavingStatus,
  latestHcmPost = null,
  rosterMeta = null,
  onOpenRosterPdf,
  hcmUnreadCount = 0,
  lowStockAlert = null,
}) {
  const firstName = getOperatorDisplayName(user);
  const greeting = getTimeOfDayGreeting();
  const monthLabel = dayjs().format("MMMM");
  const reviews = Number(counts.reviews || 0);
  const completedVisitsThisWeek = Number(counts.completedVisitsThisWeek || 0);

  return (
    <div className="ocs-cc space-y-4">
      <section className="ocs-cc-hero px-5 py-5 lg:px-6 lg:py-5">
        <OperatorCareNetworkArtwork />
        <div className="ocs-cc-hero-body">
          <div className="min-w-0">
            <h1 className="font-display text-[1.7rem] font-semibold leading-tight tracking-tight text-white lg:text-[1.85rem]">
              {greeting}, {firstName}.
            </h1>
            <p className="mt-1.5 text-sm font-medium text-[#d5ecea]">Your OCS care network is ready.</p>
            <p className="mt-1.5 text-sm font-medium text-[#f7ba24]">{dayjs().format("dddd D MMMM")}</p>
            <div className="mt-3 inline-flex rounded-xl border border-white/12 bg-white/8 px-2.5 py-1.5">
              <OperationStatusSelector
                align="left"
                className="mt-0"
                disabled={isSavingStatus}
                onChange={onStatusChange}
                options={["active", "offline"]}
                tone="onDark"
                value={user.operation_status}
              />
            </div>
          </div>
          <div className="ocs-cc-hero-summary relative z-[2] min-w-0 lg:text-right">
            <div className="ocs-cc-hero-on-call">
              <p className="font-display text-4xl font-semibold tabular-nums leading-none text-white lg:text-[2.65rem]">
                {counts.onCall}
              </p>
              <p className="mt-1.5 text-xs font-medium text-[#d5ecea]">Doctors on call now</p>
            </div>
            <p className="ocs-cc-hero-tagline">Connecting homes through care</p>
          </div>
        </div>
      </section>

      <section aria-label="Operator trial workflows" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <OperatorWorkflowCard
          action="Start intake"
          icon={UserPlus}
          status="Start a new care record"
          title="Add a patient"
          to="/patients/add"
          variant="create"
        />
        <OperatorWorkflowCard
          action="View week"
          icon={CalendarCheck}
          support="This week · since Monday"
          title="Visits completed"
          to="/operator/current-week-roster"
          value={completedVisitsThisWeek}
        />
        <OperatorWorkflowCard
          action="Review now"
          icon={CalendarClock}
          status={reviews > 0 ? null : "Review queue clear"}
          support={formatReviewCardSupport(reviews)}
          title="Review appointments"
          to="/operator/long-term-review"
          value={reviews > 0 ? reviews : null}
          variant={reviews > 0 ? "amber" : "default"}
        />
      </section>

      {latestHcmPost ? <HcmBulletinBanner post={latestHcmPost} /> : null}

      <div className="grid w-full grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,0.9fr)]">
        <OperatorLiveMonitoringPanel metrics={operatorMetrics} />
        <OperatorOperationalPulse counts={counts} lowStockAlert={lowStockAlert} />
      </div>

      <OperatorUtilityBar
        counts={counts}
        hcmUnreadCount={hcmUnreadCount}
        monthLabel={monthLabel}
        onOpenRosterPdf={onOpenRosterPdf}
        rosterMeta={rosterMeta}
      />
    </div>
  );
}
