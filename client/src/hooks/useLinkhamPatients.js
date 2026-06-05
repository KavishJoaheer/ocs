import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "../lib/api.js";
import { LINKHAM_PATIENTS_EVENT } from "../lib/inventorySync.js";

export function useLinkhamPatients({ enabled = true } = {}) {
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setPatients([]);
      setError(null);
      setLoading(false);
      return [];
    }

    setLoading(true);
    setError(null);

    try {
      const data = await api.get("/linkham/patients");
      const rows = Array.isArray(data?.patients) ? data.patients : [];
      setPatients(rows);
      return rows;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not load Linkham insured clients.";
      setError(message);
      setPatients([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return undefined;
    }

    const handleRefresh = () => {
      void reload();
    };

    window.addEventListener(LINKHAM_PATIENTS_EVENT, handleRefresh);
    return () => window.removeEventListener(LINKHAM_PATIENTS_EVENT, handleRefresh);
  }, [enabled, reload]);

  return { patients, loading, error, reload };
}
