import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { PATIENTS_LIVE_EVENT } from "../lib/inventorySync.js";
import { useLiveRefreshKey } from "./useLiveRefreshKey.js";

const VISIT_STATUSES = ["assigned", "en_route", "arrived", "in_consultation"];
const NEXT = { assigned: "en_route", en_route: "arrived", arrived: "in_consultation", in_consultation: "completed" };

export function useDoctorAssignedCare(doctorId, readOnly = false) {
  const [visits, setVisits] = useState([]);
  const [calls, setCalls] = useState([]);
  const [errors, setErrors] = useState({ visits: "", calls: "" });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const version = useRef(0);
  const busy = useRef(false);
  const refreshKey = useLiveRefreshKey();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    const current = ++version.current;
    const results = await Promise.allSettled([api.get("/visit-requests?status=active"), api.get("/teleconsultations")]);
    if (current !== version.current) return;
    const [visitResult, callResult] = results;
    const visitsValid = visitResult.status === "fulfilled" && Array.isArray(visitResult.value?.visit_requests);
    const callsValid = callResult.status === "fulfilled" && Array.isArray(callResult.value?.requests);
    if (visitsValid) setVisits(visitResult.value.visit_requests.filter(row => Number(row.assigned_doctor_id) === Number(doctorId) && VISIT_STATUSES.includes(row.status)));
    if (callsValid) setCalls(callResult.value.requests.filter(row => Number(row.assigned_doctor_id) === Number(doctorId) && ["assigned", "in_consultation"].includes(row.status)));
    setErrors({ visits: visitsValid ? "" : "Could not refresh home visits.", calls: callsValid ? "" : "Could not refresh teleconsultations." });
    setLoading(false);
  }, [doctorId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 15000);
    return () => { window.clearInterval(timer); version.current += 1; };
  }, [load, refreshKey]);

  async function advance(visit) {
    const status = NEXT[visit.status];
    const coverageBlocked = visit.insurance_coverage?.is_linkham && visit.insurance_coverage.allowed !== true && ["assigned", "en_route"].includes(visit.status);
    if (busy.current || readOnly || !status || coverageBlocked) return;
    busy.current = true;
    setBusyId(visit.id);
    try {
      const result = await api.patch(`/visit-requests/${visit.id}`, { status });
      version.current += 1;
      if (result.visit_request) setVisits(rows => rows.map(row => row.id === visit.id ? result.visit_request : row).filter(row => VISIT_STATUSES.includes(row.status)));
      window.dispatchEvent(new CustomEvent(PATIENTS_LIVE_EVENT));
      if (status === "completed" && result.follow_up?.patient_id) {
        toast.success("Visit completed. Add consultation notes.");
        navigate(result.follow_up.consultation_id ? `/consultations/${result.follow_up.consultation_id}` : `/patients/${result.follow_up.patient_id}?composeConsultation=1`);
      } else {
        toast.success("Visit updated.");
        await load();
      }
    } catch (error) {
      toast.error(error.message || "Could not update this visit. Please retry.");
      await load();
    } finally { busy.current = false; setBusyId(null); }
  }

  return { visits, calls, errors, loading, busyId, load, advance };
}
