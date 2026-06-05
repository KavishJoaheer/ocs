import { useEffect, useState } from "react";
import { ClipboardCheck, ShieldCheck, UsersRound } from "lucide-react";
import toast from "react-hot-toast";
import LoadingState from "../../components/LoadingState.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { api } from "../../lib/api.js";
import { formatRupees } from "../../lib/format.js";

function MetricCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
            {label}
          </p>
          <p className="mt-2 text-3xl font-black tracking-tight text-gray-900 tabular-nums">
            {value}
          </p>
        </div>
        <div className={`rounded-2xl p-3 ${accent}`}>
          <Icon className="size-5 text-white" />
        </div>
      </div>
    </div>
  );
}

export default function LinkhamDashboardPage() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadMetrics() {
      setLoading(true);
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
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    void loadMetrics();
    return () => {
      ignore = true;
    };
  }, []);

  if (loading) {
    return <LoadingState label="Loading Linkham dashboard" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Linkham insurer portal"
        title="Coverage overview"
        description="Practice-wide metrics for Linkham-insured clients and the 80/20 split-billing ledger."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          icon={UsersRound}
          label="Total insured clients"
          value={metrics?.totalInsuredClients ?? 0}
          accent="bg-[#557373]"
        />
        <MetricCard
          icon={ClipboardCheck}
          label="Monthly claims settled"
          value={formatRupees(metrics?.monthlyClaimsSettled ?? 0)}
          accent="bg-emerald-500"
        />
        <MetricCard
          icon={ShieldCheck}
          label="Outstanding 80% ledger"
          value={formatRupees(metrics?.outstandingEightyLedger ?? 0)}
          accent="bg-amber-500"
        />
      </div>
    </div>
  );
}
