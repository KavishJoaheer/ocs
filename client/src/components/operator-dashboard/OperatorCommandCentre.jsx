import dayjs from "dayjs";
import {
  ArrowUpRight,
  CalendarClock,
  Package,
  ReceiptText,
  UserPlus,
} from "lucide-react";
import { Link } from "react-router-dom";
import HcmBulletinBanner from "../HcmBulletinBanner.jsx";
import OperationStatusSelector from "../OperationStatusSelector.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import { cx } from "../../lib/utils.js";
import OperatorPolicyVerifier from "./OperatorPolicyVerifier.jsx";
import OperatorDesktopLiveRequests from "./OperatorDesktopLiveRequests.jsx";
import {
  getOperatorDisplayName,
  getTimeOfDayGreeting,
} from "./operatorDashboardCopy.js";
import "./operatorDashboard.css";

function OperatorPulseRow({ to = null, icon: Icon, label, value, tone = "default" }) {
  const content = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#2bccc4]/10 text-[#1a7f7a]">
        <Icon className="size-4" strokeWidth={2.1} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium text-[#203f42]">{label}</span>
      <span
        className={cx(
          "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
          tone === "warning" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-[#203f42]",
        )}
      >
        {value}
      </span>
      {to ? <ArrowUpRight className="size-3.5 shrink-0 text-[#485e65]" aria-hidden="true" /> : null}
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
        Other tasks
      </h2>
      <div className="mt-3 space-y-1">
        <OperatorPulseRow
          icon={Package}
          label="Low stock"
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
  liveVisits,
  onStatusChange,
  isSavingStatus,
  latestHcmPost = null,
  lowStockAlert = null,
}) {
  const firstName = getOperatorDisplayName(user);
  const greeting = getTimeOfDayGreeting();
  const reviews = Number(counts.reviews || 0);
  const overdueReviews = Number(counts.overdueReviews || 0);

  return (
    <div className="ocs-cc space-y-5">
      <header className="ocs-cc-header" aria-label="Operator overview">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#203f42]">
            {greeting}, {firstName}
          </h1>
          <p className="mt-1 text-sm text-[#485e65]">{dayjs().format("dddd, D MMMM")}</p>
        </div>
        <div className="ocs-cc-header-tools">
          <div className="ocs-cc-availability">
            <span className={cx("size-2 shrink-0 rounded-full", counts.availableNow > 0 ? "bg-emerald-500" : "bg-slate-300")} aria-hidden="true" />
            <span className="text-sm text-[#485e65]">{counts.availableNow} {counts.availableNow === 1 ? "doctor available" : "doctors available"}</span>
          </div>
          <OperationStatusSelector
            align="left"
            tone="teal"
            disabled={isSavingStatus}
            onChange={onStatusChange}
            options={["active", "offline"]}
            showLabel={false}
            value={user.operation_status}
          />
          {!user.is_read_only ? <PushNotificationBanner role="operator" compact /> : null}
          <AppUpdateBanner compact />
        </div>
      </header>

      <section aria-label="Operator workflows" className="flex flex-wrap items-center gap-3">
        <Link to="/patients/add" className="inline-flex min-h-12 items-center gap-2.5 rounded-full bg-[#137b80] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#10696d]">
          <UserPlus className="size-5" aria-hidden="true" />Add patient
        </Link>
        <Link to="/operator/long-term-review" title={overdueReviews > 0 ? `${overdueReviews} overdue reviews` : "Review appointments"} className={cx("inline-flex min-h-12 items-center gap-2.5 rounded-full border px-5 py-3 text-sm font-semibold transition", reviews > 0 ? "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100" : "border-[#d5e4e1] bg-white text-[#203f42] hover:bg-[#edf9f7]")}>
          <CalendarClock className="size-5" aria-hidden="true" />Reviews
          <span className={cx("rounded-full px-2 py-0.5 text-xs tabular-nums", reviews > 0 ? "bg-amber-200/60" : "bg-slate-100")}>{reviews}</span>
          {overdueReviews > 0 ? <span className="text-xs">· {overdueReviews} overdue</span> : null}
        </Link>
      </section>

      <OperatorDesktopLiveRequests visits={liveVisits} readOnly={Boolean(user.is_read_only)} />

      <div className="grid w-full grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(16rem,0.9fr)]">
        <OperatorPolicyVerifier compact />
        <OperatorOperationalPulse counts={counts} lowStockAlert={lowStockAlert} />
      </div>

      {latestHcmPost ? <HcmBulletinBanner post={latestHcmPost} /> : null}

    </div>
  );
}
