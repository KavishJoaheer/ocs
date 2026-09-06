import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError } from "../lib/api.js";
import {
  fetchDoctorSupplyRequests,
  fetchSupplyRequestHistory,
  filterDisplayableSupplyRequests,
  isActiveSupplyRequestStatus,
} from "../lib/supplyRequests.js";
import { SUPPLY_REQUESTS_EVENT } from "../lib/inventorySync.js";

const FALLBACK_POLL_MS = 30000;

export function useDoctorSupplyRequests({
  enabled = true,
  refreshKey = 0,
  includeHistory = false,
  historyParams = null,
} = {}) {
  const [requests, setRequests] = useState([]);
  const [history, setHistory] = useState({
    requests: [],
    total: 0,
    doctor_counts: [],
    item_counts: [],
    completed_count: 0,
    cancelled_count: 0,
    request_count: 0,
  });
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const historyQueryKey = JSON.stringify(historyParams || {});

  const displayableRequests = useMemo(
    () => filterDisplayableSupplyRequests(requests),
    [requests],
  );

  const dismissRequest = useCallback((requestId) => {
    const id = Number(requestId);
    if (!id) return;
    setRequests((current) => current.filter((row) => Number(row.id) !== id));
  }, []);

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!enabled) {
      setRequests([]);
      setError(null);
      return [];
    }

    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }, [enabled]);

  const reloadHistory = useCallback(async () => {
    if (!enabled || !includeHistory) {
      return null;
    }

    const params = historyQueryKey === "{}" ? {} : JSON.parse(historyQueryKey);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const payload = await fetchSupplyRequestHistory(params);
      setHistory(payload);
      return payload;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not load supply request history.";
      setHistoryError(message);
      setHistory({ requests: [], total: 0, doctor_counts: [], item_counts: [], completed_count: 0, cancelled_count: 0, request_count: 0 });
      return null;
    } finally {
      setHistoryLoading(false);
    }
  }, [enabled, includeHistory, historyQueryKey]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  useEffect(() => {
    void reloadHistory();
  }, [reloadHistory, refreshKey]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      return undefined;
    }

    const handleRefresh = () => {
      void reload({ silent: true });
      void reloadHistory();
    };

    window.addEventListener(SUPPLY_REQUESTS_EVENT, handleRefresh);
    const timer = window.setInterval(handleRefresh, FALLBACK_POLL_MS);
    return () => {
      window.removeEventListener(SUPPLY_REQUESTS_EVENT, handleRefresh);
      window.clearInterval(timer);
    };
  }, [enabled, reload, reloadHistory]);

  const pendingCount = requests.filter(
    (row) => String(row.status || "").toLowerCase() === "pending",
  ).length;
  const activeCount = requests.filter((row) => isActiveSupplyRequestStatus(row.status)).length;

  return {
    requests,
    displayableRequests,
    historyRequests: history.requests,
    historyTotal: history.total,
    historyDoctorCounts: history.doctor_counts,
    historyItemCounts: history.item_counts,
    historyCompletedCount: history.completed_count,
    historyCancelledCount: history.cancelled_count,
    historyRequestCount: history.request_count,
    loading,
    historyLoading,
    error,
    historyError,
    pendingCount,
    activeCount,
    reload,
    reloadHistory,
    dismissRequest,
  };
}
