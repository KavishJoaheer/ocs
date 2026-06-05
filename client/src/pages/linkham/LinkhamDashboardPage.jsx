import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import EmptyState from "../../components/EmptyState.jsx";
import LinkhamBudgetExposureGauge from "../../components/LinkhamBudgetExposureGauge.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import { api } from "../../lib/api.js";
import { LINKHAM_CLAIMS_EVENT, LINKHAM_PATIENTS_EVENT } from "../../lib/inventorySync.js";

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
  const hcmNews = Array.isArray(metrics?.hcmNews) ? metrics.hcmNews : [];
  const budgetExposure = metrics?.budgetExposure || null;
  const showBudgetAlert = Boolean(budgetExposure?.thresholdWarningLevel);

  return (
    <div className="animate-fade-in flex min-h-[calc(100vh-3rem)] flex-col gap-6">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800">Operational Overview</h1>
        <span className="text-xs font-medium text-gray-400">
          Real-time indicators for active Linkham corporate coverage metrics.
        </span>
      </div>

      {showBudgetAlert ? (
        <div className="flex animate-pulse items-start gap-3 rounded-2xl border border-amber-200/80 bg-amber-50 p-4">
          <span className="text-lg">⚠️</span>
          <div className="flex flex-col">
            <span className="text-xs font-bold text-amber-900">
              Linkham Monthly Coverage Pool Reached 80%
            </span>
            <span className="mt-0.5 text-[11px] font-medium text-amber-700">
              OCS has automatically prioritized non-emergency chronic reviews to the first week of
              next month to stabilize your monthly cash flow exposure.
            </span>
          </div>
        </div>
      ) : null}

      <LinkhamBudgetExposureGauge exposure={budgetExposure} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="flex min-h-[110px] flex-col justify-between rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
            Patients Seen ({metrics?.currentMonthName || "Current month"})
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-gray-900">
              {metrics?.monthlySeenPatientsCount ?? 0}
            </span>
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-600">
              Active Month
            </span>
          </div>
        </div>

        <div className="flex min-h-[110px] flex-col justify-between rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
            Pending Corporate Claims
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-black text-amber-600">
              {metrics?.pendingClaimsCount ?? 0}
            </span>
            <span className="text-xs font-medium text-gray-400">Awaiting clearance settlement</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="border-b border-gray-50 pb-2">
            <h3 className="text-sm font-extrabold text-gray-800">Due Long Term Reviews</h3>
            <p className="text-xs text-gray-400">
              Chronic care appointments matching Linkham insured policies.
            </p>
          </div>

          {dueReviews.length ? (
            dueReviews.map((review) => (
              <div
                key={review.id}
                className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 p-3 text-xs"
              >
                <div>
                  <span className="block font-bold text-gray-800">{review.patient_name}</span>
                  <span className="text-[10px] text-gray-400">Case Ref: {review.case_number}</span>
                </div>
                <span className="rounded-lg bg-[#fcf3ee] px-2.5 py-1 font-extrabold text-[#ba5a32]">
                  Due: {review.due_date_string}
                </span>
              </div>
            ))
          ) : (
            <EmptyState
              title="No due reviews"
              description="Linkham insured patients with scheduled long-term reviews will appear here."
            />
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="border-b border-gray-50 pb-2">
            <h3 className="text-sm font-extrabold text-gray-800">HCM News</h3>
          </div>

          {hcmNews.length ? (
            hcmNews.map((post) => (
              <div
                key={post.id}
                className="rounded-xl border border-teal-100/50 bg-teal-50/30 p-3 text-xs"
              >
                <span className="block font-bold text-teal-900">{post.title}</span>
                <p className="mt-1 text-gray-600">{post.body}</p>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-teal-100/50 bg-teal-50/30 p-3 text-xs">
              <span className="block font-bold text-teal-900">System Performance Optimization</span>
              <p className="mt-1 text-gray-600">
                Real-time synchronization structures for third-party insurer coordination links are
                fully operational.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
