import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { exportHealthRecordsPdf } from "../lib/healthRecordsExport.js";
import { dispatchPatientDataChange } from "../lib/patientDataSync.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import PageHeroHeader from "../components/PageHeroHeader.jsx";
import MobilePageTitle from "../components/MobilePageTitle.jsx";
import { DesktopPageBody, DesktopPageFrame } from "../components/DesktopPageFrame.jsx";
import HealthRecordsSegmentedControl from "../components/health-records/HealthRecordsSegmentedControl.jsx";
import ConsultationsView from "../components/health-records/ConsultationsView.jsx";
import ReportsView from "../components/health-records/ReportsView.jsx";
import ClinicalHistoryView from "../components/health-records/ClinicalHistoryView.jsx";
import UploadReportModal from "../components/health-records/UploadReportModal.jsx";

function HealthRecordsTabPanel({ activeTab, consultations, reports, clinicalHistory, onUpload, highlightId }) {
  if (activeTab === "consultations") {
    return <ConsultationsView consultations={consultations} highlightId={highlightId} />;
  }
  if (activeTab === "reports") {
    return <ReportsView reports={reports} onUpload={onUpload} />;
  }
  return <ClinicalHistoryView clinicalHistory={clinicalHistory} />;
}

function PatientHealthRecords() {
  const { consultationId } = useParams();
  const { user } = usePatientAuth();
  const [activeTab, setActiveTab] = useState("consultations");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [consultations, setConsultations] = useState([]);
  const [medicalReports, setMedicalReports] = useState([]);
  const [clinicalHistory, setClinicalHistory] = useState({});
  const [summary, setSummary] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    if (consultationId) {
      setActiveTab("consultations");
    }
  }, [consultationId]);

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
          patient_prescription: c.patient_prescription || null,
          prescriptions: c.prescriptions || [],
        }));

        const apiReports = (data.reports || []).map((report) => ({
          id: report.id,
          name: report.name,
          report_date: report.report_date || report.uploaded_at,
          uploaded_at: report.uploaded_at,
          requested_by_source: report.requested_by_source || "OCS Doctor",
        }));

        setConsultations(apiConsultations);
        setMedicalReports(apiReports);
        setClinicalHistory(data.clinical || {});
        setSummary(data.summary || null);
        setTimeline(Array.isArray(data.timeline) ? data.timeline : []);
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

  function handleExportPdf() {
    exportHealthRecordsPdf({
      patientName: user?.full_name || "Patient",
      summary,
      clinical: clinicalHistory,
      consultations,
      timeline,
    });
  }

  return (
    <DesktopPageFrame className="mobile-hero-page native-health-records flex flex-col font-sans lg:bg-transparent">
      <MobilePageTitle
        primaryText="Your Health"
        secondaryText="Records."
        subtitle="Everything about your health, in one place."
        className="pb-2"
      >
        {!loading && !loadError ? (
          <button
            type="button"
            onClick={handleExportPdf}
            className="mt-3 text-[13px] font-semibold text-brand-teal"
          >
            Export PDF
          </button>
        ) : null}
      </MobilePageTitle>

      <PageHeroHeader
        primaryText="Health"
        secondaryText="Records"
        subtitle="Your health journey, securely organised."
      />

      <DesktopPageBody>
        <div className="mb-5 lg:hidden">
          <HealthRecordsSegmentedControl activeTab={activeTab} onChange={setActiveTab} />
        </div>

        <div className="mt-6 hidden items-center justify-between gap-4 lg:flex">
          <HealthRecordsSegmentedControl
            activeTab={activeTab}
            onChange={setActiveTab}
            layout="desktop"
          />
          {!loading && !loadError ? (
            <button
              type="button"
              onClick={handleExportPdf}
              className="shrink-0 text-sm font-semibold text-brand-teal transition hover:text-brand-dark-grey"
            >
              Export PDF
            </button>
          ) : null}
        </div>

        <div className="min-h-[40vh] w-full lg:mt-0" role="tabpanel" aria-label={activeTab}>
          {loading ? (
            <>
              <div className="flex flex-col gap-4 lg:hidden">
                <div className="ocs-surface-card h-36 animate-pulse bg-white/80" />
                <div className="ocs-surface-card h-36 animate-pulse bg-white/80" />
              </div>
              <div className="hidden space-y-4 lg:block">
                <div className="h-28 animate-pulse rounded-2xl bg-white/70" />
                <div className="h-28 animate-pulse rounded-2xl bg-white/70" />
              </div>
            </>
          ) : loadError ? (
            <div className="flex flex-col items-center px-4 py-16 text-center">
              <p className="text-[20px] font-bold text-brand-dark-grey">Couldn&apos;t load health records</p>
              <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-gray-500 lg:text-brand-cool-grey">{loadError}</p>
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
              highlightId={consultationId}
            />
          )}
        </div>
      </DesktopPageBody>

      <UploadReportModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUpload={handleUpload}
      />
    </DesktopPageFrame>
  );
}

export default PatientHealthRecords;
