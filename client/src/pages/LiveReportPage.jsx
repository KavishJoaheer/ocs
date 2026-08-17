import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  MapPin,
  Search,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { useIsMobile } from "../hooks/useIsMobile.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { api } from "../lib/api.js";
import { formatCurrency, formatDate, formatPaymentMethod } from "../lib/format.js";
import {
  REPORT_PERIOD_OPTIONS,
  canShiftPeriodForward,
  downloadCsv,
  formatRangeLabel,
  getTodayInputValue,
  normalizeReportPeriod,
  shiftAnchorDate,
  yearOptions,
} from "../lib/reportPeriod.js";
import { cx } from "../lib/utils.js";
import dayjs from "dayjs";

const LOCATION_BAR_LIMIT = 8;
const BILL_PAGE_SIZE = 12;
const PATIENT_PAGE_SIZE = 12;

function percentLabel(rate) {
  return `${Math.round(Number(rate || 0) * 100)}%`;
}

function collectionPercent(rate) {
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

function billingHref({ status, patientId, billId, period, date } = {}) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (patientId) params.set("patientId", String(patientId));
  if (billId) params.set("billId", String(billId));
  if (period) params.set("period", period);
  if (date) params.set("date", date);
  return `/billing?${params.toString()}`;
}

function PeriodControls({
  period,
  onPeriodChange,
  anchorDate,
  onAnchorDateChange,
  compact = false,
  today,
}) {
  const dateLabel = REPORT_PERIOD_OPTIONS.find((option) => option.id === period)?.dateLabel || "Date";
  const canGoNext = canShiftPeriodForward(period, anchorDate, today);
  const years = useMemo(() => yearOptions(today), [today]);

  return (
    <div
      className={cx(
        "flex min-w-0 items-center gap-2",
        compact ? "flex-col items-stretch sm:flex-row" : "flex-row flex-wrap justify-end",
      )}
    >
      <div
        className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-100 p-1"
        role="group"
        aria-label="Report period"
      >
        {REPORT_PERIOD_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPeriodChange(option.id)}
            className={cx(
              "shrink-0 rounded-xl px-3.5 text-sm font-semibold transition",
              compact ? "min-h-10" : "min-h-9",
              period === option.id
                ? "bg-white text-ocs-slate shadow-sm"
                : "text-slate-500 hover:text-slate-800",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex min-h-9 items-center gap-1 rounded-2xl border border-slate-200 bg-white px-1.5 py-1">
        <button
          type="button"
          aria-label="Previous period"
          onClick={() => onAnchorDateChange(shiftAnchorDate(period, anchorDate, -1))}
          className="grid size-8 place-items-center rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        >
          <ChevronLeft className="size-4" />
        </button>
        <label className="flex min-w-0 items-center gap-2 px-1">
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gray-400">
            {dateLabel}
          </span>
          {period === "monthly" ? (
            <input
              type="month"
              value={String(anchorDate || today).slice(0, 7)}
              max={String(today).slice(0, 7)}
              onChange={(event) => onAnchorDateChange(`${event.target.value}-01`)}
              className="min-w-0 bg-transparent text-sm font-semibold text-slate-700 outline-none accent-ocs-teal"
            />
          ) : period === "annual" ? (
            <select
              value={dayjs(anchorDate || today).year()}
              onChange={(event) => onAnchorDateChange(`${event.target.value}-01-01`)}
              className="bg-transparent text-sm font-semibold text-slate-700 outline-none"
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              value={anchorDate}
              max={today}
              onChange={(event) => onAnchorDateChange(event.target.value)}
              className="min-w-0 bg-transparent text-sm font-semibold text-slate-700 outline-none accent-ocs-teal"
            />
          )}
        </label>
        <button
          type="button"
          aria-label="Next period"
          disabled={!canGoNext}
          onClick={() => onAnchorDateChange(shiftAnchorDate(period, anchorDate, 1))}
          className="grid size-8 place-items-center rounded-xl text-slate-500 hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function EmptyPanel({ title, detail }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-2xl bg-slate-50 px-6 py-8 text-center md:min-h-40">
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {detail ? <p className="mt-1 max-w-sm text-xs leading-5 text-slate-400">{detail}</p> : null}
    </div>
  );
}

function StatementStat({ label, value, hint, tone = "default", to }) {
  const className = cx(
    "flex h-full min-h-[6.5rem] flex-col justify-center gap-1.5 px-5 py-5 xl:min-h-[7.5rem]",
    tone === "unpaid" && "bg-rose-50/60",
    tone === "negative" && "bg-rose-50/60",
    to && "transition hover:bg-rose-50",
  );
  const body = (
    <>
      <p
        className={cx(
          "text-[11px] font-bold uppercase tracking-widest",
          tone === "unpaid" || tone === "negative" ? "text-rose-500" : "text-slate-400",
        )}
      >
        {label}
      </p>
      <p className="text-2xl font-black tabular-nums tracking-tight text-slate-900">{value}</p>
      {hint ? <p className="text-[11px] leading-4 text-slate-400">{hint}</p> : null}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
}

function DesktopBillTable({ rows, onOpen, showDoctor }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-4 py-3 font-bold">Patient</th>
            {showDoctor ? <th className="px-4 py-3 font-bold">Doctor</th> : null}
            <th className="px-4 py-3 font-bold">Consultation</th>
            <th className="px-4 py-3 text-right font-bold">Amount</th>
            <th className="px-4 py-3 text-right font-bold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.bill_id}
              tabIndex={0}
              role="button"
              className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/80 focus:bg-slate-50 focus:outline-none"
              onClick={() => onOpen(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(row);
                }
              }}
            >
              <td className="px-4 py-3 font-semibold text-slate-900">{row.patient_name}</td>
              {showDoctor ? (
                <td className="px-4 py-3 text-slate-500">{row.doctor_name || "—"}</td>
              ) : null}
              <td className="px-4 py-3 text-slate-500">{formatDate(row.consultation_date)}</td>
              <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                {formatCurrency(row.total_amount)}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end">
                  <StatusBadge value={row.status} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatTile({ label, value, hint, tone = "default", to, onClick }) {
  const className = cx(
    "rounded-2xl border p-4",
    tone === "unpaid" || tone === "negative"
      ? "border-rose-100 bg-rose-50/70"
      : "border-slate-100 bg-slate-50",
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
    return <EmptyPanel title="No locations in this period" detail="Home locations appear after a consultation note is saved." />;
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
            <div className="h-2 min-w-0 flex-1 rounded-full bg-slate-100 md:h-2.5">
              <div className="h-2 rounded-full bg-ocs-teal md:h-2.5" style={{ width: `${widthPercent}%` }} />
            </div>
            <p className="w-8 shrink-0 text-right text-sm font-bold tabular-nums text-ocs-slate">{count}</p>
          </div>
        );
      })}
    </div>
  );
}

function VisitVolumeChart({ rows }) {
  const data = Array.isArray(rows) ? rows : [];

  if (!data.length || data.every((row) => Number(row.patient_count || 0) === 0)) {
    return (
      <EmptyPanel
        title="No visits in this period"
        detail="The chart fills in as consultation notes are saved."
      />
    );
  }

  return (
    <div className="h-56 w-full min-w-0 md:h-64 xl:h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} width={28} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(45, 143, 152, 0.06)" }}
            formatter={(value) => [value, "Visits"]}
            contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
          />
          <Bar dataKey="patient_count" fill="#2d8f98" radius={[6, 6, 0, 0]} maxBarSize={40} />
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

function BillRow({ row, onOpen, showDoctor }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="flex w-full items-center gap-3 border-t border-slate-100 px-1 py-3 text-left transition hover:bg-slate-50/80"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900">{row.patient_name}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {showDoctor && row.doctor_name
            ? `${row.doctor_name} · ${formatDate(row.consultation_date)}`
            : formatDate(row.consultation_date)}
        </p>
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

function SegmentedToggle({ value, onChange, options, ariaLabel }) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cx(
            "rounded-lg px-3 py-1.5 text-xs font-semibold",
            value === option.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function LiveReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const today = useMemo(() => getTodayInputValue(), []);
  const period = normalizeReportPeriod(searchParams.get("period"), "monthly");
  const dateParam = String(searchParams.get("date") || "");
  const anchorDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;
  const dateBasis = searchParams.get("basis") === "payment" ? "payment" : "visit";
  const doctorScope = searchParams.get("scope") === "doctor" ? "doctor" : "general";
  const selectedDoctorId = String(searchParams.get("doctorId") || "");
  const billStatusFilter = ["paid", "unpaid"].includes(searchParams.get("bills") || "")
    ? searchParams.get("bills")
    : "all";

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [billQuery, setBillQuery] = useState("");
  const [billsVisible, setBillsVisible] = useState(BILL_PAGE_SIZE);
  const [patientQuery, setPatientQuery] = useState("");
  const [patientsVisible, setPatientsVisible] = useState(PATIENT_PAGE_SIZE);
  const refreshKey = useLiveRefreshKey();
  const hasReportRef = useRef(false);
  const isAdmin = user.role === "admin";
  const isDoctor = user.role === "doctor";

  function patchParams(updates) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    if (!next.get("period")) next.set("period", period);
    if (!next.get("date")) next.set("date", anchorDate);
    setSearchParams(next, { replace: true });
  }

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
          dateBasis,
        });
        if (isAdmin && doctorScope === "doctor" && selectedDoctorId) {
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
  }, [anchorDate, dateBasis, doctorScope, isAdmin, period, selectedDoctorId, refreshKey]);

  useEffect(() => {
    setBillsVisible(BILL_PAGE_SIZE);
    setBillQuery("");
    setPatientsVisible(PATIENT_PAGE_SIZE);
    setPatientQuery("");
  }, [anchorDate, period, doctorScope, selectedDoctorId, dateBasis]);

  useEffect(() => {
    if (!report) return;
    if (searchParams.get("period") && searchParams.get("date")) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!next.get("period")) next.set("period", period);
      if (!next.get("date")) next.set("date", anchorDate);
      return next;
    }, { replace: true });
  }, [anchorDate, period, report, searchParams, setSearchParams]);

  const doctors = report?.doctors || [];

  useEffect(() => {
    if (!isAdmin || doctorScope !== "doctor" || selectedDoctorId || !doctors.length) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("scope", "doctor");
      next.set("doctorId", String(doctors[0].id));
      if (!next.get("period")) next.set("period", "monthly");
      if (!next.get("date")) next.set("date", today);
      return next;
    }, { replace: true });
  }, [doctors, doctorScope, isAdmin, selectedDoctorId, setSearchParams, today]);

  const statement = report?.revenueStatement || {};
  const shareRates = statement.shareRates || { doctor: 0.4, ocs: 0.6, transportPerPatient: 300 };
  const volumeRows = report?.volumeReport?.rows || [];
  const locationRows = report?.locationReport?.rows || [];
  const revenueRows = report?.billingRevenueReport?.rows || [];
  const patientsSeen = report?.patientsSeenReport?.rows || [];
  const doctorRows = report?.doctorReport?.rows || [];
  const visitCount = Number(report?.volumeReport?.visitCount ?? statement.visitCount ?? 0);
  const uniquePatientCount = Number(
    report?.volumeReport?.uniquePatientCount ?? statement.uniquePatientCount ?? 0,
  );
  const rangeLabel = formatRangeLabel(
    period,
    report?.volumeReport?.rangeStart,
    report?.volumeReport?.rangeEnd,
  );
  const billed = Number(statement.billedRevenue ?? statement.totalRevenue ?? 0);
  const collected = Number(statement.paidRevenue || 0);
  const unpaid = Number(statement.unpaidRevenue || 0);
  const doctorNet = Number(statement.doctorNetRevenue || 0);
  const ocsRemainder = Number(statement.ocsRemainder ?? collected - doctorNet);
  const collectionRate = Number(statement.collectionRate || 0);
  const transportCount = Number(statement.transportPatientCount ?? uniquePatientCount);
  const showClinicDoctors = isAdmin && doctorScope === "general";
  const unpaidHref = billingHref({ status: "unpaid", period, date: anchorDate });
  const doctorShareLabel = `${percentLabel(shareRates.doctor)} of paid`;

  const filteredBills = useMemo(() => {
    const query = billQuery.trim().toLowerCase();
    return revenueRows.filter((row) => {
      if (billStatusFilter === "paid" && row.status !== "paid") return false;
      if (billStatusFilter === "unpaid" && row.status === "paid") return false;
      if (!query) return true;
      return (
        String(row.patient_name || "")
          .toLowerCase()
          .includes(query) ||
        String(row.doctor_name || "")
          .toLowerCase()
          .includes(query) ||
        String(row.patient_identifier || "")
          .toLowerCase()
          .includes(query) ||
        String(row.bill_id || "").includes(query)
      );
    });
  }, [billQuery, billStatusFilter, revenueRows]);

  const visibleBills = filteredBills.slice(0, billsVisible);

  const filteredPatients = useMemo(() => {
    const query = patientQuery.trim().toLowerCase();
    if (!query) return patientsSeen;
    return patientsSeen.filter(
      (patient) =>
        String(patient.patient_name || "")
          .toLowerCase()
          .includes(query) ||
        String(patient.patient_identifier || "")
          .toLowerCase()
          .includes(query),
    );
  }, [patientQuery, patientsSeen]);

  const visiblePatients = filteredPatients.slice(0, patientsVisible);

  function openBill(row) {
    navigate(
      billingHref({
        patientId: row.patient_id,
        status: row.status === "paid" ? "paid" : "unpaid",
        billId: row.bill_id,
        period,
        date: anchorDate,
      }),
    );
  }

  function exportCsv() {
    const rows = [
      ["Revenue Report"],
      ["Period", rangeLabel || period],
      ["Scope", report?.volumeReport?.entityLabel || ""],
      ["Money follows", dateBasis === "payment" ? "Payment date" : "Visit date"],
      ["Collected", collected],
      ["Billed", billed],
      ["Unpaid", unpaid],
      ["Doctor net", doctorNet],
      ["OCS remainder", isDoctor ? "" : ocsRemainder],
      ["Visits", visitCount],
      ["Unique patients", uniquePatientCount],
      [],
    ];

    if (showClinicDoctors && doctorRows.length) {
      rows.push(["Doctors"]);
      rows.push(["Doctor", "Visits", "Patients", "Collected", "Unpaid", "Net"]);
      for (const row of doctorRows) {
        rows.push([
          row.doctor_name,
          row.visit_count,
          row.unique_patient_count,
          row.paid,
          row.unpaid,
          row.doctorNetRevenue,
        ]);
      }
      rows.push([]);
    }

    rows.push(["Bills"]);
    rows.push(["Bill ID", "Patient", "Identifier", "Doctor", "Consultation", "Payment date", "Amount", "Status", "Method"]);
    for (const row of revenueRows) {
      rows.push([
        row.bill_id,
        row.patient_name,
        row.patient_identifier || "",
        row.doctor_name || "",
        row.consultation_date || "",
        row.payment_date || "",
        row.total_amount,
        row.status,
        row.payment_method,
      ]);
    }

    const stamp = `${period}-${anchorDate}`;
    downloadCsv(`revenue-report-${stamp}.csv`, rows);
  }

  if (loading && !report) return <LoadingState label="Loading revenue report" />;
  if (!report) {
    return (
      <EmptyState title="Revenue report unavailable" description="Unable to load report data." />
    );
  }

  return (
    <div className={cx("space-y-5 md:space-y-6", refreshing && "opacity-90")}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 md:hidden">
            Analytics
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-ocs-slate md:mt-0 md:text-3xl">
            Revenue Report
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {rangeLabel || "Selected period"}
            {report.volumeReport?.entityLabel ? ` · ${report.volumeReport.entityLabel}` : ""}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {dateBasis === "payment"
              ? "Collected follows payment date. Unpaid is still visits in this window."
              : "Money follows the visit date."}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 md:items-end">
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            {isAdmin && doctors.length > 0 ? (
              <>
                <SegmentedToggle
                  ariaLabel="Report scope"
                  value={doctorScope}
                  onChange={(next) => {
                    if (next === "general") patchParams({ scope: "clinic", doctorId: "" });
                    else {
                      patchParams({
                        scope: "doctor",
                        doctorId: selectedDoctorId || String(doctors[0]?.id || ""),
                      });
                    }
                  }}
                  options={[
                    { id: "general", label: "Clinic" },
                    { id: "doctor", label: "Doctor" },
                  ]}
                />
                {doctorScope === "doctor" ? (
                  <select
                    value={selectedDoctorId || String(report.doctorReport?.selectedDoctorId || "")}
                    onChange={(event) => patchParams({ scope: "doctor", doctorId: event.target.value })}
                    className="max-w-[16rem] rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    {doctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.full_name}
                      </option>
                    ))}
                  </select>
                ) : null}
              </>
            ) : null}
            <SegmentedToggle
              ariaLabel="Money date basis"
              value={dateBasis}
              onChange={(next) => patchParams({ basis: next })}
              options={[
                { id: "visit", label: "Visit date" },
                { id: "payment", label: "Payment date" },
              ]}
            />
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Download className="size-3.5" />
              CSV
            </button>
          </div>
          <PeriodControls
            period={period}
            onPeriodChange={(next) => patchParams({ period: next })}
            anchorDate={anchorDate}
            onAnchorDateChange={(next) => patchParams({ date: next })}
            compact={isMobile}
            today={today}
          />
        </div>
      </div>

      {isDoctor ? (
        <>
          <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white md:hidden">
            <div className="border-l-4 border-l-ocs-teal px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Your net</p>
              <p className="mt-2 text-4xl font-black tabular-nums tracking-tight text-ocs-teal">
                {formatCurrency(doctorNet)}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {doctorShareLabel} plus Rs {shareRates.transportPerPatient} × {transportCount} patient
                {transportCount === 1 ? "" : "s"}. Unpaid is separate.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px bg-slate-100">
              <div className="bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Paid</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                  {formatCurrency(collected)}
                </p>
              </div>
              <Link to={unpaidHref} className="bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-400">Unpaid</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                  {formatCurrency(unpaid)}
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

          <section className="hidden overflow-hidden rounded-2xl border border-slate-100 bg-white md:block">
            <div className="grid xl:grid-cols-12">
              <div className="flex flex-col justify-center border-l-4 border-l-ocs-teal px-6 py-5 xl:col-span-4 xl:py-6">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Your net</p>
                <p className="mt-2 text-4xl font-black tabular-nums tracking-tight text-ocs-teal">
                  {formatCurrency(doctorNet)}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {doctorShareLabel} + Rs {shareRates.transportPerPatient} × {transportCount} patient
                  {transportCount === 1 ? "" : "s"} seen
                </p>
              </div>
              <div className="grid grid-cols-4 divide-x divide-slate-100 border-t border-slate-100 xl:col-span-8 xl:border-l xl:border-t-0">
                <StatementStat label="Paid" value={formatCurrency(collected)} />
                <StatementStat label="Unpaid" value={formatCurrency(unpaid)} tone="unpaid" to={unpaidHref} />
                <StatementStat label="Visits" value={visitCount} />
                <StatementStat label="Patients" value={uniquePatientCount} />
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="space-y-3 md:hidden">
            <div className="overflow-hidden rounded-3xl border border-slate-100 bg-white">
              <div className="border-l-4 border-l-ocs-teal px-5 py-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Collected this period
                </p>
                <p className="mt-2 text-4xl font-black tabular-nums tracking-tight text-ocs-teal">
                  {formatCurrency(collected)}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {dateBasis === "payment"
                    ? "Cash that landed in this window"
                    : `${formatCurrency(billed)} billed · ${collectionPercent(collectionRate)} collected`}
                  {` · ${visitCount} visit${visitCount === 1 ? "" : "s"} · ${uniquePatientCount} patient${uniquePatientCount === 1 ? "" : "s"}`}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Unpaid" value={formatCurrency(unpaid)} tone="unpaid" to={unpaidHref} />
              <StatTile
                label="Doctor net"
                value={formatCurrency(doctorNet)}
                hint={`${percentLabel(shareRates.doctor)} + Rs ${shareRates.transportPerPatient} × ${transportCount}`}
              />
              <StatTile
                label="OCS remainder"
                value={formatCurrency(ocsRemainder)}
                tone={ocsRemainder < 0 ? "negative" : "default"}
                hint="Paid minus doctor net"
              />
              <StatTile
                label="Visits"
                value={visitCount}
                hint={`${uniquePatientCount} unique patient${uniquePatientCount === 1 ? "" : "s"}`}
              />
            </div>
          </section>

          <section className="hidden overflow-hidden rounded-2xl border border-slate-100 bg-white md:block">
            <div className="grid xl:grid-cols-12">
              <div className="flex flex-col justify-center border-l-4 border-l-ocs-teal px-6 py-5 xl:col-span-4 xl:py-6">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                  Collected this period
                </p>
                <p className="mt-2 text-4xl font-black tabular-nums tracking-tight text-ocs-teal">
                  {formatCurrency(collected)}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {dateBasis === "payment"
                    ? "Cash that landed in this window"
                    : `${formatCurrency(billed)} billed · ${collectionPercent(collectionRate)} collected`}
                </p>
              </div>
              <div className="grid grid-cols-4 divide-x divide-slate-100 border-t border-slate-100 xl:col-span-8 xl:border-l xl:border-t-0">
                <StatementStat label="Unpaid" value={formatCurrency(unpaid)} tone="unpaid" to={unpaidHref} />
                <StatementStat
                  label="Doctor net"
                  value={formatCurrency(doctorNet)}
                  hint={`${percentLabel(shareRates.doctor)} + Rs ${shareRates.transportPerPatient} × ${transportCount}`}
                />
                <StatementStat
                  label="OCS remainder"
                  value={formatCurrency(ocsRemainder)}
                  tone={ocsRemainder < 0 ? "negative" : "default"}
                  hint="Paid minus doctor net"
                />
                <StatementStat
                  label="Visits"
                  value={visitCount}
                  hint={`${uniquePatientCount} patient${uniquePatientCount === 1 ? "" : "s"}`}
                />
              </div>
            </div>
          </section>
        </>
      )}

      {showClinicDoctors ? (
        <section className="rounded-2xl border border-slate-100 bg-white p-5 md:p-6">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-ocs-slate">Doctors this period</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Net is 40% of that doctor's paid plus Rs {shareRates.transportPerPatient} per patient they
              saw. Click a row to open their report.
            </p>
          </div>
          {doctorRows.length === 0 ? (
            <EmptyPanel title="No doctor activity" detail="Saved notes and bills will appear here." />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-100">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-bold">Doctor</th>
                    <th className="px-4 py-3 text-right font-bold">Visits</th>
                    <th className="px-4 py-3 text-right font-bold">Patients</th>
                    <th className="px-4 py-3 text-right font-bold">Collected</th>
                    <th className="px-4 py-3 text-right font-bold">Unpaid</th>
                    <th className="px-4 py-3 text-right font-bold">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {doctorRows.map((row) => (
                    <tr
                      key={row.doctor_id}
                      tabIndex={0}
                      role="button"
                      className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/80 focus:bg-slate-50 focus:outline-none"
                      onClick={() => patchParams({ scope: "doctor", doctorId: String(row.doctor_id) })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          patchParams({ scope: "doctor", doctorId: String(row.doctor_id) });
                        }
                      }}
                    >
                      <td className="px-4 py-3 font-semibold text-slate-900">{row.doctor_name}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{row.visit_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {row.unique_patient_count}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-900">
                        {formatCurrency(row.paid)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                        {formatCurrency(row.unpaid)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-ocs-teal">
                        {formatCurrency(row.doctorNetRevenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12 md:items-start">
        <section className="rounded-2xl border border-slate-100 bg-white p-5 md:col-span-7 md:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ocs-slate">Bills</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {isMobile ? "Tap a row to open billing." : "Click a row to open that bill."}
              </p>
            </div>
            <Link
              to={billingHref({ period, date: anchorDate })}
              className="text-xs font-semibold text-ocs-teal hover:underline"
            >
              Open billing
            </Link>
          </div>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={billQuery}
                onChange={(event) => {
                  setBillQuery(event.target.value);
                  setBillsVisible(BILL_PAGE_SIZE);
                }}
                placeholder="Search patient, doctor, or bill ID"
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-ocs-teal focus:bg-white"
              />
            </label>
            <SegmentedToggle
              ariaLabel="Bill status"
              value={billStatusFilter}
              onChange={(next) => patchParams({ bills: next === "all" ? "" : next })}
              options={[
                { id: "all", label: "All" },
                { id: "paid", label: "Paid" },
                { id: "unpaid", label: "Unpaid" },
              ]}
            />
          </div>
          {filteredBills.length === 0 ? (
            <EmptyPanel
              title="No bills in this period"
              detail="Consultation bills and bag sales will show up here."
            />
          ) : isMobile ? (
            <div>
              {visibleBills.map((row) => (
                <BillRow
                  key={row.bill_id}
                  row={row}
                  onOpen={openBill}
                  showDoctor={showClinicDoctors}
                />
              ))}
            </div>
          ) : (
            <DesktopBillTable rows={visibleBills} onOpen={openBill} showDoctor={showClinicDoctors} />
          )}
          {filteredBills.length > billsVisible ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={() => setBillsVisible((current) => current + BILL_PAGE_SIZE)}
                className="min-h-10 rounded-2xl bg-ocs-teal px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Show more ({filteredBills.length - billsVisible} left)
              </button>
            </div>
          ) : null}
        </section>

        <section
          className={cx(
            "rounded-2xl border border-slate-100 bg-white p-5 md:col-span-5 md:p-6",
            patientsSeen.length === 0 && "hidden md:block",
          )}
        >
          <div className="mb-4">
            <h2 className="text-base font-semibold text-ocs-slate">Patients seen</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {uniquePatientCount} unique patient{uniquePatientCount === 1 ? "" : "s"} with a saved note
              {uniquePatientCount > patientsSeen.length
                ? ` · showing ${patientsSeen.length}`
                : ""}
            </p>
          </div>
          {patientsSeen.length ? (
            <>
              <label className="relative mb-2 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={patientQuery}
                  onChange={(event) => {
                    setPatientQuery(event.target.value);
                    setPatientsVisible(PATIENT_PAGE_SIZE);
                  }}
                  placeholder="Search patients"
                  className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-ocs-teal focus:bg-white"
                />
              </label>
              <div className="divide-y divide-slate-100">
                {visiblePatients.map((patient) => (
                  <Link
                    key={patient.patient_id}
                    to={`/patients/${patient.patient_id}`}
                    className="flex items-center gap-3 py-3 hover:bg-slate-50/80"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-slate-900">{patient.patient_name}</p>
                      <p className="text-xs text-slate-500">
                        {patient.patient_identifier
                          ? `${patient.patient_identifier} · ${formatDate(patient.consultation_date)}`
                          : formatDate(patient.consultation_date)}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-slate-300" aria-hidden />
                  </Link>
                ))}
              </div>
              {filteredPatients.length > patientsVisible ? (
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setPatientsVisible((current) => current + PATIENT_PAGE_SIZE)}
                    className="text-xs font-semibold text-ocs-teal hover:underline"
                  >
                    Show more
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <EmptyPanel
              title="No patients seen yet"
              detail="People appear here after you save a consultation note."
            />
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-slate-100 bg-white p-5 md:p-6">
          <div className="mb-4 flex items-center gap-2">
            <Users className="size-4 text-ocs-teal" aria-hidden />
            <div>
              <h2 className="text-base font-semibold text-ocs-slate">Visit volume</h2>
              <p className="text-xs text-slate-500">Consultation notes by visit date, including quiet days</p>
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
            <VisitVolumeChart rows={volumeRows} />
          )}
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-5 md:p-6">
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

      {Array.isArray(statement.paymentMethodBreakdown) &&
      statement.paymentMethodBreakdown.some((row) => Number(row.amount || 0) > 0) &&
      !isDoctor ? (
        <section className="rounded-2xl border border-slate-100 bg-white p-5 md:p-6">
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
