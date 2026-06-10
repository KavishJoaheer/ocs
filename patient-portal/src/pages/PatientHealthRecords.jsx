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
    <div className="native-screen mx-auto w-full max-w-[720px] lg:max-w-4xl">
      {/* Page header */}
      <header className="animate-fade-in-up pb-6 max-md:pb-5">
        <div className="flex items-center gap-2 max-md:hidden">
          <FolderHeart className="size-[18px] shrink-0 text-[#6B9E95]" strokeWidth={1.5} />
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
            Health Records
          </p>
        </div>
        <h1 className="native-display mt-2 text-[28px] leading-tight text-[#1a5c52] max-md:mt-0 max-md:text-[26px] lg:text-4xl">
          Your Health Records.
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[#8a9e9a] max-md:hidden">
          Consultations, reports, and clinical background — in one calm place.
        </p>
      </header>

      {/* Segmented control */}
      <div className="animate-fade-in-up stagger-1 mb-6">
        <HealthRecordsSegmentedControl activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* Active view */}
      <div
        className="animate-fade-in-up stagger-2 min-h-[40vh] transition-opacity duration-200"
        role="tabpanel"
        aria-label={activeTab}
      >
        {loading ? (
          <div className="space-y-4">
            <div className="squircle-outer h-28 animate-pulse bg-white/70" />
            <div className="squircle-outer h-28 animate-pulse bg-white/70" />
          </div>
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
