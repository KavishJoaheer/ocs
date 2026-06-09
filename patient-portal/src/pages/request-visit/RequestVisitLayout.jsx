import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { api } from "../../lib/api.js";
import { VISIT_DRAFT_KEY } from "../../components/request-visit/RequestDoctorSheet.jsx";

const INITIAL_DRAFT = {
  visitFor: "myself",
  address: "",
  reason: "",
  urgency: "routine",
  submittedAt: null,
};

function RequestVisitLayout() {
  const [draft, setDraft] = useState(INITIAL_DRAFT);

  const updateDraft = useCallback((patch) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    const storedDraft = sessionStorage.getItem(VISIT_DRAFT_KEY);
    if (storedDraft) {
      try {
        const parsed = JSON.parse(storedDraft);
        setDraft((current) => ({ ...current, ...parsed }));
      } catch {
        // Ignore malformed wizard handoff data.
      } finally {
        sessionStorage.removeItem(VISIT_DRAFT_KEY);
      }
    }
  }, []);

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
    return () => { ignore = true; };
  }, []);

  return <Outlet context={{ draft, updateDraft }} />;
}

export default RequestVisitLayout;
