import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileWarning,
  ShieldAlert,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import toast from "react-hot-toast";
import LinkhamBudgetExposureGauge from "../../components/LinkhamBudgetExposureGauge.jsx";
import LinkhamQuickPolicyLookup from "../../components/LinkhamQuickPolicyLookup.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import { api } from "../../lib/api.js";
import { formatRupees } from "../../lib/format.js";
import { LINKHAM_CLAIMS_EVENT, LINKHAM_PATIENTS_EVENT } from "../../lib/inventorySync.js";
import { cx } from "../../lib/utils.js";

const METRIC_TONES = {
  amber: "border-amber-200/70 bg-amber-50/65 text-amber-950",
  blue: "border-sky-200/70 bg-sky-50/65 text-sky-950",
  teal: "border-emerald-200/70 bg-emerald-50/65 text-emerald-950",
  slate: "border-slate-200/70 bg-white text-slate-950",
};

function ActionMetric({ to, label, value, hint, icon, tone = "slate" }) {
  const MetricIcon = icon;
  return (
    <Link
      to={to}
      className={cx(
        "group flex min-h-[132px] flex-col justify-between rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md",
        METRIC_TONES[tone],
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-white/75 shadow-sm">
          <MetricIcon className="size-4.5" strokeWidth={2.2} />
        </span>
        <ArrowUpRight className="size-4 opacity-35 transition group-hover:opacity-80" />
      </div>
      <div className="mt-4">
        <p className="text-2xl font-black tabular-nums tracking-tight">{value}</p>
        <p className="mt-1 text-xs font-black">{label}</p>
        <p className="mt-0.5 text-[10px] font-semibold opacity-55">{hint}</p>
      </div>
    </Link>
  );
}

function WorkItem({ to, eyebrow, title, detail, tone = "amber", ageDays = null }) {
  const dot = tone === "red" ? "bg-rose-500" : tone === "teal" ? "bg-emerald-500" : "bg-amber-400";
  return (
    <Link to={to} className="group flex items-start gap-3 rounded-xl px-2 py-2.5 transition hover:bg-slate-50">
      <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{eyebrow}</p>
          {ageDays != null ? (
            <span className={cx("text-[10px] font-black", ageDays >= 7 ? "text-rose-600" : "text-slate-400")}>
              {ageDays}d
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-sm font-extrabold text-slate-800">{title}</p>
        <p className="mt-0.5 truncate text-[11px] font-medium text-slate-500">{detail}</p>
      </div>
      <ArrowUpRight className="mt-3 size-3.5 shrink-0 text-slate-300 transition group-hover:text-[#065a60]" />
    </Link>
  );
}

function SettlementStage({ number, label, value, detail, active = false }) {
  return (
    <div className="relative flex gap-3 pb-5 last:pb-0">
      <div className="relative flex shrink-0 flex-col items-center">
        <span className={cx(
          "grid size-7 place-items-center rounded-full text-[11px] font-black",
          active ? "bg-[#065a60] text-white" : "bg-slate-100 text-slate-500",
        )}>
          {number}
        </span>
        <span className="absolute top-8 h-[calc(100%-1.5rem)] w-px bg-slate-100 last:hidden" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-black text-slate-700">{label}</p>
          <p className="text-sm font-black tabular-nums text-slate-950">{value}</p>
        </div>
        <p className="mt-0.5 text-[10px] font-semibold text-slate-400">{detail}</p>
      </div>
    </div>
  );
}

function formatActivityTime(value) {
  if (!value) return "Recently";
  const normalized = String(value);
  const parsed = new Date(normalized.includes("T") ? normalized : `${normalized.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-MU", {
    timeZone: "Indian/Mauritius",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export default function LinkhamDashboardPage() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    async function loadMetrics({ showSpinner = true } = {}) {
      if (showSpinner) setLoading(true);
      try {
        const data = await api.get("/linkham/dashboard");
        if (!ignore) setMetrics(data);
      } catch (error) {
        if (!ignore) toast.error(error.message);
      } finally {
        if (!ignore && showSpinner) setLoading(false);
      }
    }
    void loadMetrics();
    const refresh = () => void loadMetrics({ showSpinner: false });
    window.addEventListener(LINKHAM_PATIENTS_EVENT, refresh);
    window.addEventListener(LINKHAM_CLAIMS_EVENT, refresh);
    return () => {
      ignore = true;
      window.removeEventListener(LINKHAM_PATIENTS_EVENT, refresh);
      window.removeEventListener(LINKHAM_CLAIMS_EVENT, refresh);
    };
  }, []);

  const workItems = useMemo(() => {
    const items = [];
    (metrics?.flaggedClaims || []).slice(0, 2).forEach((claim) => items.push({
      key: `flagged-${claim.id}`,
      to: `/linkham/claims-clearance?status=flagged&open=${claim.id}`,
      eyebrow: "Flagged claim",
      title: claim.patient_name,
      detail: `${formatRupees(claim.linkham_share_amount)} · ${claim.dispute_reason || "Clinic clarification required"}`,
      tone: "red",
      ageDays: claim.age_days,
    }));
    (metrics?.pendingClaims || []).slice(0, 2).forEach((claim) => items.push({
      key: `pending-${claim.id}`,
      to: `/linkham/claims-clearance?status=pending&open=${claim.id}`,
      eyebrow: "Claim waiting",
      title: claim.patient_name,
      detail: `${formatRupees(claim.linkham_share_amount)} · Ready for coverage review`,
      tone: "amber",
      ageDays: claim.age_days,
    }));
    (metrics?.redPolicies || []).slice(0, 1).forEach((policy) => items.push({
      key: `red-${policy.id}`,
      to: `/linkham/policies?edit=${policy.id}`,
      eyebrow: "Red policy",
      title: policy.holder_name || policy.policy_number,
      detail: `${policy.policy_number} · ${policy.status_reason || "OCS service blocked"}`,
      tone: "red",
    }));
    (metrics?.unregisteredPolicies || []).slice(0, 1).forEach((patient) => items.push({
      key: `unregistered-${patient.id}`,
      to: `/linkham/patients?open=${patient.id}`,
      eyebrow: "Unregistered policy",
      title: patient.full_name,
      detail: `${patient.case_number} · ${patient.insurance_policy_number}`,
      tone: "amber",
    }));
    (metrics?.missingPolicies || []).slice(0, 1).forEach((patient) => items.push({
      key: `missing-${patient.id}`,
      to: `/linkham/patients?missingPolicy=1&open=${patient.id}`,
      eyebrow: "Missing policy",
      title: patient.full_name,
      detail: patient.case_number,
      tone: "amber",
    }));
    return items.slice(0, 7);
  }, [metrics]);

  if (loading) return <LoadingState label="Loading Linkham work queue" />;

  const coverageIssues = Number(metrics?.missingPolicyCount || 0)
    + Number(metrics?.unregisteredPolicyCount || 0)
    + Number(metrics?.redPolicyCount || 0);
  const monthKey = metrics?.currentMonthKey || "";
  const budgetExposure = metrics?.budgetExposure || {};

  return (
    <div className="animate-fade-in space-y-5 pb-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#065a60]">Linkham command centre</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-[#14213d]">Today’s coverage work</h1>
          <p className="mt-1 text-xs font-medium text-slate-500">Decisions, exceptions, and month-end settlement in one focused view.</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
          <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.10)]" />
          Live with OCS VP{metrics?.refreshedAt ? ` · ${formatActivityTime(metrics.refreshedAt)}` : ""}
        </div>
      </header>

      <LinkhamQuickPolicyLookup />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Actionable overview">
        <ActionMetric
          to="/linkham/patients?coverageIssue=1"
          label="Coverage issues"
          value={coverageIssues}
          hint={`${metrics?.missingPolicyCount || 0} missing · ${metrics?.unregisteredPolicyCount || 0} unregistered · ${metrics?.redPolicyCount || 0} red`}
          icon={FileWarning}
          tone="amber"
        />
        <ActionMetric
          to="/linkham/claims-clearance?status=pending"
          label="Claims to review"
          value={metrics?.pendingCleanCount || 0}
          hint={formatRupees(metrics?.outstandingCleanEightyLedger || 0)}
          icon={Clock3}
          tone="blue"
        />
        <ActionMetric
          to="/linkham/claims-clearance?status=approved"
          label="Approved to pay"
          value={formatRupees(metrics?.approvedAwaitingPaymentAmount || 0)}
          hint={`${metrics?.approvedAwaitingPaymentCount || 0} claim${Number(metrics?.approvedAwaitingPaymentCount || 0) === 1 ? "" : "s"}`}
          icon={WalletCards}
          tone="teal"
        />
        <ActionMetric
          to={`/linkham/claims-clearance?status=settled${monthKey ? `&month=${monthKey}` : ""}`}
          label="Paid this month"
          value={formatRupees(metrics?.settledThisMonthAmount || 0)}
          hint={`${metrics?.settledThisMonthCount || 0} settled claim${Number(metrics?.settledThisMonthCount || 0) === 1 ? "" : "s"}`}
          icon={CircleDollarSign}
          tone="slate"
        />
      </section>

      {budgetExposure?.thresholdWarningLevel ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-xs font-black">Monthly coverage exposure has reached {Number(budgetExposure.exposurePercent || 0).toFixed(1)}%</p>
            <p className="mt-0.5 text-[11px] font-medium text-amber-800">Review the approved balance and pending claims. No patient scheduling is changed automatically.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-black text-slate-900">Priority work queue</h2>
              <p className="mt-0.5 text-[11px] font-medium text-slate-400">Exceptions first, ordered for immediate action.</p>
            </div>
            <Link to="/linkham/claims-clearance?status=flagged" className="text-[11px] font-black text-[#065a60]">Claim queue</Link>
          </div>
          <div className="mt-2 divide-y divide-slate-100">
            {workItems.length ? workItems.map((item) => <WorkItem key={item.key} {...item} />) : (
              <div className="flex items-center gap-3 py-8 text-sm font-bold text-emerald-700">
                <CheckCircle2 className="size-5" /> No policy or claim exceptions need attention.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-black text-slate-900">Month-end settlement</h2>
              <p className="mt-0.5 text-[11px] font-medium text-slate-400">{metrics?.currentMonthName || "Current month"} payment path</p>
            </div>
            <ShieldCheck className="size-5 text-[#065a60]" />
          </div>
          <div className="mt-4">
            <SettlementStage number="1" label="Awaiting review" value={metrics?.pendingCleanCount || 0} detail={formatRupees(metrics?.outstandingCleanEightyLedger || 0)} active={Number(metrics?.pendingCleanCount || 0) > 0} />
            <SettlementStage number="2" label="Flagged exceptions" value={metrics?.flaggedClaimsCount || 0} detail="Needs clinic clarification" active={Number(metrics?.flaggedClaimsCount || 0) > 0} />
            <SettlementStage number="3" label="Approved to pay" value={metrics?.approvedAwaitingPaymentCount || 0} detail={formatRupees(metrics?.approvedAwaitingPaymentAmount || 0)} active={Number(metrics?.approvedAwaitingPaymentCount || 0) > 0} />
            <SettlementStage number="4" label="Paid to OCS" value={metrics?.settledThisMonthCount || 0} detail={formatRupees(metrics?.settledThisMonthAmount || 0)} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Link to="/linkham/claims-clearance?status=pending" className="rounded-xl border border-slate-200 px-3 py-2.5 text-center text-[11px] font-black text-slate-700">Review claims</Link>
            <Link to="/linkham/claims-clearance?status=approved" className="rounded-xl bg-[#065a60] px-3 py-2.5 text-center text-[11px] font-black text-white">Record payment</Link>
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-black text-slate-900">Recent policy decisions</h2>
              <p className="mt-0.5 text-[11px] font-medium text-slate-400">Who changed what and when.</p>
            </div>
            <Link to="/linkham/policies" className="text-[11px] font-black text-[#065a60]">Registry</Link>
          </div>
          <div className="mt-2 divide-y divide-slate-100">
            {(metrics?.recentPolicyActivity || []).slice(0, 6).map((activity) => (
              <Link key={activity.id} to={`/linkham/policies?search=${encodeURIComponent(activity.policy_number)}`} className="flex items-center gap-3 py-3">
                <span className={cx("grid size-8 shrink-0 place-items-center rounded-xl", activity.coverage_status === "red" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                  {activity.coverage_status === "red" ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black text-slate-800">{activity.holder_name}</p>
                  <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-400">{activity.policy_number} · {activity.previous_coverage_status && activity.previous_coverage_status !== activity.coverage_status ? `${activity.previous_coverage_status} → ` : ""}{activity.coverage_status}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-500">{formatActivityTime(activity.created_at)}</p>
                  <p className="mt-0.5 max-w-28 truncate text-[9px] font-semibold text-slate-300">{activity.actor_name}</p>
                </div>
              </Link>
            ))}
            {!metrics?.recentPolicyActivity?.length ? <p className="py-6 text-xs font-medium text-slate-400">No policy changes recorded yet.</p> : null}
          </div>
        </section>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Insured clients</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{metrics?.totalInsuredClients || 0}</p>
              <p className="mt-1 text-[10px] font-semibold text-slate-400">{metrics?.greenPolicyCount || 0} green policies</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Seen this month</p>
              <p className="mt-2 text-2xl font-black text-slate-900">{metrics?.monthlySeenPatientsCount || 0}</p>
              <p className="mt-1 text-[10px] font-semibold text-slate-400">Distinct Linkham patients</p>
            </div>
          </div>
          <LinkhamBudgetExposureGauge exposure={budgetExposure} />
          <Link to="/linkham/reports" className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-5 py-4 text-xs font-black text-slate-700 shadow-sm">
            Open analytics and monthly statements
            <ArrowUpRight className="size-4 text-[#065a60]" />
          </Link>
        </div>
      </div>
    </div>
  );
}
