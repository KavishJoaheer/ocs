import { ChevronRight, FileUp, FolderHeart } from "lucide-react";
import { formatHealthDate } from "../../lib/healthRecordsDisplay.js";
import { NativeGroupedFooter, NativeGroupedList, NativeGroupedRow } from "../native/NativeGroupedList.jsx";

function ReportRow({ report, isLast = false }) {
  const dateLabel = report.report_date
    ? formatHealthDate(report.report_date)
    : formatHealthDate(report.uploaded_at);
  const source = report.requested_by_source || "OCS Doctor";

  return (
    <>
      <NativeGroupedRow
        href={report.url}
        isLast={isLast}
        ariaLabel={`View ${report.name}`}
        className="lg:hidden"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] leading-snug text-gray-900">{report.name}</p>
          <p className="mt-0.5 truncate text-[15px] text-gray-500">
            {dateLabel} · {source}
          </p>
        </div>
        <ChevronRight className="size-[17px] shrink-0 text-gray-300" strokeWidth={2} aria-hidden="true" />
      </NativeGroupedRow>

      <article
        className={[
          "hidden w-full rounded-2xl border border-black/5 bg-white shadow-md lg:block",
          isLast ? "" : "mb-4",
        ].join(" ")}
        style={{ padding: "var(--native-pad-card)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="native-display text-[16px] leading-snug text-[#1a5c52]">{report.name}</p>
            <p className="mt-1.5 text-[13px] text-[#8a9e9a]">{dateLabel}</p>
            <p className="mt-1 text-[13px] text-gray-500">{source}</p>
          </div>
          <a
            href={report.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[15px] font-medium text-[#0D9E8A]"
          >
            View
          </a>
        </div>
      </article>
    </>
  );
}

function ReportsEmptyState({ onUpload }) {
  return (
    <div className="flex flex-col items-center px-4 py-14 text-center">
      <FolderHeart className="size-10 text-gray-300" strokeWidth={1.25} />
      <h2 className="mt-4 text-[17px] font-semibold text-gray-900">No reports yet</h2>
      <p className="mt-1 max-w-xs text-[15px] leading-relaxed text-gray-500">
        OCS care team reports appear automatically. You can also upload your own.
      </p>
      <button
        type="button"
        onClick={onUpload}
        className="mt-6 rounded-xl bg-[#e8a020] px-6 py-3 text-[15px] font-semibold text-white transition active:opacity-90"
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
    <div className="relative" aria-label="Medical and lab reports">
      {sorted.length > 0 ? (
        <div className="mb-4 hidden justify-end lg:flex">
          <button
            type="button"
            onClick={onUpload}
            className="flex items-center gap-2 rounded-xl bg-[#e8a020] px-5 py-2.5 text-[14px] font-bold text-white transition hover:brightness-105 active:scale-[0.98]"
          >
            <FileUp className="size-4" strokeWidth={2} />
            Upload Report
          </button>
        </div>
      ) : null}

      {sorted.length === 0 ? (
        <ReportsEmptyState onUpload={onUpload} />
      ) : (
        <>
          <NativeGroupedList className="lg:hidden">
            {sorted.map((report, idx) => (
              <ReportRow
                key={report.id}
                report={report}
                isLast={idx === sorted.length - 1}
              />
            ))}
          </NativeGroupedList>

          <div className="hidden lg:block">
            {sorted.map((report, idx) => (
              <ReportRow
                key={report.id}
                report={report}
                isLast={idx === sorted.length - 1}
              />
            ))}
          </div>

          <div className="mt-6 lg:hidden">
            <NativeGroupedList>
              <NativeGroupedRow onClick={onUpload} isLast ariaLabel="Upload report">
                <FileUp className="size-[18px] shrink-0 text-[#0D9E8A]" strokeWidth={2} />
                <span className="text-[17px] text-[#0D9E8A]">Upload Report</span>
              </NativeGroupedRow>
            </NativeGroupedList>
            <NativeGroupedFooter>
              Tap a report to view it. PDFs open in a new tab.
            </NativeGroupedFooter>
          </div>
        </>
      )}
    </div>
  );
}

export default ReportsView;
