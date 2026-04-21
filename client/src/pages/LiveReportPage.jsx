import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ChartNoAxesColumn,
  DollarSign,
  MapPinned,
  PieChart,
  UsersRound,
} from "lucide-react";
import toast from "react-hot-toast";
import EmptyState from "../components/EmptyState.jsx";
import LoadingState from "../components/LoadingState.jsx";
import PageHeader from "../components/PageHeader.jsx";
import SectionCard from "../components/SectionCard.jsx";
import { api } from "../lib/api.js";
import { formatCurrency } from "../lib/format.js";

const PERIOD_OPTIONS = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "annual", label: "Annual" },
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

function ReportMetricCard({ icon: Icon, label, value, tone }) {
  return (
    <div className="relative rounded-[28px] border border-[rgba(65,200,198,0.18)] bg-white/88 p-5 pr-24 shadow-[0_22px_54px_rgba(34,72,91,0.08)]">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
          {label}
        </p>
        <p className="mt-3 max-w-full text-[clamp(1.85rem,2vw,2.25rem)] font-bold tracking-tight text-slate-950 [overflow-wrap:anywhere]">
          {value}
        </p>
      </div>
      <div className="absolute right-5 top-5">
        <div className={`shrink-0 rounded-3xl p-4 ${tone}`}>
          <Icon className="size-6 text-white" />
        </div>
      </div>
    </div>
  );
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

function DateField({ value, onChange, label = "Reference date" }) {
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

function DonutLegendRow({ color, label, count, percentage }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <p className="truncate text-sm font-semibold text-slate-900">{label}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-slate-900">{percentage}%</p>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{count} patients</p>
      </div>
    </div>
  );
}

function LocationDistributionCard({
  report,
  period,
  setPeriod,
  anchorDate,
  setAnchorDate,
}) {
  const segments = report?.rows || [];
  const total = Number(report?.totalPatientsSeen || 0);

  if (!segments.length || total <= 0) {
    return (
      <SectionCard
        title="Patients Seen Per Location"
        subtitle={`Pie view for ${report?.rangeLabel || "the selected period"}.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <FilterButtonGroup value={period} onChange={setPeriod} />
            <DateField value={anchorDate} onChange={setAnchorDate} />
          </div>
        }
      >
        <EmptyState
          title="No location data yet"
          description="Location reporting will appear here once consultations are saved in the selected window."
        />
      </SectionCard>
    );
  }

  let cursor = 0;
  const gradientParts = segments.map((segment, index) => {
    const percentage = (Number(segment.patient_count || 0) / total) * 100;
    const start = cursor;
    cursor += percentage;
    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${cursor}%`;
  });

  return (
    <SectionCard
      title="Patients Seen Per Location"
      subtitle={`Pie view for ${report.rangeLabel}.`}
      actions={
        <div className="flex flex-wrap gap-2">
          <FilterButtonGroup value={period} onChange={setPeriod} />
          <DateField value={anchorDate} onChange={setAnchorDate} />
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
        <div className="flex justify-center">
          <div
            className="relative size-52 rounded-full"
            style={{ background: `conic-gradient(${gradientParts.join(", ")})` }}
          >
            <div className="absolute inset-[18%] flex items-center justify-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(148,163,184,0.14)]">
              <div className="text-center">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Patients seen
                </p>
                <p className="mt-2 text-3xl font-bold text-slate-950">
                  {formatInteger(total)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {segments.map((segment, index) => {
            const count = Number(segment.patient_count || 0);
            const percentage = total ? Math.round((count / total) * 100) : 0;

            return (
              <DonutLegendRow
                key={`${segment.location}-${index}`}
                color={CHART_COLORS[index % CHART_COLORS.length]}
                label={segment.location}
                count={formatInteger(count)}
                percentage={percentage}
              />
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}

function DoctorActivityCard({
  report,
  doctors,
  period,
  setPeriod,
  anchorDate,
  setAnchorDate,
  selectedDoctorId,
  setSelectedDoctorId,
}) {
  const rows = report?.rows || [];
  const maxCount = Math.max(...rows.map((row) => Number(row.patient_count || 0)), 1);

  return (
    <SectionCard
      title="Patients Seen By Doctors"
      subtitle={`Doctor-specific view for ${report?.rangeLabel || "the selected period"}.`}
      actions={
        <div className="flex flex-wrap gap-2">
          <select
            value={selectedDoctorId || String(report?.selectedDoctorId || "")}
            onChange={(event) => setSelectedDoctorId(event.target.value)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 outline-none transition focus:border-sky-400 focus:bg-white"
          >
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.full_name}
              </option>
            ))}
          </select>
          <FilterButtonGroup value={period} onChange={setPeriod} />
          <DateField value={anchorDate} onChange={setAnchorDate} />
        </div>
      }
    >
      {!doctors.length ? (
        <EmptyState
          title="No doctors available"
          description="Add an active doctor account to start filtering this report."
        />
      ) : rows.length ? (
        <div className="space-y-4">
          <div className="flex min-h-[18rem] items-end gap-4 overflow-x-auto rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-5">
            {rows.map((row) => {
              const count = Number(row.patient_count || 0);
              const height = Math.max((count / maxCount) * 220, 18);

              return (
                <div key={row.doctor_id} className="flex min-w-[140px] flex-1 flex-col items-center gap-3">
                  <div className="text-sm font-semibold text-slate-900">{formatInteger(count)}</div>
                  <div
                    className="w-full rounded-t-[22px] bg-gradient-to-t from-[#2d8f98] to-[#71d8d5] shadow-[0_18px_32px_rgba(45,143,152,0.18)]"
                    style={{ height }}
                  />
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-900">{row.doctor_name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                      {formatInteger(row.patient_count)} patients seen
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((row) => (
              <div
                key={`${report.period}-${row.doctor_id}`}
                className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-3"
              >
                <p className="text-sm font-semibold text-slate-900">{row.doctor_name}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                  {formatInteger(row.patient_count)} patients seen
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          title="No doctor activity in this period"
          description="Once the selected doctor has consultations in this window, their patient count will appear here."
        />
      )}
    </SectionCard>
  );
}

function ReportingWindowsCard({ report, revenueDate, setRevenueDate }) {
  const revenueSummary = report?.summary || {};
  const revenueRanges = report?.ranges || {};

  return (
    <SectionCard
      title="Revenue By Reporting Window"
      subtitle={`Paid revenue anchored to ${report?.anchorDate || revenueDate}.`}
      actions={<DateField value={revenueDate} onChange={setRevenueDate} />}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PERIOD_OPTIONS.map((option) => (
          <div
            key={option.id}
            className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              {option.label}
            </p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">
              {formatCurrency(revenueSummary[option.id] || 0)}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {revenueRanges[option.id]?.label || "No range selected"}
            </p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

function ReportingScopeCard({ locationReport, doctorReport, revenueReport }) {
  const scopeRows = [
    {
      label: "Location scope",
      value: locationReport?.rangeLabel,
      icon: MapPinned,
    },
    {
      label: "Doctor scope",
      value: doctorReport?.rangeLabel,
      icon: UsersRound,
    },
    {
      label: "Revenue anchor",
      value: revenueReport?.anchorDate,
      icon: DollarSign,
    },
  ];

  return (
    <SectionCard
      title="Reporting Scope"
      subtitle="The active filters currently applied to each section."
    >
      <div className="grid gap-4 md:grid-cols-3">
        {scopeRows.map((row) => {
          const Icon = row.icon;

          return (
            <div
              key={row.label}
              className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-sky-50 p-3 text-sky-700">
                  <Icon className="size-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    {row.label}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{row.value}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

export default function LiveReportPage() {
  const today = useMemo(() => getTodayInputValue(), []);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locationPeriod, setLocationPeriod] = useState("monthly");
  const [locationDate, setLocationDate] = useState(today);
  const [doctorPeriod, setDoctorPeriod] = useState("monthly");
  const [doctorDate, setDoctorDate] = useState(today);
  const [selectedDoctorId, setSelectedDoctorId] = useState("");
  const [revenueDate, setRevenueDate] = useState(today);

  useEffect(() => {
    let ignore = false;

    async function loadReport() {
      setLoading(true);

      try {
        const params = new URLSearchParams({
          locationPeriod,
          locationDate,
          doctorPeriod,
          doctorDate,
          revenueDate,
        });

        if (selectedDoctorId) {
          params.set("doctorId", selectedDoctorId);
        }

        const response = await api.get(`/dashboard/live-report?${params.toString()}`);

        if (!ignore) {
          setReport(response);

          if (!selectedDoctorId && response.doctorReport?.selectedDoctorId) {
            setSelectedDoctorId(String(response.doctorReport.selectedDoctorId));
          }
        }
      } catch (error) {
        if (!ignore) {
          toast.error(error.message);
          setReport(null);
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadReport();

    return () => {
      ignore = true;
    };
  }, [doctorDate, doctorPeriod, locationDate, locationPeriod, revenueDate, selectedDoctorId]);

  const metricCards = useMemo(() => {
    if (!report) {
      return [];
    }

    return [
      {
        icon: UsersRound,
        label: "Patients seen",
        value: formatInteger(report.locationReport?.totalPatientsSeen || 0),
        tone: "bg-gradient-to-br from-sky-500 to-blue-600",
      },
      {
        icon: DollarSign,
        label: "Daily revenue",
        value: formatCurrency(report.revenueReport?.summary?.daily || 0),
        tone: "bg-gradient-to-br from-cyan-500 to-sky-600",
      },
      {
        icon: Activity,
        label: "Weekly revenue",
        value: formatCurrency(report.revenueReport?.summary?.weekly || 0),
        tone: "bg-gradient-to-br from-emerald-500 to-teal-600",
      },
      {
        icon: ChartNoAxesColumn,
        label: "Monthly revenue",
        value: formatCurrency(report.revenueReport?.summary?.monthly || 0),
        tone: "bg-gradient-to-br from-amber-400 to-orange-500",
      },
      {
        icon: PieChart,
        label: "Annual revenue",
        value: formatCurrency(report.revenueReport?.summary?.annual || 0),
        tone: "bg-gradient-to-br from-slate-500 to-slate-700",
      },
    ];
  }, [report]);

  if (loading) {
    return <LoadingState label="Loading live report" />;
  }

  if (!report) {
    return (
      <EmptyState
        title="Live report unavailable"
        description="The live report could not be loaded right now. Refresh and try again."
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin analytics"
        title="Live Report"
        description="Track patient coverage, doctor-specific activity, and paid revenue performance with period filters and date-based views."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {metricCards.map((card) => (
          <ReportMetricCard key={card.label} {...card} />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <LocationDistributionCard
          report={report.locationReport}
          period={locationPeriod}
          setPeriod={setLocationPeriod}
          anchorDate={locationDate}
          setAnchorDate={setLocationDate}
        />
        <DoctorActivityCard
          report={report.doctorReport}
          doctors={report.doctors || []}
          period={doctorPeriod}
          setPeriod={setDoctorPeriod}
          anchorDate={doctorDate}
          setAnchorDate={setDoctorDate}
          selectedDoctorId={selectedDoctorId}
          setSelectedDoctorId={setSelectedDoctorId}
        />
      </div>

      <ReportingWindowsCard
        report={report.revenueReport}
        revenueDate={revenueDate}
        setRevenueDate={setRevenueDate}
      />

      <ReportingScopeCard
        locationReport={report.locationReport}
        doctorReport={report.doctorReport}
        revenueReport={report.revenueReport}
      />
    </div>
  );
}
