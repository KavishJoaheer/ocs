import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api.js";

/**
 * Returns a function that checks for an active visit request and redirects to
 * tracking when one exists. Resolves to true when the caller should proceed.
 */
export function useActiveVisitGuard() {
  const navigate = useNavigate();

  return useCallback(async () => {
    try {
      const data = await api.get("/patient-portal/visit-requests/active");
      if (data.visit_request) {
        navigate("/request-visit/tracking", { replace: true });
        return false;
      }
    } catch {
      // Non-blocking — allow the flow when status is unavailable.
    }
    return true;
  }, [navigate]);
}
