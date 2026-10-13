import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, Check, Clock3 } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { PATIENTS_LIVE_EVENT } from "../lib/inventorySync.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";

export default function TeleconsultationAlerts() {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const version = useRef(0);
  const refreshKey = useLiveRefreshKey();
  const load = useCallback(async () => {
    const current = ++version.current;
    try {
      const data = await api.get("/teleconsultations/unaccepted");
      if (!Array.isArray(data.requests)) throw new Error("Invalid request alert response");
      if (current === version.current) { setRequests(data.requests); setError(""); }
    } catch {
      if (current === version.current) setError("Could not refresh teleconsultation alerts. Please retry.");
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 10000);
    return () => { window.clearInterval(timer); version.current += 1; };
  }, [load, refreshKey]);

  async function accept(request) {
    if (busyId !== null) return;
    setBusyId(request.id);
    try {
      await api.post(`/teleconsultations/${request.id}/accept`, {});
      version.current += 1;
      setRequests(current => current.filter(row => row.id !== request.id));
      window.dispatchEvent(new CustomEvent(PATIENTS_LIVE_EVENT));
      toast.success("Request accepted. Assign a doctor in Manage teleconsultations.");
      await load();
    } catch (err) {
      toast.error(err.message || "Could not accept this request. Please retry.");
      // A different operator may have accepted it, or the patient may have cancelled.
      if (err.status === 409 || err.status === 404) await load();
    } finally { setBusyId(null); }
  }

  if (!requests.length && !error) return null;
  return <aside aria-label="Teleconsultation request alerts" className="mb-5 overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 shadow-sm">
    <div className="flex items-start gap-3 p-4">
      <span className="shrink-0 rounded-xl bg-amber-100 p-2 text-amber-800"><BellRing className="size-5" /></span>
      <div className="min-w-0"><p role="status" className="text-sm font-bold text-amber-950">{requests.length ? `${requests.length} teleconsultation ${requests.length === 1 ? "request needs" : "requests need"} acceptance` : "Teleconsultation alerts unavailable"}</p><p className="mt-1 text-xs leading-relaxed text-amber-900">Each request stays here until accepted by an operator, or cancelled.</p></div>
    </div>
    {error && <p role="alert" className="px-4 pb-3 text-sm text-red-800">{error}<button type="button" onClick={load} className="ml-2 min-h-11 font-semibold underline">Retry alerts</button></p>}
    <ul className="max-h-72 divide-y divide-amber-200 overflow-y-auto overscroll-contain">
      {requests.map(request => <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 bg-white/70 px-4 py-3">
        <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold text-ocs-slate">{request.patient_name}</p><p className="mt-1 line-clamp-2 break-words text-xs text-slate-600">{request.reason}</p><p className="mt-1 flex items-center gap-1 text-xs text-amber-800"><Clock3 className="size-3" />Awaiting operator acceptance</p></div>
        <button type="button" disabled={busyId !== null} onClick={() => accept(request)} aria-label={`Accept request for ${request.patient_name}`} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-ocs-slate px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Check className="size-4" />{busyId === request.id ? "Accepting…" : "Accept"}</button>
      </li>)}
    </ul>
    <Link to="/teleconsultations" className="flex min-h-11 items-center px-4 py-3 text-sm font-semibold text-amber-950 underline">Open Manage teleconsultations</Link>
  </aside>;
}
