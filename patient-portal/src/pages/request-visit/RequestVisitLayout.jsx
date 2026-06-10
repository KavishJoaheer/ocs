import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../../lib/api.js";
import { useLiveRefreshKey } from "../../hooks/useLiveRefreshKey.js";
import { usePatientAuth } from "../../hooks/usePatientAuth.jsx";
import {
  INITIAL_DRAFT,
  clearVisitDraft,
  getVisitDraftStorageKey,
  readVisitDraft,
  writeVisitDraft,
} from "../../lib/visitDraftStorage.js";

function RequestVisitLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = usePatientAuth();
  const refreshKey = useLiveRefreshKey();
  const storageKey = getVisitDraftStorageKey(user);

  const [draft, setDraft] = useState(() => {
    const handoff = location.state?.wizardDraft;
    return handoff ? { ...INITIAL_DRAFT, ...handoff } : readVisitDraft(storageKey);
  });

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
    const isRequestForm =
      location.pathname === "/request-visit" || location.pathname === "/request-visit/";
    if (!isRequestForm || location.state?.wizardDraft) return undefined;

    let ignore = false;

    async function guardActiveVisit() {
      try {
        const data = await api.get("/patient-portal/visit-requests/active");
        if (!ignore && data.visit_request) {
          navigate("/request-visit/tracking", { replace: true });
        }
      } catch {
        // Non-blocking — allow request flow when status is unavailable.
      }
    }

    guardActiveVisit();
    return () => {
      ignore = true;
    };
  }, [location.pathname, location.state?.wizardDraft, navigate]);

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

  return <Outlet context={{ draft, updateDraft, resetDraft, storageKey }} />;
}

export default RequestVisitLayout;
