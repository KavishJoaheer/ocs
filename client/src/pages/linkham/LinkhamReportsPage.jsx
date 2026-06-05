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

const AXIS_TICK = {
  fontSize: 10,
  fontWeight: 600,
  fill: "#9ca3af",
};

const Y_AXIS_TICK = {
  ...AXIS_TICK,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

const SEEN_PERIOD_LABELS = {
  day: "today",
  week: "this week",
  month: "this month",
  year: "this year",
};

const CLAIMS_PERIOD_LABELS = {
  week: "this week",
  month: "this month",
  year: "this year",
};

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function PremiumChartTooltip({ active, payload, label, formatValue, valueLabel }) {
  if (!active || !payload?.length) {
    return null;
  }

  const value = payload[0]?.value ?? 0;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-white/90 px-3 py-3 shadow-sm backdrop-blur-sm">
      {label ? <p className="text-xs font-semibold text-gray-800">{label}</p> : null}
      <p className="mt-1 flex items-center gap-2 text-xs text-gray-600">
        <span className="inline-block size-2 rounded-full bg-[#557373]" />
        <span>
          {valueLabel}: {formatValue(value)}
        </span>
      </p>
    </div>
  );
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

  const patientsSeenTotal = useMemo(
    () => patientsSeenRows.reduce((sum, row) => sum + row.patient_count, 0),
    [patientsSeenRows],
  );

  const claimsOutlayTotal = useMemo(
    () => claimsRows.reduce((sum, row) => sum + row.linkham_outlay, 0),
    [claimsRows],
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
        <div className="flex h-full flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                Patients Seen by OCS
              </span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-gray-900">{formatInteger(patientsSeenTotal)}</span>
                <span className="text-[10px] font-medium text-gray-400">
                  {SEEN_PERIOD_LABELS[seenTimeFilter] || "this period"}
                </span>
              </div>
            </div>
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

          <div className="h-64 min-h-[16rem] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={patientsSeenRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="rgba(243, 244, 246, 0.8)"
                  strokeDasharray="4 4"
                />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  allowDecimals={false}
                  tick={Y_AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "rgba(85, 115, 115, 0.06)" }}
                  content={
                    <PremiumChartTooltip
                      formatValue={(value) => formatInteger(value)}
                      valueLabel="Patients seen"
                    />
                  }
                />
                <Bar dataKey="patient_count" fill="#557373" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex h-full flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
              Case Density Heatmap
            </span>
            <span className="rounded-md bg-[#557373]/10 px-2 py-0.5 text-[10px] font-bold text-[#557373]">
              Geographic Intelligence
            </span>
          </div>
          <LinkhamMauritiusHeatmap
            clusters={report?.geographicHeatmap?.clusters || []}
            predictiveInsight={report?.predictiveInsight}
          />
        </div>

        <div className="flex flex-col rounded-2xl border border-gray-100 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                Total Claims Processed (80% Outlay Value)
              </span>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-2xl font-black text-gray-900">{formatRupees(claimsOutlayTotal)}</span>
                <span className="text-[10px] font-medium text-gray-400">
                  {CLAIMS_PERIOD_LABELS[claimsTimeFilter] || "this period"}
                </span>
              </div>
            </div>
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

          <div className="h-72 min-h-[18rem] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={claimsRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="linkhamClaimsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#557373" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#557373" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="rgba(243, 244, 246, 0.8)"
                  strokeDasharray="4 4"
                />
                <XAxis
                  dataKey="label"
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis tick={Y_AXIS_TICK} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ stroke: "rgba(85, 115, 115, 0.2)", strokeWidth: 1 }}
                  content={
                    <PremiumChartTooltip
                      formatValue={(value) => `Rs ${formatInteger(value)}`}
                      valueLabel="Linkham outlay"
                    />
                  }
                />
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
