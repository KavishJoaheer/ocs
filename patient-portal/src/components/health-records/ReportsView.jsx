import { Download, Eye, FileUp } from "lucide-react";
import { formatHealthDate } from "../../lib/healthRecordsDisplay.js";

function RequestedByBadge({ source }) {
  const isOcs = source === "OCS Doctor";
  return (
    <span
      className={[
        "squircle-inner inline-flex px-2.5 py-1 text-[11px] font-semibold",
        isOcs
          ? "bg-[rgba(66,133,244,0.12)] text-[#3b7dd8]"
          : "bg-[rgba(138,158,154,0.14)] text-[#6e7f7c]",
      ].join(" ")}
    >
      Requested by: {source}
    </span>
  );
}

function ReportCard({ report }) {
  const dateLabel = report.report_date
    ? formatHealthDate(report.report_date)
    : formatHealthDate(report.uploaded_at);

  return (
    <article
      className="squircle-outer ocs-elevate bg-white"
      style={{ padding: "var(--native-pad-card)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="native-display text-[16px] leading-snug text-[#1a5c52]">{report.name}</p>
          <p className="mt-1.5 text-[13px] text-[#8a9e9a]">{dateLabel}</p>
          <div className="mt-3">
            <RequestedByBadge source={report.requested_by_source || "OCS Doctor"} />
          </div>
        </div>

        <div className="flex shrink-0 gap-2">
          <a
            href={report.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${report.name}`}
            className="squircle-inner flex size-10 items-center justify-center bg-[rgba(26,160,140,0.08)] text-[#2d8f98] transition active:scale-95"
          >
            <Eye className="size-[18px]" strokeWidth={1.75} />
          </a>
          <a
            href={report.url}
            download
            aria-label={`Download ${report.name}`}
            className="squircle-inner flex size-10 items-center justify-center bg-[rgba(26,160,140,0.08)] text-[#2d8f98] transition active:scale-95"
          >
            <Download className="size-[18px]" strokeWidth={1.75} />
          </a>
        </div>
      </div>
    </article>
  );
}

function ReportsEmptyState({ onUpload }) {
  return (
    <div className="flex flex-col items-center px-4 py-16 text-center">
      <FileUp className="size-11 text-[rgba(26,160,140,0.35)]" strokeWidth={1.5} />
      <h2 className="native-display mt-5 text-[20px] text-[#1a5c52]">
        Your reports live here
      </h2>
      <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-[#8a9e9a]">
        OCS care team reports appear automatically. You can also upload your own.
      </p>
      <button
        type="button"
        onClick={onUpload}
        className="squircle-inner mt-6 bg-[#e8a020] px-6 py-3.5 text-[14px] font-bold text-white shadow-[0_4px_16px_rgba(232,160,32,0.25)] transition active:scale-[0.98]"
      >
        Upload Report
      </button>
    </div>
  );
}

/** Medical & lab reports list with optional FAB upload trigger. */
function ReportsView({ reports, onUpload }) {
  const sorted = [...reports].sort((a, b) => {
    const dateA = a.report_date || a.uploaded_at;
    const dateB = b.report_date || b.uploaded_at;
    return new Date(dateB) - new Date(dateA);
  });

  return (
    <div className="relative">
      {sorted.length > 0 ? (
        <div className="mb-4 hidden justify-end lg:flex">
          <button
            type="button"
            onClick={onUpload}
            className="squircle-inner flex items-center gap-2 bg-[#2d8f98] px-5 py-2.5 text-[14px] font-bold text-white transition hover:brightness-105 active:scale-[0.98]"
          >
            <FileUp className="size-4" strokeWidth={2} />
            Upload Report
          </button>
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <ReportsEmptyState onUpload={onUpload} />
      ) : (
        <ul className="space-y-4" aria-label="Medical and lab reports">
          {sorted.map((report, idx) => (
            <li key={report.id} className={`animate-fade-in-up stagger-${Math.min(idx + 1, 6)}`}>
              <ReportCard report={report} />
            </li>
          ))}
        </ul>
      )}

      {sorted.length > 0 ? (
        <button
          type="button"
          onClick={onUpload}
          aria-label="Upload report"
          className="fixed bottom-[calc(var(--native-nav-height)+var(--native-safe-bottom)+16px)] right-[var(--native-pad-screen)] z-30 flex items-center gap-2 rounded-full bg-[#2d8f98] px-5 py-3.5 text-[14px] font-bold text-white shadow-[0_8px_24px_rgba(45,143,152,0.35)] transition active:scale-[0.97] lg:hidden"
        >
          <FileUp className="size-[18px]" strokeWidth={2} />
          Upload Report
        </button>
      ) : null}
    </div>
  );
}

export default ReportsView;
