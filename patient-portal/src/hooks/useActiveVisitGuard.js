import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { pickVisibleActiveVisit } from "../lib/visitRequests.js";

/**
 * Returns a function that checks for an active visit request and redirects to
 * tracking when one exists. Resolves to true when the caller should proceed.
 */
export function useActiveVisitGuard() {
  const navigate = useNavigate();

  return useCallback(async () => {
    try {
      const data = await api.get("/patient-portal/visit-requests/active");
      if (pickVisibleActiveVisit(data)) {
        navigate("/request-visit/tracking", { replace: true });
        return false;
      }
    } catch (error) {
      toast.error(
        error?.message || "Couldn't verify your visit status. Please try again in a moment.",
      );
      return false;
    }
    return true;
  }, [navigate]);
}
