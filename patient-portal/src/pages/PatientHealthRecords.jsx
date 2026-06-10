import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { FolderHeart } from "lucide-react";
import { api, buildAuthedFileUrl } from "../lib/api.js";
import { dispatchPatientDataChange } from "../lib/patientDataSync.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import HealthRecordsSegmentedControl from "../components/health-records/HealthRecordsSegmentedControl.jsx";
import ConsultationsView from "../components/health-records/ConsultationsView.jsx";
import ReportsView from "../components/health-records/ReportsView.jsx";
import ClinicalHistoryView from "../components/health-records/ClinicalHistoryView.jsx";
import UploadReportModal from "../components/health-records/UploadReportModal.jsx";

function reportUrl(attachmentId) {
  return buildAuthedFileUrl(`/patient-portal/reports/attachments/${attachmentId}/download`);
}

function HealthRecordsTabPanel({ activeTab, consultations, reports, clinicalHistory, onUpload }) {
  if (activeTab === "consultations") {
    return <ConsultationsView consultations={consultations} />;
  }
  if (activeTab === "reports") {
    return <ReportsView reports={reports} onUpload={onUpload} />;
  }
  return <ClinicalHistoryView clinicalHistory={clinicalHistory} />;
}

function PatientHealthRecords() {
  const [activeTab, setActiveTab] = useState("consultations");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [consultations, setConsultations] = useState([]);
  const [medicalReports, setMedicalReports] = useState([]);
  const [clinicalHistory, setClinicalHistory] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setLoadError(null);

    async function loadRecords() {
      try {
        const data = await api.get("/patient-portal/health-records");
        if (ignore) return;

        const apiConsultations = (data.consultations || []).map((c) => ({
          id: c.id,
          date: c.date,
          time: c.time || null,
          doctor_name: c.doctor_name,
          doctor_specialty: c.doctor_specialty || "General Practitioner",
          visit_type: c.visit_type || "Home Visit",
          diagnosis: c.diagnosis,
          plain_summary: c.plain_summary || c.note_preview || null,
        }));

        const apiReports = (data.reports || []).map((report) => ({
          id: report.id,
          name: report.name,
          report_date: report.report_date || report.uploaded_at,
          uploaded_at: report.uploaded_at,
          requested_by_source: report.requested_by_source || "OCS Doctor",
          url: reportUrl(report.id),
        }));

        setConsultations(apiConsultations);
        setMedicalReports(apiReports);
        setClinicalHistory(data.clinical || {});
      } catch (error) {
        if (!ignore) {
          setLoadError(
            error?.message || "We couldn't load your health records. Check your connection and try again.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadRecords();
    return () => {
      ignore = true;
    };
  }, [refreshKey, retryToken]);

  async function reloadReports() {
    const data = await api.get("/patient-portal/health-records");
    const apiReports = (data.reports || []).map((report) => ({
      id: report.id,
      name: report.name,
      report_date: report.report_date || report.uploaded_at,
      uploaded_at: report.uploaded_at,
      requested_by_source: report.requested_by_source || "OCS Doctor",
      url: reportUrl(report.id),
    }));
    setMedicalReports(apiReports);
  }

  async function handleUpload(report) {
    if (!report.file) {
      toast.error("Please choose a file to upload.");
      throw new Error("No file selected");
    }

    const formData = new FormData();
    formData.append("file", report.file);
    formData.append("name", report.name);
    formData.append("report_date", report.report_date);
    formData.append("requested_by_source", report.requested_by_source || "OCS Doctor");
    formData.append("requested_by", report.requested_by || "");

    try {
      await api.postForm("/patient-portal/reports", formData);
      await reloadReports();
      setActiveTab("reports");
      toast.success("Report uploaded to your health records.");
      dispatchPatientDataChange();
    } catch (error) {
      toast.error(error?.message || "Could not upload this report.");
      throw error;
    }
  }

  function handleRetry() {
    setRetryToken((token) => token + 1);
  }

  return (
    <div className="native-screen mx-auto flex w-full max-w-[720px] flex-col lg:max-w-4xl lg:pt-10">
      <header className="sticky top-0 z-40 -mx-[var(--native-pad-screen)] border-b border-gray-200/60 bg-[rgba(242,242,247,0.92)] px-[var(--native-pad-screen)] pt-safe backdrop-blur-xl backdrop-saturate-150 max-lg:pb-0 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-filter-none lg:animate-fade-in-up">
        <div className="hidden items-center gap-2 lg:flex">
          <FolderHeart className="size-[18px] shrink-0 text-[#6B9E95]" strokeWidth={1.5} />
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Health Records
          </p>
        </div>
        <h1 className="py-2 text-[22px] font-bold tracking-tight text-gray-900 lg:mt-0 lg:py-0 lg:font-[family-name:var(--font-display)] lg:text-4xl lg:leading-tight lg:text-[#1a5c52]">
          Health Records
        </h1>
        <p className="mt-2 hidden text-[14px] leading-relaxed text-[#8a9e9a] lg:block">
          Consultations, reports, and clinical background — in one calm place.
        </p>
        <div className="max-lg:pb-3 lg:hidden">
          <HealthRecordsSegmentedControl activeTab={activeTab} onChange={setActiveTab} />
        </div>
      </header>

      <div className="hidden lg:mt-8 lg:mb-8 lg:block">
        <HealthRecordsSegmentedControl
          activeTab={activeTab}
          onChange={setActiveTab}
          layout="desktop"
        />
      </div>

      <div className="min-h-[40vh] w-full" role="tabpanel" aria-label={activeTab}>
        {loading ? (
          <>
            <div className="native-grouped-list overflow-hidden rounded-2xl bg-white lg:hidden">
              <div className="h-[72px] animate-pulse border-b border-gray-100 bg-gray-50/80" />
              <div className="h-[72px] animate-pulse bg-gray-50/60" />
            </div>
            <div className="hidden space-y-4 lg:block">
              <div className="h-28 animate-pulse rounded-2xl bg-white/70" />
              <div className="h-28 animate-pulse rounded-2xl bg-white/70" />
            </div>
          </>
        ) : loadError ? (
          <div className="flex flex-col items-center px-4 py-16 text-center">
            <p className="native-display text-[20px] text-[#1a5c52]">Couldn&apos;t load health records</p>
            <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-[#5b7f8a]">{loadError}</p>
            <button
              type="button"
              onClick={handleRetry}
              className="request-wizard-primary-btn mt-6 w-full max-w-[280px]"
            >
              Try Again
            </button>
          </div>
        ) : (
          <HealthRecordsTabPanel
            activeTab={activeTab}
            consultations={consultations}
            reports={medicalReports}
            clinicalHistory={clinicalHistory}
            onUpload={() => setUploadOpen(true)}
          />
        )}
      </div>

      <UploadReportModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUpload={handleUpload}
      />
    </div>
  );
}

export default PatientHealthRecords;
