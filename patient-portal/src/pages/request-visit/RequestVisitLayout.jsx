import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { api } from "../../lib/api.js";

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
