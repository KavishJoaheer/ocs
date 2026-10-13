import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { useLiveRefreshKey } from "./useLiveRefreshKey.js";
import { api } from "../lib/api.js";
import { PATIENTS_LIVE_EVENT } from "../lib/inventorySync.js";

const ACTIVE_STATUSES = ["pending", "assigned", "in_consultation"];

export function useOperatorTeleconsultations({ readOnly = false } = {}) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const version = useRef(0);
  const refreshKey = useLiveRefreshKey();

  const load = useCallback(async () => {
    const current = ++version.current;
    try {
      const response = await api.get("/teleconsultations");
      if (!Array.isArray(response.requests)) throw new Error("Invalid request response");
      if (current === version.current) {
        setRequests(response.requests.filter(request => ACTIVE_STATUSES.includes(request.status)));
        setError("");
      }
    } catch {
      if (current === version.current) setError("Could not refresh teleconsultations. Please retry.");
    } finally {
      if (current === version.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 10000);
    return () => { window.clearInterval(timer); version.current += 1; };
  }, [load, refreshKey]);

  async function accept(request) {
    if (readOnly || busyId !== null) return;
    setBusyId(request.id);
    try {
      const response = await api.post(`/teleconsultations/${request.id}/accept`, {});
      version.current += 1;
      setRequests(current => current.map(row => row.id === request.id ? response.request : row));
      window.dispatchEvent(new CustomEvent(PATIENTS_LIVE_EVENT));
      toast.success("Request accepted. You can now assign a doctor.");
      await load();
    } catch (err) {
      toast.error(err.message || "Could not accept this request. Please retry.");
      if (err.status === 409 || err.status === 404) await load();
    } finally { setBusyId(null); }
  }

  const sorted = [...requests].sort((left, right) => {
    const leftWaiting = left.status === "pending" && !left.accepted_at;
    const rightWaiting = right.status === "pending" && !right.accepted_at;
    return Number(rightWaiting) - Number(leftWaiting) || left.id - right.id;
  });

  return { requests: sorted, loading, error, busyId, load, accept };
}

export function teleconsultationRequestStatus(request) {
  if (request.status === "pending") return request.accepted_at ? "Awaiting doctor assignment" : "Awaiting acceptance";
  return request.status === "assigned" ? "Doctor assigned" : "In consultation";
}
