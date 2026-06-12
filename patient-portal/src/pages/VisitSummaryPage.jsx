import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import dayjs from "dayjs";
import { ArrowLeft, ChevronLeft, Download, FileText } from "lucide-react";
import { api } from "../lib/api.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { formatDoctorName } from "../lib/healthRecordsDisplay.js";
import { buildVisitSummary } from "../lib/visitSummary.js";
import { DesktopPageFrame } from "../components/DesktopPageFrame.jsx";

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

function formatConsultationDate(date) {
  return dayjs(date).isValid() ? dayjs(date).format("D MMMM YYYY") : date;
}

function SectionTitle({ children }) {
  return <h2 className="visit-summary-section-title">{children}</h2>;
}

function MobilePrescribedMedications({ prescriptions }) {
  if (!prescriptions?.length) return null;

  return (
    <section className="px-1">
      <h2 className="text-ocs-slate mt-6 border-b border-slate-100 pb-2 mb-3 text-lg font-semibold">
        Prescribed Medications
      </h2>
      <ul className="flex flex-col gap-4">
        {prescriptions.map((item) => (
          <li key={item.id}>
            <p className="text-slate-800 text-base font-medium">{item.name}</p>
            {item.instructions ? (
              <p className="text-slate-500 mt-1 text-sm leading-relaxed">{item.instructions}</p>
            ) : item.dosage && item.dosage !== item.name ? (
              <p className="text-slate-500 mt-1 text-sm leading-relaxed">{item.dosage}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DesktopPrescribedMedications({ prescriptions }) {
  if (!prescriptions?.length) return null;

  return (
    <section className="mt-8 text-left">
      <h2 className="text-ocs-slate border-b border-slate-100 pb-2 mb-3 text-lg font-semibold">
        Prescribed Medications
      </h2>
      <ul className="space-y-0">
        {prescriptions.map((item) => (
          <li key={item.id} className="py-2">
            <p className="text-slate-800 font-medium">{item.name}</p>
            {item.instructions ? (
              <p className="text-slate-500 mt-1 text-sm leading-relaxed">{item.instructions}</p>
            ) : item.dosage && item.dosage !== item.name ? (
              <p className="text-slate-500 mt-1 text-sm leading-relaxed">{item.dosage}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DesktopDocuments({ documents }) {
  if (!documents?.length) return null;

  return (
    <section className="mt-8 text-left">
      <h2 className="text-ocs-slate mb-3 text-lg font-semibold">Documents</h2>
      <ul className="space-y-2">
        {documents.map((doc) => (
          <li key={doc.id}>
            <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-teal/10 text-ocs-teal">
                <FileText className="size-[18px]" strokeWidth={1.75} />
              </div>
              <p className="min-w-0 flex-1 text-sm font-medium text-ocs-slate">{doc.name}</p>
              <a
                href={doc.url}
                download
                aria-label={`Download ${doc.name}`}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-ocs-teal transition hover:bg-brand-teal/10"
              >
                <Download className="size-5" strokeWidth={2} />
              </a>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function VisitSummaryPage() {
  const { consultationId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);

    async function loadSummary() {
      try {
        const data = await api.get("/patient-portal/health-records");
        if (ignore) return;

        const match = (data.consultations || []).find(
          (c) => String(c.id) === String(consultationId),
        );

        if (match) {
          setSummary(buildVisitSummary(match));
          setNotFound(false);
        } else {
          setSummary(null);
          setNotFound(true);
        }
      } catch (error) {
        if (!ignore) {
          setSummary(null);
          setLoadError(
            error?.message || "We couldn't load this visit summary. Check your connection and try again.",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadSummary();
    return () => {
      ignore = true;
    };
  }, [consultationId, refreshKey, retryToken]);

  if (loading) {
    return (
      <>
        <div className="visit-summary-screen lg:hidden">
          <div className="visit-summary-header">
            <div className="h-6 w-16 animate-pulse rounded bg-white/60" />
            <div className="h-6 w-28 animate-pulse rounded bg-white/60" />
            <div className="w-16" />
          </div>
          <div className="visit-summary-content space-y-5 pt-4">
            <div className="visit-summary-card h-56 animate-pulse" />
            <div className="visit-summary-card h-32 animate-pulse" />
          </div>
        </div>
        <div className="max-lg:hidden">
          <DesktopPageFrame className="px-10 pb-10 pt-6">
            <div className="desktop-card h-72 animate-pulse" />
          </DesktopPageFrame>
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <div className="visit-summary-screen flex flex-col items-center justify-center px-6 py-16 text-center lg:hidden">
          <p className="native-display text-[20px] text-[#1a5c52]">Couldn&apos;t load visit summary</p>
          <p className="mt-2 max-w-xs text-[14px] leading-relaxed text-[#5b7f8a]">{loadError}</p>
          <button
            type="button"
            onClick={() => setRetryToken((token) => token + 1)}
            className="request-wizard-primary-btn mt-6 w-full max-w-[280px]"
          >
            Try Again
          </button>
          <Link to="/health-records" className="mt-4 text-[14px] font-semibold text-brand-gold">
            Back to Health Records
          </Link>
        </div>
        <div className="max-lg:hidden">
          <DesktopPageFrame className="flex min-h-[50vh] flex-col items-center justify-center px-10 py-16 text-center">
            <p className="font-display text-xl font-bold text-ocs-slate">Couldn&apos;t load visit summary</p>
            <p className="mt-2 max-w-md text-sm text-brand-cool-grey">{loadError}</p>
            <button
              type="button"
              onClick={() => setRetryToken((token) => token + 1)}
              className="request-wizard-primary-btn mt-6"
            >
              Try Again
            </button>
            <Link to="/health-records" className="mt-4 text-sm font-semibold text-ocs-teal">
              Back to Health Records
            </Link>
          </DesktopPageFrame>
        </div>
      </>
    );
  }

  if (notFound || !summary) {
    return (
      <>
        <div className="visit-summary-screen flex flex-col items-center justify-center px-6 text-center lg:hidden">
          <p className="text-[15px] text-[#5b7f8a]">Visit summary not found.</p>
          <Link to="/health-records" className="mt-4 text-[14px] font-semibold text-brand-gold">
            Back to Health Records
          </Link>
        </div>
        <div className="max-lg:hidden">
          <DesktopPageFrame className="flex min-h-[40vh] flex-col items-center justify-center px-10 py-16 text-center">
            <p className="text-sm text-brand-cool-grey">Visit summary not found.</p>
            <Link to="/health-records" className="mt-4 text-sm font-semibold text-ocs-teal">
              Back to Health Records
            </Link>
          </DesktopPageFrame>
        </div>
      </>
    );
  }

  const doctorName = formatDoctorName(summary.doctor_name);
  const contextLabel = formatVisitContext(summary.date, summary.time, summary.visit_type);
  const dateLabel = formatConsultationDate(summary.date);

  return (
    <>
      <div className="visit-summary-screen lg:hidden">
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
          <article className="visit-summary-card">
            <div className="flex flex-col items-center px-5 pb-5 pt-6 text-center">
              <div className="visit-summary-hero-avatar">
                {doctorInitials(summary.doctor_name)}
              </div>
              <p className="native-display mt-4 text-[22px] leading-tight text-ocs-slate">
                {doctorName}
              </p>
              <p className="mt-2 text-[14px] text-brand-cool-grey">{contextLabel}</p>
            </div>

            {summary.diagnosis ? (
              <>
                <div className="visit-summary-card-divider" aria-hidden="true" />
                <div className="flex justify-center px-5 py-5">
                  <span className="squircle-inner inline-flex bg-brand-teal/10 px-4 py-2 text-[14px] font-semibold text-ocs-teal">
                    {summary.diagnosis}
                  </span>
                </div>
              </>
            ) : null}
          </article>

          <MobilePrescribedMedications prescriptions={summary.prescriptions} />

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
                        className="flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-brand-gold transition active:scale-95 active:bg-brand-gold/10"
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

      <div className="max-lg:hidden">
        <DesktopPageFrame className="px-10 pb-12 pt-6">
          <Link
            to="/health-records"
            className="inline-flex items-center gap-2 text-sm font-semibold text-ocs-teal transition hover:text-ocs-slate"
          >
            <ArrowLeft className="size-4" strokeWidth={2.25} aria-hidden="true" />
            Back to Health Records
          </Link>

          <article className="desktop-card mx-auto mt-6 max-w-3xl">
            <div className="flex flex-col items-center px-8 pb-6 pt-8 text-center">
              <div
                className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-brand-teal to-[#5ed9d2] text-lg font-bold text-white shadow-[0_6px_20px_rgba(43,204,196,0.22)]"
                aria-hidden="true"
              >
                {doctorInitials(summary.doctor_name)}
              </div>
              <p className="font-display mt-5 text-2xl font-bold leading-tight text-ocs-slate">
                {doctorName}
              </p>
              <p className="mt-2 text-sm text-brand-cool-grey">{dateLabel}</p>
              {summary.visit_type ? (
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-ocs-teal">
                  {summary.visit_type}
                </p>
              ) : null}
            </div>

            {summary.diagnosis ? (
              <>
                <div className="mx-8 border-t border-slate-100" aria-hidden="true" />
                <div className="flex justify-center px-8 py-6">
                  <span className="inline-flex rounded-[14px] bg-brand-teal/10 px-5 py-2 text-sm font-semibold text-ocs-teal">
                    {summary.diagnosis}
                  </span>
                </div>
              </>
            ) : null}

            <div className="px-8 pb-8">
              <DesktopPrescribedMedications prescriptions={summary.prescriptions} />
              <DesktopDocuments documents={summary.documents} />
            </div>
          </article>
        </DesktopPageFrame>
      </div>
    </>
  );
}

export default VisitSummaryPage;
