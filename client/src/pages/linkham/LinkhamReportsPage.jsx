import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import toast from "react-hot-toast";
import LinkhamMauritiusHeatmap from "../../components/LinkhamMauritiusHeatmap.jsx";
import LoadingState from "../../components/LoadingState.jsx";
import { api } from "../../lib/api.js";
import { LINKHAM_CLAIMS_EVENT } from "../../lib/inventorySync.js";
import { formatRupees } from "../../lib/format.js";

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

export default function LinkhamReportsPage() {
  const [seenTimeFilter, setSeenTimeFilter] = useState("month");
  const [claimsTimeFilter, setClaimsTimeFilter] = useState("month");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadReport() {
      setLoading(true);
      try {
        const data = await api.get(
          `/linkham/reports?seenFilter=${encodeURIComponent(seenTimeFilter)}&claimsFilter=${encodeURIComponent(claimsTimeFilter)}`,
        );
        if (!ignore) {
          setReport(data);
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

    void loadReport();

    const handleRefresh = () => {
      void loadReport();
    };

    window.addEventListener(LINKHAM_CLAIMS_EVENT, handleRefresh);
    return () => {
      ignore = true;
      window.removeEventListener(LINKHAM_CLAIMS_EVENT, handleRefresh);
    };
  }, [seenTimeFilter, claimsTimeFilter]);

  const patientsSeenRows = useMemo(
    () =>
      (Array.isArray(report?.patientsSeen) ? report.patientsSeen : []).map((row) => ({
        label: row.label,
        patient_count: Number(row.patient_count || 0),
      })),
    [report?.patientsSeen],
  );

  const claimsRows = useMemo(
    () =>
      (Array.isArray(report?.claimsVolume) ? report.claimsVolume : []).map((row) => ({
        label: row.label,
        linkham_outlay: Number(row.linkham_outlay || 0),
      })),
    [report?.claimsVolume],
  );

  if (loading && !report) {
    return <LoadingState label="Loading analytics ledger" />;
  }

  return (
    <div className="animate-fade-in flex min-h-[calc(100vh-3rem)] flex-col gap-6">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800">Data & Analytics Ledger</h1>
        <span className="text-xs font-medium text-gray-400">
          Visual trends monitoring deployment operations and claims performance metrics.
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-50 pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">
              Patients Seen by OCS
            </h3>
            <select
              value={seenTimeFilter}
              onChange={(event) => setSeenTimeFilter(event.target.value)}
              className="rounded-lg border border-gray-200 bg-gray-50 p-1.5 text-xs font-bold text-gray-700"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </div>
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={patientsSeenRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => [formatInteger(value), "Patients seen"]} />
                <Bar dataKey="patient_count" fill="#557373" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-50 pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">
              Case Density Heatmap
            </h3>
            <span className="rounded-md bg-[#557373]/10 px-2 py-0.5 text-[10px] font-bold text-[#557373]">
              Geographic Intelligence
            </span>
          </div>
          <LinkhamMauritiusHeatmap
            clusters={report?.geographicHeatmap?.clusters || []}
            predictiveInsight={report?.predictiveInsight}
          />
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-50 pb-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-gray-400">
              Total Claims Processed (80% Outlay Value)
            </h3>
            <select
              value={claimsTimeFilter}
              onChange={(event) => setClaimsTimeFilter(event.target.value)}
              className="rounded-lg border border-gray-200 bg-gray-50 p-1.5 text-xs font-bold text-gray-700"
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </div>
          <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50/50">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={claimsRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="linkhamClaimsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#557373" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#557373" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value) => [formatRupees(value), "Linkham outlay"]} />
                <Area
                  type="monotone"
                  dataKey="linkham_outlay"
                  stroke="#557373"
                  fill="url(#linkhamClaimsFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
