import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, ClipboardList, Phone, Plus, RefreshCw, Search, Stethoscope } from "lucide-react";
import { api } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import RequestCard from "../components/teleconsultations/ClinicalRequestCard.jsx";
import DoctorTeleconsultations from "../components/teleconsultations/DoctorTeleconsultations.jsx";
import OperatorTeleconsultations from "../components/teleconsultations/OperatorTeleconsultations.jsx";

const ACTIVE = ["pending", "assigned", "in_consultation"];
const statuses = {
  pending: { label: "Awaiting assignment", color: "border-amber-200 bg-amber-50 text-amber-800" },
  assigned: { label: "Doctor assigned", color: "border-sky-200 bg-sky-50 text-sky-800" },
  in_consultation: { label: "In consultation", color: "border-teal-200 bg-teal-50 text-teal-800" },
  completed: { label: "Completed", color: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  cancelled: { label: "Cancelled", color: "border-slate-200 bg-slate-100 text-slate-600" },
  referred: { label: "In-person assessment", color: "border-orange-200 bg-orange-50 text-orange-800" },
};
const input = "w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-ocs-teal focus:ring-2 focus:ring-ocs-teal/15 disabled:cursor-not-allowed disabled:bg-slate-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ocs-slate px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ocs-slate/90 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-ocs-slate transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function matchesStatus(request, filter) {
  if (filter === "all") return true;
  if (filter === "active") return ACTIVE.includes(request.status);
  if (filter === "closed") return ["cancelled", "referred"].includes(request.status);
  return request.status === filter;
}

export default function TeleconsultationsPage() {
  const { user } = useAuth();
  return user.role === "operator" ? <OperatorTeleconsultations user={user} /> : user.role === "doctor" ? <DoctorTeleconsultations user={user} /> : <ClinicalTeleconsultationsPage user={user} />;
}

function ClinicalTeleconsultationsPage({ user }) {
  const [searchParams] = useSearchParams();
  const refreshKey = useLiveRefreshKey();
  const [requests, setRequests] = useState([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [doctorError, setDoctorError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [expandedId, setExpandedId] = useState(() => {
    const requestedId = Number(searchParams.get("request"));
    return Number.isSafeInteger(requestedId) && requestedId > 0 ? requestedId : undefined;
  });
  const loadVersion = useRef(0);
  const isDispatch = ["admin", "operator"].includes(user.role);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const response = await api.get("/teleconsultations");
      if (version === loadVersion.current) { setRequests(response.requests); setHasMoreHistory(Boolean(response.has_more_history)); setError(""); }
    } catch (err) { if (version === loadVersion.current) setError(err.message); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 15000);
    return () => { window.clearInterval(timer); loadVersion.current += 1; };
  }, [load, refreshKey]);

  const loadDoctors = useCallback(async () => {
    try { setDoctors((await api.get("/doctors")).filter(doctor => doctor.user_id && doctor.login_active)); setDoctorError(""); }
    catch (err) { setDoctorError(err.message); }
  }, []);
  useEffect(() => { if (isDispatch) void loadDoctors(); }, [isDispatch, loadDoctors]);

  const search = query.trim().toLowerCase();
  const visible = requests.filter(request => matchesStatus(request, filter) && (!search || [request.patient_name, request.patient_identifier, request.callback_number, request.doctor_name, request.reason].some(value => String(value || "").toLowerCase().includes(search))));
  const visibleIds = new Set(visible.map(request => request.id));
  const openId = expandedId === undefined ? visible[0]?.id : expandedId;
  const counts = Object.fromEntries(Object.keys(statuses).map(status => [status, requests.filter(request => request.status === status).length]));
  const metrics = isDispatch ? [
    { label: "Awaiting assignment", value: counts.pending, icon: ClipboardList, color: "bg-amber-50 text-amber-700" },
    { label: "Ready to call", value: counts.assigned, icon: Phone, color: "bg-sky-50 text-sky-700" },
    { label: "In consultation", value: counts.in_consultation, icon: Stethoscope, color: "bg-teal-50 text-teal-700" },
  ] : [
    { label: "Ready to call", value: counts.assigned, icon: Phone, color: "bg-sky-50 text-sky-700" },
    { label: "In consultation", value: counts.in_consultation, icon: Stethoscope, color: "bg-teal-50 text-teal-700" },
    { label: "Completed", value: counts.completed, icon: CheckCircle2, color: "bg-emerald-50 text-emerald-700" },
  ];

  function onUpdated(updated) {
    setRequests(current => current.map(request => request.id === updated.id ? updated : request));
    setExpandedId(updated.id);
    setFilter(current => matchesStatus(updated, current) ? current : updated.status === "completed" ? "completed" : ACTIVE.includes(updated.status) ? "active" : "closed");
    void load();
  }

  async function refresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  return <div className="ocs-page mx-auto max-w-6xl space-y-5 p-4 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-ocs-teal">OCS remote care</p><h1 className="mt-1 text-2xl font-bold text-ocs-slate sm:text-3xl">Manage teleconsultations</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">{isDispatch ? "Assign doctors, track requests and keep each consultation moving." : "Review your assigned patients, begin the call and complete the consultation record."}</p></div>
      <div className="flex flex-wrap gap-2"><button type="button" onClick={refresh} disabled={refreshing || loading} className={secondary}><RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} />Refresh</button>{isDispatch && <Link to="/patients/add" className={primary}><Plus className="size-4" />Add patient</Link>}</div>
    </div>

    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      {metrics.map(({ label, value, icon: Icon, color }) => <div key={label} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-2xl font-bold text-ocs-slate">{loading || (error && !requests.length) ? "—" : value}</p><span className={`hidden rounded-xl p-2 sm:inline-flex ${color}`}><Icon className="size-4" /></span></div><p className="mt-1 text-xs leading-relaxed text-slate-500 sm:text-sm">{label}</p></div>)}
    </div>

    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[1fr_220px]">
      <label className="relative block min-w-0"><span className="sr-only">Search teleconsultations</span><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 size-4 text-slate-400" /><input type="search" value={query} onChange={event => { setQuery(event.target.value); setExpandedId(undefined); }} placeholder="Search patient, mobile or reason" className={`${input} pl-9`} /></label>
      <label className="block"><span className="sr-only">Filter by status</span><select value={filter} onChange={event => { setFilter(event.target.value); setExpandedId(undefined); }} className={input}><option value="active">Active requests</option><option value="pending">Awaiting assignment</option><option value="assigned">Ready to call</option><option value="in_consultation">In consultation</option><option value="completed">Completed</option><option value="closed">Cancelled / referred</option><option value="all">All requests</option></select></label>
    </div>

    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}<button onClick={load} type="button" className="ml-3 font-semibold underline">Retry</button></p>}
    {doctorError && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Doctor list unavailable: {doctorError}<button onClick={loadDoctors} type="button" className="ml-3 font-semibold underline">Retry doctor list</button></p>}
    {loading ? <p role="status" className="rounded-2xl bg-white p-6 text-sm text-slate-500">Loading requests…</p> : <>
      {(!error || requests.length > 0) && <p role="status" className="text-xs text-slate-500">{visible.length} {visible.length === 1 ? "request" : "requests"}{hasMoreHistory ? " · All active requests and the latest 100 closed requests" : ""} · Updates automatically</p>}
      {!visible.length && !error && <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center"><ClipboardList className="mx-auto size-8 text-slate-300" /><h2 className="mt-3 font-semibold text-ocs-slate">{query || filter !== "active" ? "No matching requests" : "No active teleconsultations"}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">{query ? "Try another patient name, mobile number or consultation reason." : filter === "active" ? isDispatch ? "Open a patient profile to send an OCS Care link. Requests appear here after the patient accepts consent." : "New teleconsultations will appear here when they are assigned to you." : "Choose a different status to see other consultations."}</p>{(query || filter !== "all") && <button type="button" onClick={() => { setQuery(""); setFilter("all"); setExpandedId(undefined); }} className={`${secondary} mt-4`}>View all requests</button>}</div>}
      <div className="space-y-4">
        {/* Keep cards mounted so filtering, folding and live refresh preserve entered notes. */}
        {requests.map(request => <RequestCard key={request.id} request={request} user={user} doctors={doctors} visible={visibleIds.has(request.id)} expanded={request.id === openId} onToggle={() => setExpandedId(request.id === openId ? null : request.id)} onOpen={() => setExpandedId(request.id)} onUpdated={onUpdated} />)}
      </div>
    </>}
  </div>;
}
