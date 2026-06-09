import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import { ChevronLeft, Download, FileText, Pill, FlaskConical } from "lucide-react";
import { api } from "../lib/api.js";
import { formatDoctorName } from "../lib/healthRecordsDisplay.js";
import { getMockVisitSummary, enrichConsultationForSummary } from "../components/health-records/mockVisitSummaries.js";

function doctorInitials(name) {
  const trimmed = String(name || "Dr").replace(/^dr\.?\s+/i, "").trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DR";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatVisitContext(date, time, visitType) {
  const dateLabel = dayjs(date).isValid() ? dayjs(date).format("D MMMM YYYY") : date;
  const type = visitType || "Home Visit";
  if (!time) return `${type} • ${dateLabel}`;
  return `${type} • ${dateLabel}, ${time}`;
}

function SectionTitle({ children }) {
  return <h2 className="visit-summary-section-title">{children}</h2>;
}

function PrescriptionIcon({ type }) {
  const Icon = type === "syrup" ? FlaskConical : Pill;
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgba(26,160,140,0.08)] text-[#2d8f98]">
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </div>
  );
}

function VisitSummaryPage() {
  const { consultationId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;

    async function loadSummary() {
      try {
        const data = await api.get("/patient-portal/health-records");
        if (ignore) return;

        const match = (data.consultations || []).find(
          (c) => String(c.id) === String(consultationId),
        );

        if (match) {
          setSummary(
            enrichConsultationForSummary({
              ...match,
              doctor_specialty: match.doctor_specialty || "General Practitioner",
              visit_type: match.visit_type || "Home Visit",
            }),
          );
        } else {
          setSummary(getMockVisitSummary(consultationId));
        }
      } catch {
        if (!ignore) setSummary(getMockVisitSummary(consultationId));
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadSummary();
    return () => {
      ignore = true;
    };
  }, [consultationId]);

  if (loading) {
    return (
      <div className="visit-summary-screen">
        <div className="visit-summary-header">
          <div className="h-6 w-16 animate-pulse rounded bg-white/60" />
          <div className="h-6 w-28 animate-pulse rounded bg-white/60" />
          <div className="w-16" />
        </div>
        <div className="space-y-5 px-5 pt-4">
          <div className="visit-summary-card h-56 animate-pulse" />
          <div className="visit-summary-card h-32 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="visit-summary-screen flex flex-col items-center justify-center px-6 text-center">
        <p className="text-[15px] text-[#5b7f8a]">Visit summary not found.</p>
        <Link to="/health-records" className="mt-4 text-[14px] font-semibold text-ocs-orange">
          Back to Health Records
        </Link>
      </div>
    );
  }

  const doctorName = formatDoctorName(summary.doctor_name);
  const contextLabel = formatVisitContext(summary.date, summary.time, summary.visit_type);

  return (
    <div className="visit-summary-screen">
      {/* Sticky native header */}
      <header className="visit-summary-header">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="visit-summary-back-btn"
        >
          <ChevronLeft className="size-5" strokeWidth={2.25} />
          Back
        </button>
        <h1 className="visit-summary-header-title">Visit Summary</h1>
        <span className="w-16" aria-hidden="true" />
      </header>

      <div className="visit-summary-content">
        {/* Hero — doctor context & diagnosis */}
        <article className="visit-summary-card">
          <div className="flex flex-col items-center px-5 pb-5 pt-6 text-center">
            <div className="visit-summary-hero-avatar">
              {doctorInitials(summary.doctor_name)}
            </div>
            <p className="native-display mt-4 text-[22px] leading-tight text-[#1a5c52]">
              {doctorName}
            </p>
            <p className="mt-2 text-[14px] text-[#8a9e9a]">{contextLabel}</p>
          </div>

          {summary.diagnosis ? (
            <>
              <div className="visit-summary-card-divider" aria-hidden="true" />
              <div className="flex justify-center px-5 py-5">
                <span className="squircle-inner inline-flex bg-[rgba(26,160,140,0.1)] px-4 py-2 text-[14px] font-semibold text-[#2d8f98]">
                  {summary.diagnosis}
                </span>
              </div>
            </>
          ) : null}
        </article>

        {/* Treatment plan */}
        {summary.prescriptions?.length > 0 ? (
          <section className="mt-6">
            <SectionTitle>Treatment Plan</SectionTitle>
            <article className="visit-summary-card mt-2">
              {summary.prescriptions.map((item, index) => (
                <div key={item.id}>
                  <div className="flex items-center gap-3 px-5 py-4">
                    <PrescriptionIcon type={item.type} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-[#1a5c52]">{item.name}</p>
                      <p className="mt-0.5 text-[13px] text-[#8a9e9a]">{item.dosage}</p>
                    </div>
                    <p className="shrink-0 text-[13px] font-medium text-[#5b7f8a]">{item.duration}</p>
                  </div>
                  {index < summary.prescriptions.length - 1 ? (
                    <div className="visit-summary-list-divider" aria-hidden="true" />
                  ) : null}
                </div>
              ))}
            </article>
          </section>
        ) : null}

        {/* Documents */}
        {summary.documents?.length > 0 ? (
          <section className="mt-6">
            <SectionTitle>Documents</SectionTitle>
            <article className="visit-summary-card mt-2">
              {summary.documents.map((doc, index) => (
                <div key={doc.id}>
                  <div className="flex items-center gap-3 px-5 py-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[rgba(26,160,140,0.08)] text-[#2d8f98]">
                      <FileText className="size-[18px]" strokeWidth={1.75} />
                    </div>
                    <p className="min-w-0 flex-1 text-[15px] font-medium text-[#1a5c52]">
                      {doc.name}
                    </p>
                    <a
                      href={doc.url}
                      download
                      aria-label={`Download ${doc.name}`}
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-ocs-orange transition active:scale-95 active:bg-[rgba(232,160,32,0.1)]"
                    >
                      <Download className="size-[20px]" strokeWidth={2} />
                    </a>
                  </div>
                  {index < summary.documents.length - 1 ? (
                    <div className="visit-summary-list-divider" aria-hidden="true" />
                  ) : null}
                </div>
              ))}
            </article>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export default VisitSummaryPage;
