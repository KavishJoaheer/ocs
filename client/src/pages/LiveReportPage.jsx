import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { api } from "../lib/api.js";
import { formatCurrency } from "../lib/format.js";
import { cx } from "../lib/utils.js";

const PERIOD_OPTIONS = [
  { id: "annual", label: "Yearly" },
  { id: "monthly", label: "Monthly" },
  { id: "weekly", label: "Weekly" },
  { id: "daily", label: "Specific date" },
];

const CHART_COLORS = ["#2d8f98", "#41c8c6", "#f1bc35", "#5a7c89", "#9ad0d2", "#d7eef0"];

function getTodayInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function formatInteger(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

/** Title-case first letter of each word (billing status / payment method). */
function titleCaseWords(value) {
  if (value == null || value === "") return "";
  return String(value)
    .trim()
    .split(/\s+/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ""))
    .join(" ");
}

function FilterButtonGroup({ value, onChange, compact = false }) {
  return (
    <div className={cx("flex flex-row items-center gap-2", compact && "flex-shrink-0")}>
      {PERIOD_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={cx(
            "rounded-2xl font-semibold transition",
            compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
            value === option.id
              ? "bg-sky-600 text-white shadow-md shadow-sky-600/20"
              : "border border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function DateField({ value, onChange, compact = false }) {
  return (
    <label
      className={cx(
        "flex flex-row items-center gap-2 rounded-2xl border border-slate-200 bg-white",
        compact ? "px-3 py-1.5" : "px-4 py-2.5",
      )}
    >
      <span className={cx("font-semibold text-slate-600", compact ? "text-xs" : "text-sm")}>Date</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cx(
          "bg-transparent font-medium text-slate-700 outline-none",
          compact ? "text-xs" : "text-sm",
        )}
      />
    </label>
  );
}

function exportCsv(fileName, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
  XLSX.writeFile(workbook, `${fileName}.csv`);
}

function downloadFullLiveReportPdf({
  statement,
  revenueRows,
  volumeRows,
  locationRows,
  period,
  anchorDate,
}) {
  const doc = new jsPDF();
  let y = 20;
  const pageBottom = 280;
  const line = (text, size = 11) => {
    doc.setFontSize(size);
    if (y > pageBottom) {
      doc.addPage();
      y = 20;
    }
    doc.text(String(text), 14, y);
    y += size > 12 ? 9 : 6;
  };

  doc.setFontSize(16);
  line("Live Report Statement", 16);
  doc.setFontSize(10);
  line(`Period: ${period} · Anchor: ${anchorDate}`, 10);
  y += 4;

  doc.setFontSize(12);
  line("Revenue statement", 12);
  doc.setFontSize(11);
  [
    `Total Revenue: ${formatCurrency(statement.totalRevenue || 0)}`,
    `OCS Commission (60%): ${formatCurrency(statement.ocsCommission || 0)}`,
    `Doctor Commission (40%): ${formatCurrency(statement.doctorCommission || 0)}`,
    `Transport Benefits: ${formatCurrency(statement.transportBenefits || 0)}`,
    `Doctor Net Revenue: ${formatCurrency(statement.doctorNetRevenue || 0)}`,
    `Paid Revenue: ${formatCurrency(statement.paidRevenue || 0)}`,
    `Unpaid Revenue: ${formatCurrency(statement.unpaidRevenue || 0)}`,
  ].forEach((t) => line(t, 11));
  y += 4;

  line("Revenue reports (line items)", 12);
  doc.setFontSize(10);
  revenueRows.forEach((r) => {
    line(`${r.patient_name} · ${r.consultation_date} · ${formatCurrency(r.total_amount)} · ${r.status}`, 10);
  });
  y += 4;

  line("Patients volume", 12);
  doc.setFontSize(10);
  volumeRows.forEach((r) => {
    line(`${r.label}: ${formatInteger(r.patient_count)}`, 10);
  });
  y += 4;

  line("Patients seen per location", 12);
  doc.setFontSize(10);
  locationRows.forEach((r) => {
    line(`${r.location}: ${formatInteger(r.patient_count)}`, 10);
  });

  doc.save(`live_report_statement_${anchorDate}.pdf`);
}

function exportLiveReportSpreadsheet({
  statement,
  revenueRows,
  volumeRows,
  locationRows,
  anchorDate,
}) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([
      {
        totalRevenue: statement.totalRevenue,
        ocsCommission: statement.ocsCommission,
        doctorCommission: statement.doctorCommission,
        transportBenefits: statement.transportBenefits,
        doctorNetRevenue: statement.doctorNetRevenue,
        paidRevenue: statement.paidRevenue,
        unpaidRevenue: statement.unpaidRevenue,
      },
    ]),
    "Revenue Statement",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(revenueRows.length ? revenueRows : [{ note: "No rows" }]),
    "Revenue Reports",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(volumeRows.length ? volumeRows : [{ note: "No rows" }]),
    "Volume",
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(locationRows.length ? locationRows : [{ note: "No rows" }]),
    "Locations",
  );
  XLSX.writeFile(wb, `live_report_statement_${anchorDate}.xlsx`);
}

function ExportStatementMenu({
  statement,
  revenueRows,
  volumeRows,
  locationRows,
  period,
  anchorDate,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleMouseDown(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-2xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#26717c]"
      >
        <Download className="size-4" />
        Export statement
        <ChevronDown className={`size-4 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 min-w-[200px] rounded-2xl border border-slate-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            className="block w-full px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setOpen(false);
              downloadFullLiveReportPdf({
                statement,
                revenueRows,
                volumeRows,
                locationRows,
                period,
                anchorDate,
              });
            }}
          >
            Download PDF
          </button>
          <button
            type="button"
            className="block w-full px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setOpen(false);
              exportLiveReportSpreadsheet({
                statement,
                revenueRows,
                volumeRows,
                locationRows,
                anchorDate,
              });
            }}
          >
            Download spreadsheet (Excel)
          </button>
          <button
            type="button"
            className="block w-full px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setOpen(false);
              exportCsv(`live_report_statement_${anchorDate}`, [
                {
                  totalRevenue: statement.totalRevenue,
                  ocsCommission: statement.ocsCommission,
                  doctorCommission: statement.doctorCommission,
                  transportBenefits: statement.transportBenefits,
                  doctorNetRevenue: statement.doctorNetRevenue,
                  paidRevenue: statement.paidRevenue,
                  unpaidRevenue: statement.unpaidRevenue,
                },
              ]);
            }}
          >
            Download CSV (summary)
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function LiveReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = useMemo(() => getTodayInputValue(), []);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("monthly");
  const [anchorDate, setAnchorDate] = useState(today);
  const [doctorScope, setDoctorScope] = useState("general");
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [isRevenueExpanded, setIsRevenueExpanded] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function loadReport() {
      setLoading(true);
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
        if (!ignore) setReport(response);
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
          setReport(null);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadReport();
    return () => {
      ignore = true;
    };
  }, [anchorDate, doctorScope, period, selectedDoctorId]);

  useEffect(() => {
    setIsRevenueExpanded(false);
  }, [report?.billingRevenueReport?.rows?.length, anchorDate, period, doctorScope, selectedDoctorId]);

  if (loading) return <LoadingState label="Loading live report" />;
  if (!report) return <EmptyState title="Live report unavailable" description="Unable to load report data." />;

  const locationRows = report.locationReport?.rows || [];
  const volumeRows = report.volumeReport?.rows || [];
  const revenueRows = report.billingRevenueReport?.rows || [];
  const visibleRevenueRows = isRevenueExpanded ? revenueRows : revenueRows.slice(0, 3);
  const statement = report.revenueStatement || {};

  const timeAndExportControls = (
    <div className="flex flex-row flex-wrap items-center justify-end gap-2">
      <FilterButtonGroup value={period} onChange={setPeriod} compact />
      <DateField value={anchorDate} onChange={setAnchorDate} compact />
      <ExportStatementMenu
        statement={statement}
        revenueRows={revenueRows}
        volumeRows={volumeRows}
        locationRows={locationRows}
        period={period}
        anchorDate={anchorDate}
      />
    </div>
  );

  const isAdmin = user.role === "admin";
  const isAdminWithDoctors = isAdmin && (report.doctors || []).length > 0;

  return (
    <div className="space-y-4">
      {isAdminWithDoctors ? (
        <div className="flex w-full min-w-0 max-w-full flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Analytics</p>
              <h1 className="mt-1 break-words font-display text-2xl font-semibold leading-tight tracking-tight text-slate-950 md:text-3xl">
                Live Report
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-0.5 shadow-inner"
                role="group"
                aria-label="Report scope"
              >
                <button
                  type="button"
                  onClick={() => setDoctorScope("general")}
                  className={cx(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    doctorScope === "general"
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  General
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDoctorScope("doctor");
                    if (!selectedDoctorId && (report.doctors || []).length) {
                      setSelectedDoctorId(String(report.doctors[0].id));
                    }
                  }}
                  className={cx(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
                    doctorScope === "doctor"
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200/80"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                >
                  Doctor
                </button>
              </div>
              {doctorScope === "doctor" ? (
                <select
                  value={selectedDoctorId || String(report.doctorReport?.selectedDoctorId || "")}
                  onChange={(event) => setSelectedDoctorId(event.target.value)}
                  className="max-w-[min(100%,16rem)] rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600"
                >
                  {(report.doctors || []).map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.full_name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>
          <div className="min-w-0 shrink-0 lg:ml-auto">{timeAndExportControls}</div>
        </div>
      ) : (
        <PageHeader eyebrow="Analytics" title="Live Report" actions={timeAndExportControls} />
      )}

      <SectionCard title="Revenue Statement">
        {isAdmin ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div
              className={cx(
                "rounded-2xl border-2 border-[#2d8f98] bg-teal-50/90 p-4 shadow-sm sm:col-span-2 xl:col-span-2",
              )}
            >
              <p className="text-xs font-bold uppercase tracking-wide text-[#1a5c62]">Total Revenue</p>
              <p className="mt-2 text-4xl font-bold text-teal-700">
                {formatCurrency(statement.totalRevenue || 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">OCS Commission (60%)</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(statement.ocsCommission || 0)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">Doctor Commission (40%)</p>
              <p className="mt-2 text-xl font-bold text-slate-900">
                {formatCurrency(statement.doctorCommission || 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">Doctor Net Revenue</p>
              <p className="mt-2 text-xl font-bold text-slate-900">
                {formatCurrency(statement.doctorNetRevenue || 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">Paid Revenue</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(statement.paidRevenue || 0)}</p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs uppercase text-slate-500">Unpaid Revenue</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(statement.unpaidRevenue || 0)}</p>
              <button
                type="button"
                onClick={() => navigate("/billing?status=unpaid")}
                className="mt-2 text-xs font-semibold text-rose-700 underline"
              >
                View Details
              </button>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">Transport Benefits</p>
              <p className="mt-2 text-xl font-bold text-slate-900">
                {formatCurrency(statement.transportBenefits || 0)}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div
              className={cx(
                "order-first rounded-2xl border-2 border-[#2d8f98] bg-teal-50/90 p-4 shadow-sm",
                "md:col-span-2 xl:col-span-2",
              )}
            >
              <p className="text-xs font-bold uppercase tracking-wide text-[#1a5c62]">Doctor Net Revenue</p>
              <p className="mt-2 text-4xl font-bold text-teal-700">
                {formatCurrency(statement.doctorNetRevenue || 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
              <p className="text-xs uppercase text-slate-500">Unpaid Revenue</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(statement.unpaidRevenue || 0)}</p>
              <button
                type="button"
                onClick={() => navigate("/billing?status=unpaid")}
                className="mt-2 text-xs font-semibold text-rose-700 underline"
              >
                View Details
              </button>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">OCS Commission (60%)</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(statement.ocsCommission || 0)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">Doctor Commission (40%)</p>
              <p className="mt-2 text-xl font-bold text-slate-900">
                {formatCurrency(statement.doctorCommission || 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">Transport Benefits</p>
              <p className="mt-2 text-xl font-bold text-slate-900">
                {formatCurrency(statement.transportBenefits || 0)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">Paid Revenue</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(statement.paidRevenue || 0)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase text-slate-500">Total Revenue</p>
              <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(statement.totalRevenue || 0)}</p>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Revenue Reports">
        {revenueRows.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm italic text-gray-400">
            No data available for the selected period.
          </div>
        ) : (
        <div
          className="overflow-x-auto rounded-[20px] border border-slate-200 transition-all duration-300 ease-in-out"
          style={{ maxHeight: isRevenueExpanded ? "999px" : "280px" }}
        >
          <table className="min-w-full bg-white text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left">Patient</th>
                <th className="px-4 py-3 text-left">Consultation</th>
                <th className="px-4 py-3 text-left">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Method</th>
              </tr>
            </thead>
            <tbody>
              {visibleRevenueRows.map((row) => (
                <tr key={row.bill_id} className="border-t">
                  <td className="px-4 py-3">{row.patient_name}</td>
                  <td className="px-4 py-3">{row.consultation_date}</td>
                  <td className="px-4 py-3">{formatCurrency(row.total_amount)}</td>
                  <td className="px-4 py-3">{titleCaseWords(row.status)}</td>
                  <td className="px-4 py-3">{titleCaseWords(row.payment_method)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
        {revenueRows.length > 3 ? (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setIsRevenueExpanded((current) => !current)}
              className="rounded-2xl bg-[#2d8f98] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#2d8f98]/20 transition hover:bg-[#26717c]"
            >
              {isRevenueExpanded ? "View Less" : "View More"}
            </button>
          </div>
        ) : null}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard className="min-w-0" title="Patients Volume">
          {volumeRows.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm italic text-gray-400">
              No data available for the selected period.
            </div>
          ) : (
            <div className="h-56 min-h-[14rem] w-full min-w-0 lg:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
                  <Tooltip />
                  <Bar dataKey="patient_count" fill="#2d8f98" radius={[8, 8, 0, 0]}>
                    <LabelList dataKey="patient_count" position="top" fontSize={11} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="min-w-0" title="Patients Seen Per Location">
          {locationRows.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm italic text-gray-400">
              No data available for the selected period.
            </div>
          ) : (
            <div className="h-56 min-h-[14rem] w-full min-w-0 lg:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Pie
                    data={locationRows}
                    dataKey="patient_count"
                    nameKey="location"
                    cx="50%"
                    cy="50%"
                    outerRadius="72%"
                    label={{ fontSize: 11 }}
                  >
                    {locationRows.map((_, index) => (
                      <Cell key={`loc-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
