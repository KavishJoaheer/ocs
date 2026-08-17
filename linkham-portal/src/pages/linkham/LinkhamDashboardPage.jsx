import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import EmptyState from "../../components/EmptyState.jsx";
import LinkhamBudgetExposureGauge from "../../components/LinkhamBudgetExposureGauge.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import { api } from "../../lib/api.js";
import { formatDate, formatRupees } from "../../lib/format.js";
import { LINKHAM_CLAIMS_EVENT, LINKHAM_PATIENTS_EVENT } from "../../lib/inventorySync.js";

function MetricCard({ to, label, value, hint, tone = "slate" }) {
  const valueClass =
    tone === "gold"
      ? "text-[#b45309]"
      : tone === "teal"
        ? "text-[#065a60]"
        : "text-[#14213d]";
  const body = (
    <div className="flex min-h-[110px] flex-col justify-between rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:border-[#065a60]/30">
      <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <div className="mt-2">
        <span className={`text-3xl font-black tabular-nums ${valueClass}`}>{value}</span>
        {hint ? <p className="mt-1 text-[11px] font-medium text-gray-500">{hint}</p> : null}
      </div>
    </div>
  );

  if (!to) {
    return body;
  }

  return (
    <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#065a60]">
      {body}
    </Link>
  );
}

function QueueCard({ title, description, to, children, empty }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-gray-50 pb-2">
        <div>
          <h3 className="text-sm font-extrabold text-gray-800">{title}</h3>
          <p className="text-xs text-gray-400">{description}</p>
        </div>
        {to ? (
          <Link to={to} className="text-[11px] font-bold text-[#065a60] hover:underline">
            Open
          </Link>
        ) : null}
      </div>
      {children?.length ? children : (
        <p className="text-xs text-gray-400">{empty}</p>
      )}
    </div>
  );
}

export default function LinkhamDashboardPage() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadMetrics({ showSpinner = true } = {}) {
      if (showSpinner) {
        setLoading(true);
      }
      try {
        const data = await api.get("/linkham/dashboard");
        if (!ignore) {
          setMetrics(data);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
        }
      } finally {
        if (!ignore && showSpinner) {
          setLoading(false);
        }
      }
    }

    void loadMetrics();

    const handleRefresh = () => {
      void loadMetrics({ showSpinner: false });
    };

    window.addEventListener(LINKHAM_PATIENTS_EVENT, handleRefresh);
    window.addEventListener(LINKHAM_CLAIMS_EVENT, handleRefresh);
    return () => {
      ignore = true;
      window.removeEventListener(LINKHAM_PATIENTS_EVENT, handleRefresh);
      window.removeEventListener(LINKHAM_CLAIMS_EVENT, handleRefresh);
    };
  }, []);

  if (loading) {
    return <LoadingState label="Loading operational overview" />;
  }

  const dueReviews = Array.isArray(metrics?.dueLongTermReviews) ? metrics.dueLongTermReviews : [];
  const flaggedClaims = Array.isArray(metrics?.flaggedClaims) ? metrics.flaggedClaims : [];
  const missingPolicies = Array.isArray(metrics?.missingPolicies) ? metrics.missingPolicies : [];
  const budgetExposure = metrics?.budgetExposure || null;
  const showBudgetAlert = Boolean(budgetExposure?.thresholdWarningLevel);
  const outstanding = Number(metrics?.outstandingCleanEightyLedger || 0);
  const approvedMonth = metrics?.currentMonthKey
    ? `/linkham/claims-clearance?status=approved&month=${encodeURIComponent(metrics.currentMonthKey)}`
    : "/linkham/claims-clearance?status=approved";

  return (
    <div className="animate-fade-in flex min-h-[calc(100vh-3rem)] flex-col gap-6">
      <div>
        <h1 className="text-xl font-extrabold text-[#14213d]">Operational Overview</h1>
        <span className="text-xs font-medium text-gray-400">
          Coverage pool, unpaid 80% claims, and items that need a Linkham decision.
        </span>
      </div>

      {showBudgetAlert ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50 p-4">
          <div className="flex flex-col">
            <span className="text-xs font-bold text-amber-900">
              Linkham monthly coverage pool reached 80%
            </span>
            <span className="mt-0.5 text-[11px] font-medium text-amber-700">
              OCS has automatically prioritized non-emergency chronic reviews to the first week of
              next month to stabilize your monthly cash flow exposure.
            </span>
          </div>
        </div>
      ) : null}

      <LinkhamBudgetExposureGauge exposure={budgetExposure} />

      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          to="/linkham/patients"
          label="Insured clients"
          value={metrics?.totalInsuredClients ?? 0}
          hint="Tagged Linkham charts"
          tone="teal"
        />
        <MetricCard
          label={`Patients seen (${metrics?.currentMonthName || "this month"})`}
          value={metrics?.monthlySeenPatientsCount ?? 0}
          hint="Distinct patients with a visit this month"
        />
        <MetricCard
          to="/linkham/claims-clearance?status=pending"
          label="Unpaid 80% to clear"
          value={formatRupees(outstanding)}
          hint={`${Number(metrics?.pendingCleanCount || 0)} ready to clear${
            Number(metrics?.flaggedClaimsCount || 0)
              ? ` · ${metrics.flaggedClaimsCount} flagged`
              : ""
          }`}
          tone="gold"
        />
        <MetricCard
          to={approvedMonth}
          label="Approved this month"
          value={formatRupees(metrics?.monthlyApprovedAmount || 0)}
          hint="Accepted 80%, not yet marked paid to OCS"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <QueueCard
          title="Flagged claims"
          description={`${Number(metrics?.flaggedClaimsCount || 0)} waiting on a clinic answer.`}
          to="/linkham/claims-clearance?status=flagged"
          empty="No flagged claims."
        >
          {flaggedClaims.map((claim) => (
            <Link
              key={claim.id}
              to="/linkham/claims-clearance?status=flagged"
              className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 text-xs"
            >
              <span className="block font-bold text-gray-800">{claim.patient_name}</span>
              <span className="text-[10px] text-gray-500">
                {formatRupees(claim.linkham_share_amount)} · {claim.dispute_reason || "Needs clarification"}
              </span>
            </Link>
          ))}
        </QueueCard>

        <QueueCard
          title="Missing policy numbers"
          description={`${Number(metrics?.missingPolicyCount || 0)} charts still need a policy ID.`}
          to="/linkham/patients?missingPolicy=1"
          empty="Every insured client has a policy number."
        >
          {missingPolicies.map((client) => (
            <Link
              key={client.id}
              to={`/linkham/patients?missingPolicy=1&open=${client.id}`}
              className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-xs"
            >
              <span className="block font-bold text-gray-800">{client.full_name}</span>
              <span className="text-[10px] text-gray-400">{client.case_number}</span>
            </Link>
          ))}
        </QueueCard>

        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="border-b border-gray-50 pb-2">
            <h3 className="text-sm font-extrabold text-gray-800">Due review appointments</h3>
            <p className="text-xs text-gray-400">Chronic care reviews on Linkham-insured charts.</p>
          </div>
          {dueReviews.length ? (
            dueReviews.map((review) => (
              <Link
                key={review.id}
                to={`/linkham/patients?open=${review.id}`}
                className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-xs"
              >
                <div>
                  <span className="block font-bold text-gray-800">{review.patient_name}</span>
                  <span className="text-[10px] text-gray-400">Case Ref: {review.case_number}</span>
                </div>
                <span className="rounded-lg bg-[#fcf3ee] px-2.5 py-1 font-extrabold text-[#ba5a32]">
                  Due: {review.due_date_string}
                </span>
              </Link>
            ))
          ) : (
            <EmptyState
              compact
              title="No due reviews"
              description="Linkham insured patients with scheduled review appointments will appear here."
            />
          )}
        </div>
      </div>
    </div>
  );
}
