import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

const POLL_INTERVAL_MS = 60_000;

export function useOperatorDashboardMetrics(enabled) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));

  const refresh = useCallback(async () => {
    const data = await api.get("/v1/operator/dashboard-metrics");
    setMetrics(data);
    setLoading(false);
    return data;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setMetrics(null);
      setLoading(false);
      return undefined;
    }

    let ignore = false;
    setLoading(true);

    async function fetchMetrics() {
      try {
        const data = await api.get("/v1/operator/dashboard-metrics");
        if (!ignore) {
          setMetrics(data);
          setLoading(false);
        }
      } catch {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    fetchMetrics();
    const intervalId = window.setInterval(fetchMetrics, POLL_INTERVAL_MS);

    return () => {
      ignore = true;
      window.clearInterval(intervalId);
    };
  }, [enabled]);

  return { metrics, loading, refresh };
}
