import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useLiveRefreshKey } from "../../hooks/useLiveRefreshKey.js";
import { api } from "../../lib/api.js";
import { PATIENTS_LIVE_EVENT } from "../../lib/inventorySync.js";

const ACTIVE_STATUSES = ["pending", "assigned", "in_consultation"];

function requestStatus(request) {
  if (request.status === "pending") return request.accepted_at ? "Awaiting doctor assignment" : "Awaiting acceptance";
  return request.status === "assigned" ? "Doctor assigned" : "In consultation";
}

export default function OperatorTeleconsultationPanel({ readOnly = false, embedded = false }) {
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

  return (
    <section className={embedded ? "min-w-0 border-t border-slate-100 px-4 pb-1 pt-2" : "ocs-cc-panel min-w-0 px-5 py-4"} aria-labelledby="ocs-cc-teleconsultation-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ocs-cc-teleconsultation-heading" className={`flex items-center gap-2 font-semibold text-[#203f42] ${embedded ? "text-xs" : "font-display text-base"}`}>
            {!embedded ? <span className="ocs-cc-pulse" aria-hidden="true" /> : null}
            {embedded ? "Teleconsultations" : "Live teleconsultations"}
            {!loading && !error && requests.length > 0 ? <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600">{requests.length}</span> : null}
          </h2>
          {!embedded ? <p className="mt-0.5 text-xs text-[#5f7476]">Accept requests and follow ongoing calls</p> : null}
        </div>
        <Link to="/teleconsultations" aria-label={embedded ? "Manage teleconsultations" : undefined} className={`inline-flex min-h-11 items-center gap-1 font-semibold text-[#1a7f7a] hover:text-[#203f42] ${embedded ? "text-xs" : "text-sm"}`}>
          Manage calls <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
        </Link>
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}<button type="button" onClick={load} className="ml-2 min-h-11 font-semibold underline">Retry teleconsultations</button></p> : null}
      {loading ? <p role="status" className="mt-4 text-sm text-[#5f7476]">Loading teleconsultations…</p> : null}
      {!loading && !error && requests.length === 0 ? (
        <div className={embedded ? "pb-3" : "mt-4"}>
          <p className={embedded ? "text-xs text-slate-500" : "font-display text-base font-semibold text-[#203f42]"}>No active teleconsultations</p>
          {!embedded ? <p className="mt-1 text-sm leading-6 text-[#5f7476]">New requests from OCS Care will appear here automatically.</p> : null}
        </div>
      ) : null}
      {sorted.length > 0 ? (
        <ul className={`${embedded ? "" : "mt-3 "}max-h-72 divide-y divide-slate-100 overflow-y-auto overscroll-contain`}>
          {sorted.map(request => {
            const waiting = request.status === "pending" && !request.accepted_at;
            return (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-slate-800">{request.patient_name}</p>
                  <p className="mt-0.5 line-clamp-1 break-words text-xs text-slate-500">{request.reason}</p>
                  <p className={`mt-1 text-xs ${waiting ? "font-semibold text-amber-800" : "text-[#1a7f7a]"}`}>
                    {requestStatus(request)}{request.doctor_name ? ` · ${request.doctor_name}` : ""}
                  </p>
                </div>
                {waiting && !readOnly ? (
                  <button type="button" disabled={busyId !== null} onClick={() => accept(request)} aria-label={`Accept request for ${request.patient_name}`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-ocs-slate px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                    <Check className="size-3.5" aria-hidden="true" />{busyId === request.id ? "Accepting…" : "Accept"}
                  </button>
                ) : (
                  <Link to={`/teleconsultations?request=${request.id}`} aria-label={`Manage teleconsultation for ${request.patient_name}`} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-[#1a7f7a]">
                    Manage <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
