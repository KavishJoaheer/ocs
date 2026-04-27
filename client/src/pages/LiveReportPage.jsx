import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

function FilterButtonGroup({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PERIOD_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
            value === option.id
              ? "bg-sky-600 text-white shadow-lg shadow-sky-600/20"
              : "border border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function DateField({ value, onChange, label = "Date" }) {
  return (
    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2.5">
      <span className="text-sm font-semibold text-slate-600">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent text-sm font-medium text-slate-700 outline-none"
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

function downloadPdf(title, lines) {
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text(title, 14, 20);
  doc.setFontSize(11);
  let y = 32;
  lines.forEach((line) => {
    doc.text(String(line), 14, y);
    y += 7;
  });
  doc.save(`${title.replace(/\s+/g, "_").toLowerCase()}.pdf`);
}

export default function LiveReportPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const today = useMemo(() => getTodayInputValue(), []);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("monthly");
  const [anchorDate, setAnchorDate] = useState(today);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");

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
        if (selectedDoctorId) params.set("doctorId", selectedDoctorId);
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
    return () => { ignore = true; };
  }, [anchorDate, period, selectedDoctorId]);

  if (loading) return <LoadingState label="Loading live report" />;
  if (!report) return <EmptyState title="Live report unavailable" description="Unable to load report data." />;

  const locationRows = report.locationReport?.rows || [];
  const volumeRows = report.volumeReport?.rows || [];
  const revenueRows = report.billingRevenueReport?.rows || [];
  const statement = report.revenueStatement || {};

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="Live Report"
        description="Patients seen per location, patient volume, revenue reports, and doctor revenue statement."
      />

      <SectionCard
        title="Filters"
        subtitle="Apply period and date filters to all reports."
        actions={
          <div className="flex flex-wrap gap-2">
            {(user.role === "admin" && (report.doctors || []).length) ? (
              <select
                value={selectedDoctorId || String(report.doctorReport?.selectedDoctorId || "")}
                onChange={(event) => setSelectedDoctorId(event.target.value)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600"
              >
                {(report.doctors || []).map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>)}
              </select>
            ) : null}
            <FilterButtonGroup value={period} onChange={setPeriod} />
            <DateField value={anchorDate} onChange={setAnchorDate} />
          </div>
        }
      />

      <SectionCard
        title="Patients Seen Per Location"
        subtitle={report.locationReport?.rangeLabel}
        actions={<div className="flex gap-2"><button onClick={() => downloadPdf("patients_seen_per_location", locationRows.map((r) => `${r.location}: ${r.patient_count}`))} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><Download className="mr-1 inline size-3" />Download PDF</button><button onClick={() => exportCsv("patients_seen_per_location", locationRows)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><FileSpreadsheet className="mr-1 inline size-3" />Export to CSV</button></div>}
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={locationRows} dataKey="patient_count" nameKey="location" outerRadius={110} label>
                {locationRows.map((_, index) => <Cell key={`loc-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard
        title="Patients Volume"
        subtitle={report.volumeReport?.rangeLabel}
        actions={<div className="flex gap-2"><button onClick={() => downloadPdf("patients_volume", volumeRows.map((r) => `${r.date}: ${r.patient_count}`))} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><Download className="mr-1 inline size-3" />Download PDF</button><button onClick={() => exportCsv("patients_volume", volumeRows)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><FileSpreadsheet className="mr-1 inline size-3" />Export to CSV</button></div>}
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={volumeRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="patient_count" fill="#2d8f98" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard
        title="Revenue Reports"
        subtitle={report.billingRevenueReport?.rangeLabel}
        actions={<div className="flex gap-2"><button onClick={() => downloadPdf("revenue_reports", revenueRows.map((r) => `${r.patient_name} - ${r.total_amount} (${r.status})`))} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><Download className="mr-1 inline size-3" />Download PDF</button><button onClick={() => exportCsv("revenue_reports", revenueRows)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><FileSpreadsheet className="mr-1 inline size-3" />Export to CSV</button></div>}
      >
        <div className="overflow-x-auto rounded-[20px] border border-slate-200">
          <table className="min-w-full bg-white text-sm">
            <thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left">Patient</th><th className="px-4 py-3 text-left">Consultation</th><th className="px-4 py-3 text-left">Amount</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Method</th></tr></thead>
            <tbody>{revenueRows.map((row) => <tr key={row.bill_id} className="border-t"><td className="px-4 py-3">{row.patient_name}</td><td className="px-4 py-3">{row.consultation_date}</td><td className="px-4 py-3">{formatCurrency(row.total_amount)}</td><td className="px-4 py-3">{row.status}</td><td className="px-4 py-3">{row.payment_method}</td></tr>)}</tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Revenue Statement"
        subtitle="Doctor earnings, commissions, and payment status."
        actions={<div className="flex gap-2"><button onClick={() => downloadPdf("revenue_statement", [`Total Revenue: ${formatCurrency(statement.totalRevenue)}`, `OCS Commission (60%): ${formatCurrency(statement.ocsCommission)}`, `Doctor Commission (40%): ${formatCurrency(statement.doctorCommission)}`, `Transport Benefits (Rs 300 per patient): ${formatCurrency(statement.transportBenefits)}`, `Doctor Net Revenue: ${formatCurrency(statement.doctorNetRevenue)}`])} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><Download className="mr-1 inline size-3" />Download PDF</button><button onClick={() => { const ws = XLSX.utils.json_to_sheet([{ totalRevenue: statement.totalRevenue, ocsCommission: statement.ocsCommission, doctorCommission: statement.doctorCommission, transportBenefits: statement.transportBenefits, doctorNetRevenue: statement.doctorNetRevenue, paidRevenue: statement.paidRevenue, unpaidRevenue: statement.unpaidRevenue }]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Revenue Statement"); XLSX.writeFile(wb, "revenue_statement.xlsx"); }} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold"><FileSpreadsheet className="mr-1 inline size-3" />Export to Excel</button></div>}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase text-slate-500">Total Revenue</p><p className="mt-2 text-xl font-bold">{formatCurrency(statement.totalRevenue || 0)}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase text-slate-500">OCS Commission (60%)</p><p className="mt-2 text-xl font-bold">{formatCurrency(statement.ocsCommission || 0)}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase text-slate-500">Doctor Commission (40%)</p><p className="mt-2 text-xl font-bold">{formatCurrency(statement.doctorCommission || 0)}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase text-slate-500">Transport Benefits</p><p className="mt-2 text-xl font-bold">{formatCurrency(statement.transportBenefits || 0)}</p><p className="text-xs text-slate-500">Rs 300 per unique patient</p></div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs uppercase text-slate-500">Doctor Net Revenue</p><p className="mt-2 text-xl font-bold">{formatCurrency(statement.doctorNetRevenue || 0)}</p></div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs uppercase text-slate-500">Paid Revenue</p><p className="mt-2 text-xl font-bold">{formatCurrency(statement.paidRevenue || 0)}</p></div>
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4"><p className="text-xs uppercase text-slate-500">Unpaid Revenue</p><p className="mt-2 text-xl font-bold">{formatCurrency(statement.unpaidRevenue || 0)}</p><button type="button" onClick={() => navigate("/billing?status=unpaid")} className="mt-2 text-xs font-semibold text-rose-700 underline">View Details</button></div>
        </div>
        <div className="mt-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={statement.paymentMethodBreakdown || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="method" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="amount" fill="#41c8c6" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>
    </div>
  );
}
