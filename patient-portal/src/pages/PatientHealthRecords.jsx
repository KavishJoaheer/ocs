import { useEffect, useState } from "react";
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
import {
  HealthSummaryCard,
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
          className="group w-full rounded-xl border border-[rgba(26,160,140,0.12)] bg-white px-6 py-5 text-left transition-colors duration-200 ease-in-out hover:bg-[rgba(26,160,140,0.04)] max-md:px-[14px] max-md:py-[14px]"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[15px] font-bold text-[#1a5c52] max-md:text-[14px]">
                {dayjs(consultation.date).format("D MMMM YYYY")}
              </p>
              <p className="mt-0.5 text-sm font-light text-[#5b7f8a] max-md:text-[13px]">
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

              {consultation.plain_summary ? (
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
          className="group w-full rounded-xl border border-[rgba(26,160,140,0.12)] bg-white px-6 py-5 text-left transition-colors duration-200 ease-in-out hover:bg-[rgba(26,160,140,0.04)] max-md:px-[14px] max-md:py-[14px]"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[15px] font-bold text-[#1a5c52] max-md:text-[14px]">
                {dayjs(report.uploaded_at).format("D MMMM YYYY")}
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
                Added on {dayjs(report.uploaded_at).format("D MMMM YYYY")}
              </p>
            </div>
          ) : null}
        </button>
      </div>
    </div>
  );
}

function MedicalReportsTab({ reports }) {
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
            Your medical and lab reports live here.
          </h2>
          <p className="mt-3 max-w-md text-sm font-light leading-relaxed text-[#6e949b]">
            Reports added by your OCS care team after visits and lab work will
            appear here automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex justify-end">
            <p className="text-[11px] font-light italic text-[#8a9ea3]">
              Read only · Added by your OCS care team
            </p>
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
          return (
            <div
              key={section.key}
              className={`animate-fade-in-up stagger-${Math.min(idx + 1, 8)} rounded-2xl border border-[rgba(26,160,140,0.12)] px-6 py-5 ${section.bg}`}
            >
              <SectionLabel>{section.label}</SectionLabel>
              {items.length > 0 ? (
                <ul className="mt-3 space-y-3">
                  {items.map((item) => (
                    <li key={item.id} className="flex gap-3">
                      <span className="mt-[7px] h-[6px] w-[6px] shrink-0 rounded-full bg-[#1aa08c]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-[#1a5c52]">
                            {item.name}
                          </p>
                          {section.key === "allergy_history" ? (
                            <span className="inline-flex rounded-[20px] bg-[rgba(232,160,32,0.1)] px-2.5 py-0.5 text-[11px] font-medium text-[#E8A020]">
                              Allergy
                            </span>
                          ) : null}
                        </div>
                        {item.detail ? (
                          <p className="mt-0.5 text-[13px] font-light text-[#5b7f8a]">
                            {item.detail}
                          </p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] font-light italic text-[#6e949b]">
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
  onExport,
  exporting,
}) {
  if (activeTab === "overview") {
    return (
      <div className="space-y-6">
        <HealthSummaryCard summary={summary} onExport={onExport} exporting={exporting} />
        <VitalsTrendsPanel vitalsTrends={vitalsTrends} />
      </div>
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
      <MedicalReportsTab key="reports" reports={medicalReports} />
    );
  }
  return <ClinicalHistoryTab key="clinical" clinicalHistory={clinicalHistory} />;
}

function PatientHealthRecords() {
  const { user } = usePatientAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [displayedTab, setDisplayedTab] = useState("overview");
  const [tabFading, setTabFading] = useState(false);
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

  function handleExportPdf() {
    try {
      setExporting(true);
      exportHealthRecordsPdf({
        patientName: user?.full_name || "Patient",
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

      {/* Mobile — iOS-style segmented control */}
      <div className="animate-fade-in-up stagger-1 hidden max-md:block">
        <div className="relative flex overflow-x-auto rounded-[10px] bg-[rgba(118,118,128,0.12)] p-[3px]">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`relative z-10 flex h-11 min-w-[88px] flex-1 items-center justify-center px-2 text-[12px] transition-colors duration-200 ${
                  isActive ? "font-semibold text-[#1a5c52]" : "font-medium text-[#5b7f8a]"
                }`}
              >
                {tab.shortLabel}
              </button>
            );
          })}
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
            onExport={handleExportPdf}
            exporting={exporting}
          />
        )}
      </div>
    </div>
  );
}

export default PatientHealthRecords;
