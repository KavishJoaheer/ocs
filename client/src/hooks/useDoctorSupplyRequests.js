import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../lib/api.js";
import {
  fetchDoctorSupplyRequests,
  filterDisplayableSupplyRequests,
} from "../lib/supplyRequests.js";
import { SUPPLY_REQUESTS_EVENT } from "../lib/inventorySync.js";

export function useDoctorSupplyRequests({ enabled = true, refreshKey = 0 } = {}) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const displayableRequests = useMemo(
    () => filterDisplayableSupplyRequests(requests),
    [requests],
  );

  const dismissRequest = useCallback((requestId) => {
    const id = Number(requestId);
    if (!id) return;
    setRequests((current) => current.filter((row) => Number(row.id) !== id));
  }, []);

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

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return undefined;
    }

    const handleRefresh = () => {
      void reload();
    };

    window.addEventListener(SUPPLY_REQUESTS_EVENT, handleRefresh);
    return () => window.removeEventListener(SUPPLY_REQUESTS_EVENT, handleRefresh);
  }, [enabled, reload]);

  const pendingCount = requests.filter((row) => row.status === "pending").length;

  return {
    requests,
    displayableRequests,
    loading,
    error,
    pendingCount,
    reload,
    dismissRequest,
  };
}
