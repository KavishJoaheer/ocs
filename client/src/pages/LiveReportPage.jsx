import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronRight, MapPin, Users } from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { api } from "../lib/api.js";
import { formatCurrency, formatDate, formatPaymentMethod } from "../lib/format.js";
import { cx } from "../lib/utils.js";
import dayjs from "dayjs";

const PERIOD_OPTIONS = [
  { id: "daily", label: "Day", dateLabel: "Date" },
  { id: "weekly", label: "Week", dateLabel: "Week of" },
  { id: "monthly", label: "Month", dateLabel: "Month" },
  { id: "annual", label: "Year", dateLabel: "Year of" },
];

const LOCATION_BAR_LIMIT = 8;

function getTodayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function formatRangeLabel(period, start, end) {
  if (!start || !end) return "";
  const from = dayjs(start);
  const to = dayjs(end);
  if (period === "daily") return from.format("dddd D MMMM YYYY");
  if (period === "weekly") return `${from.format("D MMM")} – ${to.format("D MMM YYYY")}`;
  if (period === "annual") return from.format("YYYY");
  return from.format("MMMM YYYY");
}

function percentLabel(rate) {
  return `${Math.round(Number(rate || 0) * 100)}%`;
}

function buildTopLocationRows(rows, limit = LOCATION_BAR_LIMIT) {
  const sorted = [...rows].sort(
    (a, b) => Number(b.patient_count || 0) - Number(a.patient_count || 0),
  );
  if (sorted.length <= limit) return sorted;
  const top = sorted.slice(0, limit);
  const otherCount = sorted
    .slice(limit)
    .reduce((sum, row) => sum + Number(row.patient_count || 0), 0);
  if (otherCount > 0) {
    top.push({ location: "Other", patient_count: otherCount });
  }
  return top;
}

function chartRowsForPeriod(period, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (period === "weekly" || period === "annual") return list;
  return list.filter((row) => Number(row.patient_count || 0) > 0);
}

function PeriodControls({ period, onPeriodChange, anchorDate, onAnchorDateChange, compact = false }) {
  const dateLabel = PERIOD_OPTIONS.find((option) => option.id === period)?.dateLabel || "Date";

  return (
    <div className={cx("flex min-w-0 flex-col gap-2", compact ? "" : "sm:flex-row sm:items-center")}>
      <div
        className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100 p-1"
        role="group"
        aria-label="Report period"
      >
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPeriodChange(option.id)}
            className={cx(
              "min-h-10 shrink-0 rounded-xl px-3 text-sm font-semibold transition",
              period === option.id
                ? "bg-white text-ocs-slate shadow-sm"
                : "text-slate-500 hover:text-slate-800",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <label className="flex min-h-10 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-1.5">
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gray-400">
          {dateLabel}
        </span>
        <input
          type="date"
          value={anchorDate}
          onChange={(event) => onAnchorDateChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-700 outline-none accent-ocs-teal"
        />
      </label>
    </div>
  );
}

function StatTile({ label, value, hint, tone = "default", to, onClick }) {
  const className = cx(
    "rounded-2xl border p-4",
    tone === "unpaid" ? "border-rose-100 bg-rose-50/70" : "border-slate-100 bg-slate-50",
    (to || onClick) && "transition hover:border-ocs-teal/30 hover:bg-white",
  );
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-1.5 text-xl font-bold tabular-nums text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${className} w-full text-left`}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}

function LocationVolumeBars({ rows }) {
  const displayRows = useMemo(() => buildTopLocationRows(rows), [rows]);
  const maxCount = useMemo(
    () => Math.max(...displayRows.map((row) => Number(row.patient_count || 0)), 1),
    [displayRows],
  );

  if (!displayRows.length) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">No visits in this period.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {displayRows.map((row) => {
        const count = Number(row.patient_count || 0);
        const widthPercent = Math.max(6, Math.round((count / maxCount) * 100));
        return (
          <div key={row.location} className="flex items-center gap-3">
            <p className="w-[38%] min-w-0 truncate text-sm font-medium text-ocs-slate" title={row.location}>
              {row.location}
            </p>
            <div className="h-2 min-w-0 flex-1 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-ocs-teal" style={{ width: `${widthPercent}%` }} />
            </div>
            <p className="w-8 shrink-0 text-right text-sm font-bold tabular-nums text-ocs-slate">{count}</p>
          </div>
        );
      })}
    </div>
  );
}

function VisitVolumeChart({ period, rows }) {
  const data = useMemo(() => chartRowsForPeriod(period, rows), [period, rows]);

  if (!data.length || data.every((row) => Number(row.patient_count || 0) === 0)) {
    return <p className="py-8 text-center text-sm text-slate-400">No visits in this period.</p>;
  }

  return (
    <div className="h-52 w-full min-w-0 sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} width={28} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(45, 143, 152, 0.06)" }}
            formatter={(value) => [value, "Visits"]}
            contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
          />
          <Bar dataKey="patient_count" fill="#2d8f98" radius={[6, 6, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function WeekStrip({ rows }) {
  const list = Array.isArray(rows) ? rows : [];
  const max = Math.max(...list.map((row) => Number(row.patient_count || 0)), 1);
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {list.map((row) => {
        const count = Number(row.patient_count || 0);
        const fill = Math.max(count > 0 ? 18 : 8, Math.round((count / max) * 100));
        return (
          <div key={row.slot || row.label} className="flex flex-col items-center gap-1">
            <div className="flex h-16 w-full items-end rounded-xl bg-slate-100 px-1 pb-1">
              <div
                className="w-full rounded-lg bg-ocs-teal"
                style={{ height: `${fill}%`, opacity: count ? 1 : 0.2 }}
              />
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{row.label}</p>
            <p className="text-xs font-bold tabular-nums text-slate-800">{count}</p>
          </div>
        );
      })}
    </div>
  );
}

function BillRow({ row, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="flex w-full items-center gap-3 border-t border-slate-100 px-1 py-3 text-left transition hover:bg-slate-50/80"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900">{row.patient_name}</p>
        <p className="mt-0.5 text-xs text-slate-500">{formatDate(row.consultation_date)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums text-slate-900">{formatCurrency(row.total_amount)}</p>
        <div className="mt-1 flex justify-end">
          <StatusBadge value={row.status} />
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-slate-300" aria-hidden />
    </button>
  );
}

export default function LiveReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const today = useMemo(() => getTodayInputValue(), []);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState("monthly");
  const [anchorDate, setAnchorDate] = useState(today);
  const [doctorScope, setDoctorScope] = useState("general");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [billsExpanded, setBillsExpanded] = useState(false);
  const refreshKey = useLiveRefreshKey();
  const hasReportRef = useRef(false);
  const isAdmin = user.role === "admin";
  const isDoctor = user.role === "doctor";

  useEffect(() => {
    let ignore = false;
    async function loadReport() {
      if (hasReportRef.current) setRefreshing(true);
      else setLoading(true);
      try {
        const params = new URLSearchParams({
          locationPeriod: period,
          locationDate: anchorDate,
          doctorPeriod: period,
          doctorDate: anchorDate,
          revenueDate: anchorDate,
        });
        if (doctorScope === "doctor" && selectedDoctorId) {
          params.set("doctorId", selectedDoctorId);
        }
        const response = await api.get(`/dashboard/live-report?${params.toString()}`);
        if (!ignore) {
          hasReportRef.current = true;
          setReport(response);
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
          if (!hasReportRef.current) setReport(null);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    loadReport();
    return () => {
      ignore = true;
    };
  }, [anchorDate, doctorScope, period, selectedDoctorId, refreshKey]);

  useEffect(() => {
    setBillsExpanded(false);
  }, [anchorDate, period, doctorScope, selectedDoctorId]);

  const statement = report?.revenueStatement || {};
  const shareRates = statement.shareRates || { doctor: 0.4, ocs: 0.6, transportPerPatient: 300 };
  const volumeRows = report?.volumeReport?.rows || [];
  const locationRows = report?.locationReport?.rows || [];
  const revenueRows = report?.billingRevenueReport?.rows || [];
  const patientsSeen = report?.patientsSeenReport?.rows || [];
  const visitCount = Number(report?.volumeReport?.visitCount ?? statement.visitCount ?? 0);
  const uniquePatientCount = Number(
    report?.volumeReport?.uniquePatientCount ?? statement.uniquePatientCount ?? 0,
  );
  const rangeLabel = formatRangeLabel(
    period,
    report?.volumeReport?.rangeStart,
    report?.volumeReport?.rangeEnd,
  );
  const visibleBills = billsExpanded ? revenueRows : revenueRows.slice(0, isMobile ? 8 : 6);
  const doctors = report?.doctors || [];

  function openBill(row) {
    const params = new URLSearchParams({ patientId: String(row.patient_id) });
    if (row.status === "paid") params.set("status", "paid");
    else params.set("status", "unpaid");
    navigate(`/billing?${params.toString()}`);
  }

  if (loading && !report) return <LoadingState label="Loading live report" />;
  if (!report) {
    return (
      <EmptyState title="Live report unavailable" description="Unable to load report data." />
    );
  }

  const doctorShareLabel = `${percentLabel(shareRates.doctor)} of paid`;
  const ocsShareLabel = `${percentLabel(shareRates.ocs)} of paid`;
  const transportHint = `Rs ${shareRates.transportPerPatient} × ${uniquePatientCount} patient${
    uniquePatientCount === 1 ? "" : "s"
  } seen`;

  return (
    <div className={cx("space-y-5", refreshing && "opacity-80")}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Analytics</p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ocs-slate md:text-3xl">
            Live report
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            {rangeLabel || "Selected period"}
            {report.volumeReport?.entityLabel ? ` · ${report.volumeReport.entityLabel}` : ""}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 lg:items-end">
          {isAdmin && doctors.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5" role="group">
                <button
                  type="button"
                  onClick={() => setDoctorScope("general")}
                  className={cx(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold",
                    doctorScope === "general" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                  )}
                >
                  Clinic
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDoctorScope("doctor");
                    if (!selectedDoctorId && doctors.length) {
                      setSelectedDoctorId(String(doctors[0].id));
                    }
                  }}
                  className={cx(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold",
                    doctorScope === "doctor" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
                  )}
                >
                  Doctor
                </button>
              </div>
              {doctorScope === "doctor" ? (
                <select
                  value={selectedDoctorId || String(report.doctorReport?.selectedDoctorId || "")}
                  onChange={(event) => setSelectedDoctorId(event.target.value)}
                  className="max-w-[16rem] rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                >
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.full_name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}
          <PeriodControls
            period={period}
            onPeriodChange={setPeriod}
            anchorDate={anchorDate}
            onAnchorDateChange={setAnchorDate}
            compact={isMobile}
          />
        </div>
      </div>

      {isDoctor ? (
        <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white">
          <div className="border-l-4 border-l-ocs-teal px-5 py-5 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Your net</p>
            <p className="mt-2 text-4xl font-black tabular-nums tracking-tight text-ocs-teal">
              {formatCurrency(statement.doctorNetRevenue || 0)}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              {doctorShareLabel} ({formatCurrency(statement.doctorCommission || 0)}) plus transport
              ({transportHint}). Unpaid bills are listed separately and are not in this net.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
            <div className="bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Paid</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                {formatCurrency(statement.paidRevenue || 0)}
              </p>
            </div>
            <Link to="/billing?status=unpaid" className="bg-white p-4 hover:bg-rose-50/40">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400">Unpaid</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                {formatCurrency(statement.unpaidRevenue || 0)}
              </p>
            </Link>
            <div className="bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Visits</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{visitCount}</p>
            </div>
            <div className="bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Patients</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{uniquePatientCount}</p>
            </div>
          </div>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white">
            <div className="border-l-4 border-l-ocs-teal px-5 py-5 sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Billed this period
              </p>
              <p className="mt-2 text-4xl font-black tabular-nums tracking-tight text-ocs-teal">
                {formatCurrency(statement.totalRevenue || 0)}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Shares below are {ocsShareLabel} / {doctorShareLabel}. Transport is {transportHint}.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Paid" value={formatCurrency(statement.paidRevenue || 0)} />
            <StatTile
              label="Unpaid"
              value={formatCurrency(statement.unpaidRevenue || 0)}
              tone="unpaid"
              to="/billing?status=unpaid"
            />
            <StatTile
              label={`OCS share (${percentLabel(shareRates.ocs)})`}
              value={formatCurrency(statement.ocsCommission || 0)}
              hint="Of paid"
            />
            <StatTile
              label={`Doctor share (${percentLabel(shareRates.doctor)})`}
              value={formatCurrency(statement.doctorCommission || 0)}
              hint="Of paid"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile label="Doctor net" value={formatCurrency(statement.doctorNetRevenue || 0)} hint="Share + transport" />
            <StatTile label="Visits" value={visitCount} hint="Consultation notes" />
            <StatTile label="Patients seen" value={uniquePatientCount} />
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-slate-100 bg-white p-5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ocs-slate">Bills</h2>
            <p className="mt-0.5 text-xs text-slate-500">By consultation date. Tap a row to open billing.</p>
          </div>
          <Link to="/billing" className="text-xs font-semibold text-ocs-teal hover:underline">
            Open billing
          </Link>
        </div>
        {revenueRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No bills in this period.</p>
        ) : (
          <div>
            {visibleBills.map((row) => (
              <BillRow key={row.bill_id} row={row} onOpen={openBill} />
            ))}
          </div>
        )}
        {revenueRows.length > (isMobile ? 8 : 6) ? (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setBillsExpanded((current) => !current)}
              className="min-h-10 rounded-2xl bg-ocs-teal px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              {billsExpanded ? "Show less" : `View all ${revenueRows.length}`}
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-3xl border border-slate-100 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users className="size-4 text-ocs-teal" aria-hidden />
            <div>
              <h2 className="text-base font-semibold text-ocs-slate">Visit volume</h2>
              <p className="text-xs text-slate-500">Consultation notes, not unique patients</p>
            </div>
          </div>
          {isMobile && period === "weekly" ? (
            <WeekStrip rows={volumeRows} />
          ) : isMobile && period === "daily" ? (
            <p className="text-sm text-slate-600">
              <span className="text-3xl font-black tabular-nums text-ocs-teal">{visitCount}</span>
              <span className="ml-2 text-slate-500">visit{visitCount === 1 ? "" : "s"} this day</span>
            </p>
          ) : (
            <VisitVolumeChart period={period} rows={volumeRows} />
          )}
        </section>

        <section className="rounded-3xl border border-slate-100 bg-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <MapPin className="size-4 text-ocs-teal" aria-hidden />
            <div>
              <h2 className="text-base font-semibold text-ocs-slate">Patients by home location</h2>
              <p className="text-xs text-slate-500">Unique patients, from the patient record</p>
            </div>
          </div>
          <LocationVolumeBars rows={locationRows} />
        </section>
      </div>

      {patientsSeen.length ? (
        <section className="rounded-3xl border border-slate-100 bg-white p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ocs-slate">Patients seen</h2>
              <p className="text-xs text-slate-500">
                {uniquePatientCount} unique patient{uniquePatientCount === 1 ? "" : "s"} with a saved note
              </p>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {patientsSeen.slice(0, isMobile ? 8 : 12).map((patient) => (
              <Link
                key={patient.patient_id}
                to={`/patients/${patient.patient_id}`}
                className="flex items-center gap-3 py-3 hover:bg-slate-50/80"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{patient.patient_name}</p>
                  <p className="text-xs text-slate-500">
                    {patient.patient_identifier || "No care number"} · last note {formatDate(patient.consultation_date)}
                  </p>
                </div>
                <ChevronRight className="size-4 text-slate-300" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {Array.isArray(statement.paymentMethodBreakdown) &&
      statement.paymentMethodBreakdown.some((row) => Number(row.amount || 0) > 0) &&
      !isDoctor ? (
        <section className="rounded-3xl border border-slate-100 bg-white p-5">
          <h2 className="text-base font-semibold text-ocs-slate">Paid by method</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statement.paymentMethodBreakdown.map((row) => (
              <div key={row.method} className="rounded-2xl bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {formatPaymentMethod(row.method)}
                </p>
                <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                  {formatCurrency(row.amount)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
