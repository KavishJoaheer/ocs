import { useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  FolderHeart,
  ChevronRight,
  FileText,
  FileUp,
} from "lucide-react";
import { api, buildAuthedFileUrl } from "../lib/api.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { exportHealthRecordsPdf } from "../lib/healthRecordsExport.js";
import { formatDisplayName } from "../lib/formatDisplayName.js";
import {
  formatDoctorName,
  formatHealthDate,
  formatIsoDatesInText,
  formatMedicalConditionName,
  isNilAllergyValue,
  shouldShowPlainSummary,
} from "../lib/healthRecordsDisplay.js";
import {
  HealthSummaryCard,
  MobileHealthStatsRow,
  MobileHealthSummaryCard,
  VitalsTrendsPanel,
} from "../components/health-records/HealthOverview.jsx";
import { UnifiedTimeline } from "../components/health-records/UnifiedTimeline.jsx";

function reportUrl(attachmentId) {
  return buildAuthedFileUrl(`/patient-portal/reports/attachments/${attachmentId}/download`);
}

const TABS = [
  { id: "overview", label: "Overview", shortLabel: "Overview" },
  { id: "timeline", label: "Care Timeline", shortLabel: "Timeline" },
  { id: "consultations", label: "Consultation History", shortLabel: "Consultations" },
  { id: "reports", label: "Medical & Lab Reports", shortLabel: "Reports" },
  { id: "clinical", label: "Clinical History", shortLabel: "Clinical" },
];

const MOBILE_CARD =
  "max-md:rounded-[16px] max-md:border-0 max-md:shadow-[0_2px_12px_rgba(26,160,140,0.08)]";

function SectionLabel({ children }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[1.5px] text-[#6e949b]">
      {children}
    </p>
  );
}

function ConsultationTimelineNode({ consultation, expanded, onToggle }) {
  const hasReports = consultation.reports?.length > 0;

  return (
    <div className="relative flex gap-5 max-md:gap-3">
      <div className="relative z-10 mt-7 shrink-0 max-md:mt-6">
        <div className="h-[10px] w-[10px] rounded-full bg-[#1aa08c]" />
      </div>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          className={`group w-full rounded-xl border border-[rgba(26,160,140,0.12)] bg-white px-6 py-5 text-left transition-colors duration-200 ease-in-out hover:bg-[rgba(26,160,140,0.04)] max-md:px-4 max-md:py-4 ${MOBILE_CARD}`}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[15px] font-bold text-[#1a5c52] max-md:text-[14px]">
                {formatHealthDate(consultation.date)}
              </p>
              <p className="mt-0.5 text-sm font-light text-[#5b7f8a] max-md:text-[13px]">
                {formatDoctorName(consultation.doctor_name)}
              </p>
            </div>
            <ChevronRight
              className={`size-4 shrink-0 text-[#6e949b] transition-transform duration-200 ease-in-out group-hover:text-[#2d8f98] ${
                expanded ? "rotate-90" : ""
              }`}
              strokeWidth={2}
            />
          </div>

          {expanded ? (
            <div className="pt-5">
              <SectionLabel>Diagnosis</SectionLabel>
              <span className="mt-2 inline-flex rounded-[20px] bg-[rgba(26,160,140,0.1)] px-4 py-1 text-[13px] text-[#2d8f98]">
                {consultation.diagnosis}
              </span>

              {shouldShowPlainSummary(consultation.diagnosis, consultation.plain_summary) ? (
                <p className="mt-4 text-[13px] font-light leading-relaxed text-[#5b7f8a]">
                  {consultation.plain_summary}
                </p>
              ) : null}

              <div className="mt-5">
                <SectionLabel>Medical &amp; Lab Reports</SectionLabel>
                {hasReports ? (
                  <div className="mt-2">
                    {consultation.reports.map((report, idx) => (
                      <div key={report.id}>
                        {idx > 0 ? (
                          <div className="my-3 border-t border-[rgba(26,160,140,0.1)]" />
                        ) : null}
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <FileText
                              className="size-4 shrink-0 text-[#2d8f98]"
                              strokeWidth={1.75}
                            />
                            <span className="truncate text-sm font-normal text-[#1a5c52]">
                              {report.name}
                            </span>
                          </div>
                          <a
                            href={report.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-[13px] text-[#2d8f98] transition-colors duration-200 hover:text-[#23767f]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            View →
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[13px] font-light italic text-[#6e949b]">
                    No reports uploaded for this visit.
                  </p>
                )}
              </div>
            </div>
          ) : null}
        </button>
      </div>
    </div>
  );
}

function ConsultationEmptyState() {
  return (
    <div className="flex flex-col items-center px-6 py-20 text-center">
      <FolderHeart
        className="size-12 text-[rgba(26,160,140,0.35)]"
        strokeWidth={1.5}
      />
      <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight text-[#22485b]">
        Your health story starts here.
      </h2>
      <p className="mt-3 max-w-md text-sm font-light leading-relaxed text-[#6e949b]">
        Once your first home visit is complete, your consultation history will
        appear here — beautifully organised.
      </p>
      <Link
        to="/request-visit"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#e8a020] px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95"
      >
        Request a Home Visit →
      </Link>
    </div>
  );
}

function ConsultationHistoryTab({ consultations }) {
  const [expandedIds, setExpandedIds] = useState(new Set());

  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <p className="text-[11px] font-light italic text-[#8a9ea3]">
          Read only · Records added by your OCS doctor
        </p>
      </div>

      {consultations.length === 0 ? (
        <ConsultationEmptyState />
      ) : (
        <div className="relative">
          <div
            className="absolute bottom-0 left-[4px] top-0 w-[2px] bg-[rgba(26,160,140,0.2)]"
            aria-hidden="true"
          />
          <div className="space-y-3">
            {consultations.map((consultation, idx) => (
              <div
                key={consultation.id}
                className={`animate-fade-in-up stagger-${Math.min(idx + 1, 8)}`}
              >
                <ConsultationTimelineNode
                  consultation={consultation}
                  expanded={expandedIds.has(consultation.id)}
                  onToggle={() => toggleExpanded(consultation.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportTimelineNode({ report, expanded, onToggle }) {
  return (
    <div className="relative flex gap-5 max-md:gap-3">
      <div className="relative z-10 mt-7 shrink-0 max-md:mt-6">
        <div className="h-[10px] w-[10px] rounded-full bg-[#1aa08c]" />
      </div>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          className={`group w-full rounded-xl border border-[rgba(26,160,140,0.12)] bg-white px-6 py-5 text-left transition-colors duration-200 ease-in-out hover:bg-[rgba(26,160,140,0.04)] max-md:px-4 max-md:py-4 ${MOBILE_CARD}`}
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[15px] font-bold text-[#1a5c52] max-md:text-[14px]">
                {formatHealthDate(report.uploaded_at)}
              </p>
              <p className="mt-0.5 text-sm font-medium text-[#5b7f8a] max-md:text-[13px]">
                {report.name}
              </p>
            </div>
            <ChevronRight
              className={`size-4 shrink-0 text-[#6e949b] transition-transform duration-200 ease-in-out group-hover:text-[#2d8f98] ${
                expanded ? "rotate-90" : ""
              }`}
              strokeWidth={2}
            />
          </div>

          {expanded ? (
            <div className="pt-5">
              <span className="inline-flex rounded-[20px] bg-[rgba(26,160,140,0.1)] px-4 py-1 text-[13px] text-[#2d8f98]">
                {report.file_type}
              </span>
              {report.details_preview ? (
                <p className="mt-4 text-[13px] font-light leading-relaxed text-[#5b7f8a]">
                  {report.details_preview}
                </p>
              ) : null}
              <div className="mt-4 flex items-center gap-5">
                <a
                  href={report.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-[#2d8f98] transition-colors duration-200 hover:text-[#23767f]"
                  onClick={(e) => e.stopPropagation()}
                >
                  View →
                </a>
                <a
                  href={report.url}
                  download
                  className="text-[13px] text-[#2d8f98] transition-colors duration-200 hover:text-[#23767f]"
                  onClick={(e) => e.stopPropagation()}
                >
                  Download ↓
                </a>
              </div>
              {report.requested_by ? (
                <p className="mt-3 text-[13px] font-normal text-[#5b7f8a]">
                  Requested by{" "}
                  <span className="font-medium text-[#1a5c52]">
                    {formatDoctorName(report.requested_by)}
                  </span>
                  {report.requested_by_source ? (
                    <span className="text-[#8a9ea3]">
                      {" "}
                      ({report.requested_by_source})
                    </span>
                  ) : null}
                </p>
              ) : null}
              <p className="mt-3 text-[11px] font-light text-[#8a9ea3]">
                {report.patient_uploaded ? "Uploaded by you on " : "Added on "}
                {formatHealthDate(report.uploaded_at)}
              </p>
            </div>
          ) : null}
        </button>
      </div>
    </div>
  );
}

function UploadModal({ open, onClose, onUpload }) {
  const fileInputRef = useRef(null);
  const [reportName, setReportName] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [requestedBySource, setRequestedBySource] = useState("OCS Doctor");
  const [requestedByName, setRequestedByName] = useState("");

  if (!open) return null;

  function resetForm() {
    setReportName("");
    setReportDate("");
    setSelectedFile(null);
    setDragOver(false);
    setRequestedBySource("OCS Doctor");
    setRequestedByName("");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleFileSelect(file) {
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) return;
    setSelectedFile(file);
    if (!reportName) {
      setReportName(file.name.replace(/\.[^.]+$/, ""));
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!selectedFile || !reportName.trim() || !reportDate) return;

    const isPdf = selectedFile.type === "application/pdf";
    onUpload({
      name: reportName.trim(),
      report_date: reportDate,
      uploaded_at: dayjs().format("YYYY-MM-DD"),
      file_type: isPdf ? "PDF" : "Image",
      url: URL.createObjectURL(selectedFile),
      requested_by_source: requestedBySource,
      requested_by: requestedByName.trim(),
      patient_uploaded: true,
    });
    resetForm();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(34,72,91,0.25)] p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[rgba(26,160,140,0.12)] bg-white p-10 shadow-[0_24px_64px_rgba(34,72,91,0.12)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-semibold text-[#22485b]">
          Upload a Medical Report
        </h2>
        <p className="mt-2 text-sm font-light text-[#6e949b]">
          Add test results, specialist reports or any health documents to your
          personal records.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFileSelect(e.dataTransfer.files[0]);
            }}
            className={`cursor-pointer rounded-xl border border-transparent px-4 py-8 text-center transition-colors duration-200 active:scale-[0.99] ${
              dragOver
                ? "bg-[rgba(26,160,140,0.14)]"
                : "bg-[rgba(65,200,198,0.08)]"
            }`}
          >
            <FileUp className="mx-auto size-8 text-[#2d8f98]" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-[#5b7f8a]">
              {selectedFile
                ? selectedFile.name
                : "Tap to scan or upload document"}
            </p>
            <p className="mt-1 text-xs font-light text-[#8a9ea3]">
              PDF and image files only
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0])}
            />
          </div>

          <div>
            <label
              htmlFor="report-name"
              className="text-xs font-semibold uppercase tracking-[0.15em] text-[#6e949b]"
            >
              Report name
            </label>
            <input
              id="report-name"
              type="text"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="Name this report"
              className="mt-1.5 w-full rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] px-4 py-2.5 text-sm text-[#22485b] outline-none transition focus:border-[rgba(65,200,198,0.45)] focus:bg-white"
            />
          </div>

          <div>
            <label
              htmlFor="report-date"
              className="text-xs font-semibold uppercase tracking-[0.15em] text-[#6e949b]"
            >
              Date of report
            </label>
            <input
              id="report-date"
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] px-4 py-2.5 text-sm text-[#22485b] outline-none transition focus:border-[rgba(65,200,198,0.45)] focus:bg-white"
            />
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-[#6e949b]">
              Requested by
            </span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {["OCS Doctor", "External Doctor"].map((source) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => setRequestedBySource(source)}
                  className={`rounded-xl border px-4 py-2.5 text-sm transition ${
                    requestedBySource === source
                      ? "border-[#2d8f98] bg-[rgba(26,160,140,0.08)] font-medium text-[#1a5c52]"
                      : "border-[rgba(26,160,140,0.2)] bg-white font-normal text-[#5b7f8a] hover:border-[#2d8f98]"
                  }`}
                >
                  {source}
                </button>
              ))}
            </div>
            <input
              id="requested-by-name"
              type="text"
              value={requestedByName}
              onChange={(e) => setRequestedByName(e.target.value)}
              placeholder={
                requestedBySource === "OCS Doctor"
                  ? "Name of OCS doctor who requested this"
                  : "Name of doctor who requested this"
              }
              className="mt-2 w-full rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] px-4 py-2.5 text-sm text-[#22485b] outline-none transition focus:border-[rgba(65,200,198,0.45)] focus:bg-white"
            />
          </div>

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={!selectedFile || !reportName.trim() || !reportDate}
              className="rounded-full bg-[#E8A020] px-5 py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              Upload Report
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="text-sm text-[#5b7f8a] transition hover:text-[#2d8f98]"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReportsEmptyState({ onUploadClick }) {
  return (
    <>
      <div className="flex flex-col items-center px-6 py-20 text-center max-md:hidden">
        <FileUp
          className="size-12 text-[rgba(26,160,140,0.35)]"
          strokeWidth={1.5}
        />
        <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight text-[#22485b]">
          Your medical and lab reports live here.
        </h2>
        <p className="mt-3 max-w-md text-sm font-light leading-relaxed text-[#6e949b]">
          Reports added by your OCS care team after visits and lab work will
          appear here automatically.
        </p>
        <button
          type="button"
          onClick={onUploadClick}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#e8a020] px-6 py-3.5 text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95"
        >
          + Upload Your First Report
        </button>
      </div>

      <div className="hidden px-1 pt-6 max-md:block">
        <FileUp
          className="size-9 text-[rgba(26,160,140,0.35)]"
          strokeWidth={1.5}
        />
        <h2 className="mt-4 text-[17px] font-bold leading-[1.5] text-[#1a4a42]">
          Your medical and lab reports live here.
        </h2>
        <p className="mt-2 text-[14px] font-light leading-[1.5] text-[#5b7f8a]">
          Reports added by your OCS care team after visits and lab work will
          appear here automatically.
        </p>
        <button
          type="button"
          onClick={onUploadClick}
          className="mt-5 flex h-[54px] w-full items-center justify-center rounded-[14px] bg-[#E8A020] text-[15px] font-semibold text-white shadow-[0_4px_16px_rgba(232,160,32,0.35)] transition active:scale-[0.98] active:brightness-105"
        >
          + Upload a Report
        </button>
      </div>
    </>
  );
}

function MedicalReportsTab({ reports, onUploadClick }) {
  const [expandedIds, setExpandedIds] = useState(new Set());

  function toggleExpanded(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const sorted = [...reports].sort(
    (a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at),
  );

  return (
    <div>
      {sorted.length === 0 ? (
        <ReportsEmptyState onUploadClick={onUploadClick} />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-end gap-4">
            <button
              type="button"
              onClick={onUploadClick}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#e8a020] px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95"
            >
              + Upload a Report
            </button>
          </div>
          <div className="relative">
            <div
              className="absolute bottom-0 left-[4px] top-0 w-[2px] bg-[rgba(26,160,140,0.2)]"
              aria-hidden="true"
            />
            <div className="space-y-3">
              {sorted.map((report, idx) => (
                <div
                  key={report.id}
                  className={`animate-fade-in-up stagger-${Math.min(idx + 1, 8)}`}
                >
                  <ReportTimelineNode
                    report={report}
                    expanded={expandedIds.has(report.id)}
                    onToggle={() => toggleExpanded(report.id)}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const CLINICAL_SECTIONS = [
  {
    key: "medical_history",
    label: "Medical History",
    empty: "No medical history recorded.",
    bg: "bg-[rgba(26,160,140,0.04)]",
  },
  {
    key: "surgical_history",
    label: "Surgical History",
    empty: "No surgical history recorded.",
    bg: "bg-[rgba(66,133,244,0.04)]",
  },
  {
    key: "allergy_history",
    label: "Allergy History",
    empty: "No known allergies.",
    bg: "bg-[rgba(232,160,32,0.06)]",
  },
  {
    key: "drug_history",
    label: "Drug History",
    empty: "No drug history recorded.",
    bg: "bg-[rgba(52,168,83,0.04)]",
  },
];

function ClinicalHistoryTab({ clinicalHistory }) {
  return (
    <div>
      <div className="mb-4 flex justify-end">
        <p className="text-[11px] font-light italic text-[#8a9ea3]">
          Read only · Maintained by your OCS doctor
        </p>
      </div>

      <div className="space-y-3">
        {CLINICAL_SECTIONS.map((section, idx) => {
          const items = clinicalHistory[section.key] ?? [];
          const visibleItems =
            section.key === "allergy_history"
              ? items.filter((item) => !isNilAllergyValue(item.name))
              : items;
          return (
            <div
              key={section.key}
              className={`animate-fade-in-up stagger-${Math.min(idx + 1, 8)} rounded-2xl border border-[rgba(26,160,140,0.12)] px-6 py-5 ${section.bg} max-md:rounded-[16px] max-md:border-0 max-md:bg-white max-md:px-4 max-md:py-4 max-md:shadow-[0_2px_12px_rgba(26,160,140,0.08)]`}
            >
              <SectionLabel>{section.label}</SectionLabel>
              {visibleItems.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {visibleItems.map((item) => (
                    <li key={item.id} className="flex gap-3">
                      <span className="mt-[7px] h-[6px] w-[6px] shrink-0 rounded-full bg-[#1aa08c]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-[#1a5c52] max-md:text-[14px]">
                            {section.key === "medical_history"
                              ? formatMedicalConditionName(item.name)
                              : item.name}
                          </p>
                          {section.key === "allergy_history" ? (
                            <span className="inline-flex rounded-[20px] bg-[rgba(232,160,32,0.1)] px-2.5 py-0.5 text-[11px] font-medium text-[#E8A020]">
                              Allergy
                            </span>
                          ) : null}
                        </div>
                        {item.detail ? (
                          <p className="mt-0.5 text-[13px] font-light leading-[1.5] text-[#5b7f8a] max-md:text-[14px]">
                            {formatIsoDatesInText(item.detail)}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] font-light italic text-[#6e949b] max-md:text-[14px]">
                  {section.empty}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabContent({
  activeTab,
  consultations,
  medicalReports,
  clinicalHistory,
  summary,
  timeline,
  vitalsTrends,
  onUploadClick,
  onExport,
  exporting,
}) {
  if (activeTab === "overview") {
    return (
      <>
        <div className="space-y-6 max-md:hidden">
          <HealthSummaryCard summary={summary} onExport={onExport} exporting={exporting} />
          <VitalsTrendsPanel vitalsTrends={vitalsTrends} />
        </div>
        <div className="hidden space-y-3 max-md:block">
          <MobileHealthSummaryCard summary={summary} onExport={onExport} exporting={exporting} />
          <MobileHealthStatsRow summary={summary} />
        </div>
      </>
    );
  }
  if (activeTab === "timeline") {
    return <UnifiedTimeline timeline={timeline} reportUrlBuilder={reportUrl} />;
  }
  if (activeTab === "consultations") {
    return <ConsultationHistoryTab key="consultations" consultations={consultations} />;
  }
  if (activeTab === "reports") {
    return (
      <MedicalReportsTab key="reports" reports={medicalReports} onUploadClick={onUploadClick} />
    );
  }
  return <ClinicalHistoryTab key="clinical" clinicalHistory={clinicalHistory} />;
}

function PatientHealthRecords() {
  const { user } = usePatientAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [displayedTab, setDisplayedTab] = useState("overview");
  const [tabFading, setTabFading] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [medicalReports, setMedicalReports] = useState([]);
  const [consultations, setConsultations] = useState([]);
  const [clinicalHistory, setClinicalHistory] = useState({});
  const [summary, setSummary] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [vitalsTrends, setVitalsTrends] = useState({
    blood_pressure: [],
    glucose: [],
    hba1c: [],
  });
  const [loading, setLoading] = useState(true);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;

    async function loadRecords() {
      try {
        const data = await api.get("/patient-portal/health-records");
        if (ignore) return;
        setConsultations(
          (data.consultations || []).map((consultation) => ({
            ...consultation,
            reports: (consultation.reports || []).map((report) => ({
              ...report,
              url: reportUrl(report.id),
            })),
          })),
        );
        setMedicalReports(
          (data.reports || []).map((report) => ({ ...report, url: reportUrl(report.id) })),
        );
        setClinicalHistory(data.clinical || {});
        setSummary(data.summary || null);
        setTimeline(data.timeline || []);
        setVitalsTrends(
          data.vitals_trends || { blood_pressure: [], glucose: [], hba1c: [] },
        );
      } catch {
        if (!ignore) {
          setConsultations([]);
          setMedicalReports([]);
          setClinicalHistory({});
          setSummary(null);
          setTimeline([]);
          setVitalsTrends({ blood_pressure: [], glucose: [], hba1c: [] });
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadRecords();
    return () => { ignore = true; };
  }, [refreshKey]);

  function handleTabChange(tabId) {
    if (tabId === activeTab) return;
    setActiveTab(tabId);
    setTabFading(true);
  }

  useEffect(() => {
    if (!tabFading) return undefined;
    const timer = setTimeout(() => {
      setDisplayedTab(activeTab);
      setTabFading(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [tabFading, activeTab]);

  function handleUpload(report) {
    setMedicalReports((prev) => [
      { ...report, id: Date.now() },
      ...prev,
    ]);
  }

  function handleExportPdf() {
    try {
      setExporting(true);
      exportHealthRecordsPdf({
        patientName: formatDisplayName(user?.full_name) || "Patient",
        summary,
        clinical: clinicalHistory,
        consultations,
        timeline,
      });
    } catch (error) {
      toast.error(error.message || "Could not open the PDF export.");
    } finally {
      window.setTimeout(() => setExporting(false), 600);
    }
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-8 max-md:space-y-0">
      {/* Desktop header */}
      <div className="animate-fade-in-up max-md:hidden">
        <div className="flex items-center gap-2">
          <FolderHeart
            className="size-[18px] shrink-0 text-[#6B9E95]"
            strokeWidth={1.5}
          />
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Health Records
          </p>
        </div>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
          Your Health Records.
        </h1>
        <p className="mt-2 text-sm font-light text-[#5b7f8a]">
          Everything about your health, in one place.
        </p>
      </div>

      {/* Mobile header */}
      <div className="hidden max-h-[60px] max-md:mb-3 max-md:block">
        <h1 className="text-[22px] font-bold leading-[1.5] text-[#1a4a42]">Your Health Records.</h1>
      </div>

      {/* Desktop — pill tabs */}
      <div className="animate-fade-in-up stagger-1 flex flex-wrap gap-2 max-md:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleTabChange(tab.id)}
            className={`h-[38px] rounded-[20px] px-5 text-sm transition-colors duration-200 ease-in-out ${
              activeTab === tab.id
                ? "bg-[#2d8f98] font-medium text-white"
                : "border border-[rgba(26,160,140,0.3)] bg-transparent font-normal text-[#5b7f8a]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mobile — scrollable underline tabs */}
      <div className="relative hidden max-md:mb-3 max-md:block">
        <div
          className="pointer-events-none absolute right-0 top-0 z-10 h-full w-10 bg-gradient-to-l from-white to-transparent"
          aria-hidden="true"
        />
        <div className="overflow-x-auto border-b border-[rgba(26,160,140,0.12)] [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max min-w-full whitespace-nowrap">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`relative shrink-0 px-4 py-2.5 text-[14px] font-medium leading-[1.5] transition-colors duration-200 ${
                    isActive ? "text-[#1a5c52]" : "text-[#8a9e9a]"
                  }`}
                >
                  {tab.shortLabel}
                  {isActive ? (
                    <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[#1a5c52]" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="animate-fade-in-up stagger-2 transition-opacity duration-200 ease-in-out"
        style={{ opacity: tabFading ? 0 : 1 }}
      >
        {loading ? (
          <p className="text-[13px] font-light italic text-[#8a9ea3]">
            Loading your records…
          </p>
        ) : (
          <TabContent
            activeTab={displayedTab}
            consultations={consultations}
            medicalReports={medicalReports}
            clinicalHistory={clinicalHistory}
            summary={summary}
            timeline={timeline}
            vitalsTrends={vitalsTrends}
            onUploadClick={() => setUploadOpen(true)}
            onExport={handleExportPdf}
            exporting={exporting}
          />
        )}
      </div>

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUpload={handleUpload}
      />
    </div>
  );
}

export default PatientHealthRecords;
