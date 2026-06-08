import { useRef, useState } from "react";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import {
  FolderHeart,
  ChevronRight,
  FileText,
  FileUp,
} from "lucide-react";

const SAMPLE_CONSULTATIONS = [
  {
    id: 1,
    date: "2026-06-07",
    doctor_name: "Dr. Avinash Sharma",
    diagnosis: "URTI",
    reports: [
      {
        id: 1,
        name: "Throat Swab Results — 7 June 2026",
        url: "/sample-reports/throat-swab-results.pdf",
      },
    ],
  },
  {
    id: 2,
    date: "2026-04-15",
    doctor_name: "Dr. Priya Nair",
    diagnosis: "Viral Fever",
    reports: [
      {
        id: 2,
        name: "Blood Panel — 15 April 2026",
        url: "/sample-reports/blood-panel-april.pdf",
      },
    ],
  },
  {
    id: 3,
    date: "2026-01-02",
    doctor_name: "Dr. Avinash Sharma",
    diagnosis: "Hypertension Review",
    reports: [],
  },
];

const SAMPLE_MEDICAL_REPORTS = [
  {
    id: 1,
    uploaded_at: "2026-06-08",
    report_date: "2026-06-05",
    name: "Blood Panel — Private Lab",
    file_type: "PDF",
    url: "/sample-reports/blood-panel-private-lab.pdf",
    requested_by_source: "External Doctor",
    requested_by: "Dr. Meera Iyer",
  },
  {
    id: 2,
    uploaded_at: "2026-03-12",
    report_date: "2026-03-10",
    name: "Cardiology Specialist Report",
    file_type: "PDF",
    url: "/sample-reports/cardiology-report.pdf",
    requested_by_source: "OCS Doctor",
    requested_by: "Dr. Avinash Sharma",
  },
];

const TABS = [
  { id: "consultations", label: "Consultation History" },
  { id: "reports", label: "Medical Reports" },
];

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
    <div className="relative flex gap-5">
      <div className="relative z-10 mt-7 shrink-0">
        <div className="h-[10px] w-[10px] rounded-full bg-[#1aa08c]" />
      </div>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          className="group w-full rounded-xl border border-[rgba(26,160,140,0.12)] bg-white px-6 py-5 text-left transition-colors duration-200 ease-in-out hover:bg-[rgba(26,160,140,0.04)]"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[15px] font-bold text-[#1a5c52]">
                {dayjs(consultation.date).format("D MMMM YYYY")}
              </p>
              <p className="mt-0.5 text-sm font-light text-[#5b7f8a]">
                {consultation.doctor_name}
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
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#e8a020] px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_40px_rgba(232,160,32,0.38)] transition hover:brightness-105"
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
            {consultations.map((consultation) => (
              <ConsultationTimelineNode
                key={consultation.id}
                consultation={consultation}
                expanded={expandedIds.has(consultation.id)}
                onToggle={() => toggleExpanded(consultation.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ReportTimelineNode({ report, expanded, onToggle }) {
  return (
    <div className="relative flex gap-5">
      <div className="relative z-10 mt-7 shrink-0">
        <div className="h-[10px] w-[10px] rounded-full bg-[#1aa08c]" />
      </div>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggle}
          className="group w-full rounded-xl border border-[rgba(26,160,140,0.12)] bg-white px-6 py-5 text-left transition-colors duration-200 ease-in-out hover:bg-[rgba(26,160,140,0.04)]"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[15px] font-bold text-[#1a5c52]">
                {dayjs(report.uploaded_at).format("D MMMM YYYY")}
              </p>
              <p className="mt-0.5 text-sm font-medium text-[#5b7f8a]">
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
              <p className="text-sm font-normal text-[#1a5c52]">{report.name}</p>
              <span className="mt-3 inline-flex rounded-[20px] bg-[rgba(26,160,140,0.1)] px-4 py-1 text-[13px] text-[#2d8f98]">
                {report.file_type}
              </span>
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
                    {report.requested_by}
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
                Uploaded by you on{" "}
                {dayjs(report.uploaded_at).format("D MMMM YYYY")}
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
        className="w-full max-w-md rounded-2xl border border-[rgba(26,160,140,0.12)] bg-white p-6 shadow-[0_24px_64px_rgba(34,72,91,0.12)]"
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
            className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors duration-200 ${
              dragOver
                ? "border-[#2d8f98] bg-[rgba(26,160,140,0.08)]"
                : "border-[rgba(26,160,140,0.25)] bg-[rgba(26,160,140,0.04)]"
            }`}
          >
            <FileUp className="mx-auto size-8 text-[#2d8f98]" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-[#5b7f8a]">
              {selectedFile
                ? selectedFile.name
                : "Drag and drop or click to browse"}
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
              className="mt-1.5 w-full rounded-xl border border-[rgba(26,160,140,0.2)] bg-white px-4 py-2.5 text-sm text-[#22485b] outline-none transition focus:border-[#2d8f98]"
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
              className="mt-1.5 w-full rounded-xl border border-[rgba(26,160,140,0.2)] bg-white px-4 py-2.5 text-sm text-[#22485b] outline-none transition focus:border-[#2d8f98]"
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
              className="mt-2 w-full rounded-xl border border-[rgba(26,160,140,0.2)] bg-white px-4 py-2.5 text-sm text-[#22485b] outline-none transition focus:border-[#2d8f98]"
            />
          </div>

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={!selectedFile || !reportName.trim() || !reportDate}
              className="rounded-full bg-[#e8a020] px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_32px_rgba(232,160,32,0.35)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="flex flex-col items-center px-6 py-20 text-center">
          <FileUp
            className="size-12 text-[rgba(26,160,140,0.35)]"
            strokeWidth={1.5}
          />
          <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight text-[#22485b]">
            Your personal health documents live here.
          </h2>
          <p className="mt-3 max-w-md text-sm font-light leading-relaxed text-[#6e949b]">
            Upload test results, specialist reports or any health records you
            want to keep safe and accessible.
          </p>
          <button
            type="button"
            onClick={onUploadClick}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-[#e8a020] px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_40px_rgba(232,160,32,0.38)] transition hover:brightness-105"
          >
            + Upload Your First Report
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={onUploadClick}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#e8a020] px-5 py-2 text-sm font-bold text-white shadow-[0_12px_32px_rgba(232,160,32,0.35)] transition hover:brightness-105"
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
              {sorted.map((report) => (
                <ReportTimelineNode
                  key={report.id}
                  report={report}
                  expanded={expandedIds.has(report.id)}
                  onToggle={() => toggleExpanded(report.id)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PatientHealthRecords() {
  const [activeTab, setActiveTab] = useState("consultations");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [medicalReports, setMedicalReports] = useState(SAMPLE_MEDICAL_REPORTS);
  const consultations = SAMPLE_CONSULTATIONS;

  function handleUpload(report) {
    setMedicalReports((prev) => [
      { ...report, id: Date.now() },
      ...prev,
    ]);
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-8">
      <div className="animate-fade-in-up">
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

      <div className="flex gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
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

      <div
        key={activeTab}
        className="animate-fade-in"
        style={{ animationDuration: "200ms" }}
      >
        {activeTab === "consultations" ? (
          <ConsultationHistoryTab consultations={consultations} />
        ) : (
          <MedicalReportsTab
            reports={medicalReports}
            onUploadClick={() => setUploadOpen(true)}
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
