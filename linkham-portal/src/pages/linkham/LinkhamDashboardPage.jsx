import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  FileWarning,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import toast from "react-hot-toast";
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
        "group flex min-w-0 items-center gap-3 rounded-2xl border p-3.5 transition hover:-translate-y-0.5 hover:shadow-md",
        METRIC_TONES[tone],
      )}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/75 shadow-sm">
        <MetricIcon className="size-4.5" strokeWidth={2.2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-black tabular-nums tracking-tight">{value}</p>
        <p className="text-[11px] font-black">{label}</p>
        <p className="truncate text-[9px] font-semibold opacity-55">{hint}</p>
      </div>
      <ArrowUpRight className="size-3.5 shrink-0 opacity-25 transition group-hover:opacity-80" />
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
    return items.slice(0, 5);
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
          <p className="mt-1 text-xs font-medium text-slate-500">Verify eligibility and clear the work that matters today.</p>
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.45fr)]">
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

        <section className="flex flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-black text-slate-900">Month-end settlement</h2>
              <p className="mt-0.5 text-[11px] font-medium text-slate-400">{metrics?.currentMonthName || "Current month"}</p>
            </div>
            <span className="grid size-9 place-items-center rounded-xl bg-[#065a60]/8 text-[#065a60]">
              <ShieldCheck className="size-4.5" />
            </span>
          </div>
          <div className="mt-5 rounded-2xl bg-[#065a60] p-4 text-white">
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-white/55">Ready for payment</p>
            <p className="mt-1 text-2xl font-black tabular-nums tracking-tight">{formatRupees(metrics?.approvedAwaitingPaymentAmount || 0)}</p>
            <p className="mt-1 text-[10px] font-semibold text-white/60">
              {metrics?.approvedAwaitingPaymentCount || 0} approved claim{Number(metrics?.approvedAwaitingPaymentCount || 0) === 1 ? "" : "s"}
            </p>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 text-[10px] font-bold text-slate-400">
            <span>{metrics?.pendingCleanCount || 0} awaiting review</span>
            <span>{metrics?.flaggedClaimsCount || 0} flagged</span>
          </div>
          <Link
            to="/linkham/claims-clearance?status=approved"
            className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-3 text-[11px] font-black text-slate-700 transition hover:border-[#065a60]/30 hover:text-[#065a60]"
          >
            Open settlement
            <ArrowUpRight className="size-3.5" />
          </Link>
        </section>
      </div>
    </div>
  );
}
