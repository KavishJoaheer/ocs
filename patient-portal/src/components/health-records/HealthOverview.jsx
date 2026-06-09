import { Activity, AlertTriangle, CalendarDays, Download, HeartPulse } from "lucide-react";
import { Fragment } from "react";
import {
  countVitalsDataPoints,
  formatHealthDate,
  formatHealthRecordsText,
} from "../../lib/healthRecordsDisplay.js";
import {
  BloodPressureTrendChart,
  SingleMetricTrendChart,
} from "./VitalsTrendChart.jsx";

function StatPill({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-[rgba(26,160,140,0.12)] bg-white/90 px-4 py-3">
      <div className="flex items-center gap-2 text-[#6e949b]">
        <Icon className="size-3.5" strokeWidth={1.75} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em]">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold text-[#22485b]">{value}</p>
    </div>
  );
}

export function HealthSummaryCard({ summary, onExport, exporting }) {
  if (!summary) {
    return null;
  }

  return (
    <section className="rounded-[24px] border border-[rgba(26,160,140,0.14)] bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,251,250,0.92))] p-6 shadow-[0_16px_48px_rgba(34,72,91,0.06)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#6e949b]">
            Your health summary
          </p>
          <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-[#22485b] sm:text-2xl">
            {formatHealthRecordsText(summary.headline)}
          </h2>
        </div>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-full border border-[rgba(26,160,140,0.25)] bg-white px-4 py-2 text-sm font-semibold text-[#2d8f98] transition hover:bg-[rgba(26,160,140,0.06)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="size-4" strokeWidth={1.75} />
          {exporting ? "Preparing…" : "Download PDF"}
        </button>
      </div>

      {summary.bullets?.length ? (
        <ul className="mt-5 space-y-2.5">
          {summary.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-3 text-sm leading-relaxed text-[#5b7f8a]">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2d8f98]" />
              <span>{formatHealthRecordsText(bullet)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <StatPill
          icon={CalendarDays}
          label="Visits"
          value={summary.consultation_count ?? 0}
        />
        <StatPill
          icon={HeartPulse}
          label="Conditions"
          value={summary.medical_history_count ?? 0}
        />
        <StatPill
          icon={AlertTriangle}
          label="Allergies"
          value={summary.allergy_count ?? 0}
        />
      </div>
    </section>
  );
}

export function MobileHealthSummaryCard({ summary, onExport, exporting }) {
  if (!summary) {
    return null;
  }

  const lastSeenLabel = summary.last_visit_date
    ? `Last seen ${formatHealthDate(summary.last_visit_date)}`
    : "No visits recorded yet";

  return (
    <section
      className="relative rounded-[16px] p-5 shadow-[0_2px_12px_rgba(26,160,140,0.08)]"
      style={{
        background: "linear-gradient(135deg, #1a5c52 0%, #0D9E8A 100%)",
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[1.5px] text-white/70">
        Your Health Summary
      </p>
      <p className="mt-2 text-[14px] font-normal leading-[1.5] text-white/85">{lastSeenLabel}</p>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="inline-flex h-9 items-center gap-1.5 rounded-[20px] bg-white px-4 text-[13px] font-semibold text-[#1a5c52] transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="size-3.5" strokeWidth={1.75} />
          {exporting ? "Preparing…" : "Download PDF"}
        </button>
      </div>
    </section>
  );
}

export function MobileHealthStatsRow({ summary }) {
  if (!summary) return null;

  const items = [
    { label: "Visits", value: summary.consultation_count ?? 0 },
    { label: "Conditions", value: summary.medical_history_count ?? 0 },
    { label: "Allergies", value: summary.allergy_count ?? 0 },
  ];

  return (
    <section className="flex items-center justify-around rounded-[12px] bg-white px-4 py-3.5 shadow-[0_2px_12px_rgba(26,160,140,0.08)]">
      {items.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 ? (
            <div className="h-8 w-px shrink-0 bg-[rgba(26,160,140,0.1)]" aria-hidden="true" />
          ) : null}
          <div className="min-w-0 flex-1 text-center">
            <p className="text-[22px] font-bold leading-[1.5] text-[#1a5c52]">{item.value}</p>
            <p className="text-[10px] leading-[1.5] text-[#5b7f8a]">{item.label}</p>
          </div>
        </Fragment>
      ))}
    </section>
  );
}

export function VitalsTrendsPanel({ vitalsTrends }) {
  if (countVitalsDataPoints(vitalsTrends) < 3) {
    return null;
  }

  const glucoseUnit =
    vitalsTrends?.glucose?.find((item) => item.unit)?.unit || "mmol/L";

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-[#2d8f98]" strokeWidth={1.75} />
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-[#6e949b]">
          Trends over time
        </h3>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[20px] border border-[rgba(26,160,140,0.12)] bg-white p-5">
          <p className="text-sm font-semibold text-[#22485b]">Blood pressure</p>
          <p className="mt-1 text-[12px] font-light text-[#8a9ea3]">mmHg · from visit notes and lab reports</p>
          <div className="mt-4">
            <BloodPressureTrendChart readings={vitalsTrends?.blood_pressure || []} />
          </div>
        </div>

        <div className="rounded-[20px] border border-[rgba(26,160,140,0.12)] bg-white p-5">
          <p className="text-sm font-semibold text-[#22485b]">Blood glucose</p>
          <p className="mt-1 text-[12px] font-light text-[#8a9ea3]">{glucoseUnit} · fasting and random readings</p>
          <div className="mt-4">
            <SingleMetricTrendChart
              readings={vitalsTrends?.glucose || []}
              unit={glucoseUnit}
              emptyLabel="Glucose readings will appear here once they are recorded in your chart."
              formatValue={(value) => Number(value).toFixed(1)}
            />
          </div>
        </div>

        <div className="rounded-[20px] border border-[rgba(26,160,140,0.12)] bg-white p-5 lg:col-span-2">
          <p className="text-sm font-semibold text-[#22485b]">HbA1c</p>
          <p className="mt-1 text-[12px] font-light text-[#8a9ea3]">% · long-term glucose control</p>
          <div className="mt-4 max-w-xl">
            <SingleMetricTrendChart
              readings={vitalsTrends?.hba1c || []}
              unit="%"
              color="#41c8c6"
              emptyLabel="HbA1c results will appear here after your lab reports are added."
              formatValue={(value) => Number(value).toFixed(1)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
