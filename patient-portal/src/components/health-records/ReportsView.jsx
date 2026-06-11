import { ChevronRight, FileText, FileUp, FolderHeart } from "lucide-react";
import { formatHealthDate } from "../../lib/healthRecordsDisplay.js";

function ReportCard({ report, isLast = false }) {
  const dateLabel = report.report_date
    ? formatHealthDate(report.report_date)
    : formatHealthDate(report.uploaded_at);
  const source = report.requested_by_source || "OCS Doctor";

  return (
    <a
      href={report.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View ${report.name}`}
      className={[
        "ocs-surface-card ocs-card-press block w-full bg-white no-underline lg:hidden",
        isLast ? "" : "mb-4",
      ].join(" ")}
      style={{ padding: "var(--native-pad-card)" }}
    >
      <div className="flex items-start gap-4">
        <div className="squircle-inner flex size-11 shrink-0 items-center justify-center bg-teal-100 text-[#2d8f98]">
          <FileText className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="native-display truncate text-[16px] leading-snug text-[#1a5c52]">
            {report.name}
          </p>
          <p className="native-label mt-1 truncate text-[13px] text-[#5b7f8a]">{dateLabel}</p>
          <p className="mt-0.5 truncate text-[13px] text-[#8a9e9a]">{source}</p>
        </div>
        <ChevronRight
          className="size-[18px] shrink-0 translate-y-1 text-brand-gold"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </div>
    </a>
  );
}

function ReportRowDesktop({ report, isLast = false }) {
  const dateLabel = report.report_date
    ? formatHealthDate(report.report_date)
    : formatHealthDate(report.uploaded_at);
  const source = report.requested_by_source || "OCS Doctor";

  return (
    <article
      className={[
        "ocs-surface-card ocs-card-press hidden w-full bg-white lg:block",
        isLast ? "" : "mb-4",
      ].join(" ")}
      style={{ padding: "var(--native-pad-card)" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <div className="squircle-inner flex size-11 shrink-0 items-center justify-center bg-brand-teal/10 text-brand-dark-grey">
            <FileText className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="native-display text-[16px] leading-snug text-brand-dark-grey">{report.name}</p>
            <p className="native-label mt-1 text-[13px] text-brand-cool-grey">{dateLabel}</p>
            <p className="mt-0.5 text-[13px] text-brand-cool-grey">{source}</p>
          </div>
        </div>
        <a
          href={report.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[15px] font-bold text-brand-gold transition hover:text-brand-gold-dark"
        >
          View
        </a>
      </div>
    </article>
  );
}

function ReportsEmptyState({ onUpload }) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <div className="squircle-inner flex size-14 items-center justify-center bg-teal-100 text-[#2d8f98]">
        <FolderHeart className="size-7" strokeWidth={1.75} />
      </div>
      <h2 className="native-display mt-4 text-[18px] text-[#1a5c52] lg:text-brand-dark-grey">No reports yet</h2>
      <p className="mt-1 max-w-xs text-[15px] leading-relaxed text-[#5b7f8a] lg:text-brand-cool-grey">
        OCS care team reports appear automatically. You can also upload your own.
      </p>
      <button
        type="button"
        onClick={onUpload}
        className="squircle-inner mt-6 bg-brand-gold px-6 py-3 text-[15px] font-bold text-white shadow-[0_4px_16px_rgba(var(--ocs-brand-gold-rgb),0.25)] transition active:scale-[0.98] lg:text-brand-dark-grey"
      >
        Upload Report
      </button>
    </div>
  );
}

function ReportsView({ reports, onUpload }) {
  const sorted = [...reports].sort((a, b) => {
    const dateA = a.report_date || a.uploaded_at;
    const dateB = b.report_date || b.uploaded_at;
    return new Date(dateB) - new Date(dateA);
  });

  return (
    <div className="relative font-sans" aria-label="Medical and lab reports">
      {sorted.length > 0 ? (
        <div className="mb-4 hidden justify-end lg:flex">
          <button
            type="button"
            onClick={onUpload}
            className="flex items-center gap-2 rounded-xl bg-brand-gold px-5 py-2.5 text-[14px] font-bold text-white transition hover:brightness-105 active:scale-[0.98]"
          >
            <FileUp className="size-4 translate-y-px" strokeWidth={1.75} />
            Upload Report
          </button>
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <ReportsEmptyState onUpload={onUpload} />
      ) : (
        <>
          <div className="lg:hidden">
            {sorted.map((report, idx) => (
              <ReportCard
                key={report.id}
                report={report}
                isLast={idx === sorted.length - 1}
              />
            ))}
          </div>

          <div className="hidden lg:block">
            {sorted.map((report, idx) => (
              <ReportRowDesktop
                key={report.id}
                report={report}
                isLast={idx === sorted.length - 1}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={onUpload}
            className="ocs-surface-card ocs-card-press mt-4 flex w-full items-center justify-center gap-2 bg-white py-3.5 text-[15px] font-bold text-brand-gold lg:hidden"
          >
            <FileUp className="size-[18px] translate-y-px" strokeWidth={1.75} />
            Upload Report
          </button>
        </>
      )}
    </div>
  );
}

export default ReportsView;
