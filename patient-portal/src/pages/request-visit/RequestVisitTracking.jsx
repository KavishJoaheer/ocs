import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { api } from "../../lib/api.js";
import { useLiveRefreshKey } from "../../hooks/useLiveRefreshKey.js";
import VisitCancelPrompt from "../../components/VisitCancelPrompt.jsx";
import VisitProgressTracker, {
  visitStatusToStepIndex,
} from "../../components/visit-status/VisitProgressTracker.jsx";
import VisitDoctorCard from "../../components/visit-status/VisitDoctorCard.jsx";

const PREP_ITEMS = [
  "Have previous medical records handy.",
  "Ensure someone is available to open the door.",
  "Secure any pets if needed.",
];

function formatEtaHeading(visit) {
  if (visit.status === "arrived" || visit.status === "in_consultation") {
    return "Your doctor has arrived";
  }
  if (visit.status === "en_route") {
    const minutes = visit.eta_minutes ?? 25;
    return `Arriving in approx. ${minutes} mins`;
  }
  if (visit.status === "assigned") {
    return "Your doctor is preparing to leave";
  }
  return "We're reviewing your request";
}

function VisitStatusHeader({ onBack }) {
  return (
    <header className="visit-status-header">
      <button type="button" onClick={onBack} className="visit-status-back-btn">
        <ChevronLeft className="size-5" strokeWidth={2.25} />
        Back
      </button>
      <h1 className="visit-status-header-title">Visit Status</h1>
      <span className="w-16" aria-hidden="true" />
    </header>
  );
}

function RequestVisitTracking() {
  const navigate = useNavigate();
  const [visit, setVisit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const refreshKey = useLiveRefreshKey();

  useEffect(() => {
    let ignore = false;
    setLoading(true);

    async function load() {
      setLoadError(null);
      try {
        const data = await api.get("/patient-portal/visit-requests/active");
        if (!ignore) {
          setVisit(data.visit_request || null);
        }
      } catch (error) {
        if (!ignore) {
          setVisit(null);
          setLoadError(error?.message || "Could not load your visit status.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [refreshKey, retryToken]);

  if (loading) {
    return (
      <div className="visit-status-screen">
        <VisitStatusHeader onBack={() => navigate("/dashboard")} />
        <div className="visit-status-content visit-status-content--padded space-y-6">
          <div className="h-28 animate-pulse rounded-2xl bg-white/70" />
          <div className="h-10 w-3/4 animate-pulse rounded-lg bg-white/70" />
          <div className="visit-status-doctor-card h-24 animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="visit-status-screen">
        <VisitStatusHeader onBack={() => navigate("/dashboard")} />
        <div className="visit-status-content visit-status-content--padded flex flex-col items-center py-16 text-center">
          <h2 className="native-display text-[22px] text-[#1a5c52]">Unable to load visit status</h2>
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-[#5b7f8a]">{loadError}</p>
          <button
            type="button"
            onClick={() => setRetryToken((token) => token + 1)}
            className="request-wizard-primary-btn mt-8 w-full max-w-[280px]"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="visit-status-screen">
        <VisitStatusHeader onBack={() => navigate("/dashboard")} />
        <div className="visit-status-content visit-status-content--padded flex flex-col items-center py-16 text-center">
          <h2 className="native-display text-[22px] text-[#1a5c52]">No active visit right now.</h2>
          <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-[#5b7f8a]">
            When you request a home visit, you&apos;ll be able to track your doctor here.
          </p>
          <Link
            to="/dashboard"
            className="request-wizard-primary-btn mt-8 w-full max-w-[280px]"
          >
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const activeStepIndex = visitStatusToStepIndex(visit.status);
  const etaHeading = formatEtaHeading(visit);
  const showPrep =
    visit.status !== "arrived" && visit.status !== "in_consultation";
  const doctorName = visit.doctor_name || "Your doctor";

  return (
    <div className="visit-status-screen flex min-h-full flex-col">
      <VisitStatusHeader onBack={() => navigate("/dashboard")} />

      <div className="visit-status-content visit-status-content--padded flex flex-1 flex-col">
        {/* Hero progression bar */}
        <section className="visit-status-hero" aria-label="Visit progress tracker">
          <VisitProgressTracker activeStepIndex={activeStepIndex} />
        </section>

        {/* ETA headline */}
        <h2 className="visit-status-eta native-display text-[26px] leading-tight text-[#1a5c52] sm:text-[28px]">
          {etaHeading}
        </h2>

        {/* Doctor card */}
        <VisitDoctorCard doctorName={doctorName} />

        {/* Preparation checklist */}
        {showPrep ? (
          <article className="visit-status-prep-card">
            <h3 className="visit-status-prep-title">Before your doctor arrives</h3>
            <ul className="mt-4 space-y-3">
              {PREP_ITEMS.map((item) => (
                <li key={item} className="visit-status-prep-item flex items-start gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[#2d8f98]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        ) : null}
      </div>

      {/* Footer — subtle cancel action */}
      <footer className="visit-status-footer">
        <VisitCancelPrompt
          visitId={visit.id}
          visitStatus={visit.status}
          onCancelled={() => setVisit(null)}
          className="text-center"
          buttonClassName="text-[14px] font-medium text-[#a8b5b2] transition active:text-[#8a9e9a]"
        />
      </footer>
    </div>
  );
}

export default RequestVisitTracking;
