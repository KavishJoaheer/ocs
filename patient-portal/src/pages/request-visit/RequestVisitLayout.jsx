import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api.js";
import { useLiveRefreshKey } from "../../hooks/useLiveRefreshKey.js";
import { usePatientAuth } from "../../hooks/usePatientAuth.jsx";
import { getPatientLinkBlockMessage, isPatientAccountLinked } from "../../lib/patientAccountLink.js";
import {
  INITIAL_DRAFT,
  clearVisitDraft,
  getVisitDraftStorageKey,
  readVisitDraft,
  writeVisitDraft,
} from "../../lib/visitDraftStorage.js";

function VisitGuardErrorState({ message, onRetry, retryLabel = "Try Again" }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
      <h2 className="native-display text-[22px] text-brand-dark-grey">Can&apos;t start a new visit right now</h2>
      <p className="mt-3 max-w-xs text-[14px] leading-relaxed text-brand-cool-grey">{message}</p>
      <button type="button" onClick={onRetry} className="request-wizard-primary-btn mt-8 w-full max-w-[280px]">
        {retryLabel}
      </button>
    </div>
  );
}

function RequestVisitLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = usePatientAuth();
  const refreshKey = useLiveRefreshKey();
  const storageKey = getVisitDraftStorageKey(user);
  const isRequestForm =
    location.pathname === "/request-visit" || location.pathname === "/request-visit/";
  const shouldGuardVisit = isRequestForm && !location.state?.wizardDraft;

  const [draft, setDraft] = useState(() => {
    const handoff = location.state?.wizardDraft;
    return handoff ? { ...INITIAL_DRAFT, ...handoff } : readVisitDraft(storageKey);
  });
  const [visitGuardChecking, setVisitGuardChecking] = useState(shouldGuardVisit);
  const [visitGuardError, setVisitGuardError] = useState(null);
  const [visitGuardRetryToken, setVisitGuardRetryToken] = useState(0);

  const updateDraft = useCallback((patch) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const resetDraft = useCallback(() => {
    setDraft({ ...INITIAL_DRAFT });
    clearVisitDraft(storageKey);
  }, [storageKey]);

  useEffect(() => {
    writeVisitDraft(storageKey, draft);
  }, [draft, storageKey]);

  useEffect(() => {
    if (location.state?.wizardDraft) return;
    setDraft(readVisitDraft(storageKey));
  }, [storageKey, location.state?.wizardDraft]);

  useEffect(() => {
    if (location.state?.wizardDraft) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (
      (location.pathname === "/request-visit" || location.pathname === "/request-visit/") &&
      draft.submittedAt
    ) {
      resetDraft();
    }
  }, [location.pathname, draft.submittedAt, resetDraft]);

  useEffect(() => {
    if (!shouldGuardVisit) {
      setVisitGuardChecking(false);
      setVisitGuardError(null);
      return undefined;
    }

    let ignore = false;
    setVisitGuardChecking(true);
    setVisitGuardError(null);

    async function guardActiveVisit() {
      try {
        const data = await api.get("/patient-portal/visit-requests/active");
        if (!ignore && data.visit_request) {
          navigate("/request-visit/tracking", { replace: true });
          return;
        }
        if (!ignore) {
          setVisitGuardChecking(false);
        }
      } catch (error) {
        if (!ignore) {
          setVisitGuardError(
            error?.message || "We couldn't verify whether you already have an active visit. Please try again.",
          );
          setVisitGuardChecking(false);
        }
      }
    }

    guardActiveVisit();
    return () => {
      ignore = true;
    };
  }, [shouldGuardVisit, navigate, visitGuardRetryToken]);

  useEffect(() => {
    let ignore = false;

    async function loadAddress() {
      try {
        const data = await api.get("/patient-portal/profile");
        const address = data.profile?.address || data.address || "";
        if (!ignore && address) {
          setDraft((current) => (current.address ? current : { ...current, address }));
        }
      } catch {
        // Non-blocking — the patient can still type an address.
      }
    }

    loadAddress();
    return () => {
      ignore = true;
    };
  }, [refreshKey]);

  if (!isPatientAccountLinked(user)) {
    return (
      <VisitGuardErrorState
        message={getPatientLinkBlockMessage(user)}
        retryLabel="Back to Dashboard"
        onRetry={() => navigate("/dashboard", { replace: true })}
      />
    );
  }

  if (shouldGuardVisit && visitGuardChecking) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <span className="size-8 animate-spin rounded-full border-2 border-brand-teal/20 border-t-brand-teal" />
      </div>
    );
  }

  if (shouldGuardVisit && visitGuardError) {
    return (
      <VisitGuardErrorState
        message={visitGuardError}
        onRetry={() => setVisitGuardRetryToken((token) => token + 1)}
      />
    );
  }

  return <Outlet context={{ draft, updateDraft, resetDraft, storageKey }} />;
}

export default RequestVisitLayout;
