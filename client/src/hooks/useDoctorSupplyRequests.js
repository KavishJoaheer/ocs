import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/api.js";
import { fetchDoctorSupplyRequests } from "../lib/supplyRequests.js";

export function useDoctorSupplyRequests({ enabled = true, refreshKey = 0 } = {}) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setRequests([]);
      setError(null);
      return [];
    }

    setLoading(true);
    setError(null);
    try {
      const rows = await fetchDoctorSupplyRequests();
      setRequests(rows);
      return rows;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not load your supply requests.";
      setError(message);
      setRequests([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const pendingCount = requests.filter((row) => row.status === "pending").length;

  return {
    requests,
    loading,
    error,
    pendingCount,
    reload,
  };
}
