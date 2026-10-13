import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, ChevronDown, ChevronRight, Clock3, MapPin, Phone, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/api.js";
import { cx } from "../../lib/utils.js";
import { PATIENTS_LIVE_EVENT } from "../../lib/inventorySync.js";
import { setUnsavedWork } from "../../lib/unsavedWork.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { useLiveRefreshKey } from "../../hooks/useLiveRefreshKey.js";
import Modal from "../Modal.jsx";
import LoadingState from "../LoadingState.jsx";
import EmptyState from "../EmptyState.jsx";
import AppUpdateBanner from "../AppUpdateBanner.jsx";
import PushNotificationBanner from "../PushNotificationBanner.jsx";
import "./operatorTeleconsultations.css";

const ACTIVE = ["pending", "assigned", "in_consultation"];
const pill = "inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-full border border-[#d5e4e1] bg-white px-4 py-2 text-sm font-semibold text-[#376168] transition hover:bg-[#edf9f7] disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#137b80] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#106b70] disabled:cursor-not-allowed disabled:opacity-50";
const field = "min-h-11 w-full min-w-0 rounded-2xl border border-[#cde2de] bg-white px-3 py-2 text-base text-[#173f4a] outline-none focus:border-[#137b80] disabled:opacity-50";
const labels = { assigned: "Doctor assigned", in_consultation: "In consultation", completed: "Completed", cancelled: "Cancelled", referred: "In-person assessment" };

function requestStatus(request) {
  return request.status === "pending" ? request.accepted_at ? "Awaiting doctor" : "Awaiting acceptance" : labels[request.status] || request.status;
}
function requestView(request) {
  return request.status === "pending" ? "attention" : ACTIVE.includes(request.status) ? "progress" : "history";
}
function timestamp(value) {
  const text = String(value || "");
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text.replace(" ", "T")}Z`) || 0;
}
function formatTime(value) {
  return timestamp(value) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Indian/Mauritius", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp(value))) : "Time unavailable";
}
function initials(name) { return String(name || "Patient").trim().split(/\s+/).filter(Boolean).map(part => part[0]).filter((_, index, parts) => index === 0 || index === parts.length - 1).join("").toUpperCase(); }
function StatusBadge({ request }) {
  const tone = request.status === "pending" ? "bg-amber-100 text-amber-900" : request.status === "assigned" ? "bg-sky-50 text-sky-800" : request.status === "in_consultation" ? "bg-[#def7ef] text-[#137b80]" : "bg-slate-100 text-slate-600";
  return <span className={cx("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", tone)}>{requestStatus(request)}</span>;
}
function RequestAge({ request, now }) {
  if (!timestamp(request.created_at)) return <span className="text-xs text-[#5b7379]">Time unavailable</span>;
  if (!ACTIVE.includes(request.status)) return <span className="text-xs text-[#5b7379]">{formatTime(request.created_at)}</span>;
  const minutes = Math.max(0, Math.floor((now - timestamp(request.created_at)) / 60000));
  const label = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
  return <span title="Time since the patient requested this consultation" aria-label={`Requested ${label} ago`} className={cx("inline-flex shrink-0 items-center gap-1.5 text-xs", request.status === "pending" && minutes >= 30 ? "text-amber-800" : "text-[#5b7379]")}><Clock3 className="size-3.5" aria-hidden="true" />{label}</span>;
}

function RequestDetails({ request, user, doctors, doctorError, retryDoctors, busyId, error, onAction, onDirtyChange, guard, now, drafts }) {
  const navigate = useNavigate();
  const [doctorId, setDoctorId] = useState(() => drafts.current.get(request.id)?.doctorId ?? null);
  const [reason, setReason] = useState(() => drafts.current.get(request.id)?.reason || "");
  const [nextStep, setNextStep] = useState(() => drafts.current.get(request.id)?.nextStep || "");
  const errorRef = useRef(null);
  const active = ACTIVE.includes(request.status);
  const dirty = active && (doctorId !== null && doctorId !== String(request.assigned_doctor_id || "") || Boolean(reason || nextStep));
  const disabled = busyId !== null || user.is_read_only;
  const assignable = request.accepted_at && ["pending", "assigned"].includes(request.status);
  useEffect(() => {
    if (dirty) drafts.current.set(request.id, { doctorId, reason, nextStep });
    else drafts.current.delete(request.id);
  }, [dirty, doctorId, reason, nextStep, drafts, request.id]);
  useEffect(() => {
    onDirtyChange(dirty);
    setUnsavedWork(`teleconsultation-${request.id}`, dirty);
    return () => { onDirtyChange(false); setUnsavedWork(`teleconsultation-${request.id}`, false); };
  }, [dirty, onDirtyChange, request.id]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  return <div className="space-y-5 text-[#173f4a]">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#dff3ef] text-sm font-bold text-[#137b80]">{initials(request.patient_name)}</span>
      <div className="min-w-0 flex-1">
        <Link to={`/patients/${request.patient_id}`} onClick={event => { event.preventDefault(); guard(() => navigate(`/patients/${request.patient_id}`)); }} className="break-words text-lg font-bold hover:underline">{request.patient_name}</Link>
        <div className="mt-2 flex flex-wrap gap-2"><StatusBadge request={request} /><RequestAge request={request} now={now} /></div>
      </div>
    </div>
    <dl className="space-y-4 text-sm">
      <div><dt className="text-xs font-medium text-[#137b80]">Reason</dt><dd className="mt-1 whitespace-pre-wrap break-words">{request.reason || "No reason provided"}</dd></div>
      <div><dt className="text-xs font-medium text-[#137b80]">Current location</dt><dd className="mt-1 flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span className="break-words">{request.current_location || "Not provided"}</span></dd></div>
      <div><dt className="text-xs font-medium text-[#137b80]">Confirmed mobile</dt><dd className="mt-1 flex flex-wrap items-center justify-between gap-2"><span>+{request.callback_number}</span><a className={pill} href={`tel:+${request.callback_number}`} aria-label={`Call ${request.patient_name}`}><Phone className="size-4" aria-hidden="true" />Call patient</a></dd></div>
      {request.doctor_name ? <div><dt className="text-xs font-medium text-[#137b80]">Doctor</dt><dd className="mt-1 break-words">{request.doctor_name}</dd></div> : null}
    </dl>
    <details className="text-xs text-[#5b7379]"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-medium text-emerald-800 [&::-webkit-details-marker]:hidden"><Check className="size-4" aria-hidden="true" />Patient consent accepted<ChevronDown className="ml-auto size-4" aria-hidden="true" /></summary><p className="mt-2">{formatTime(request.consented_at)} · Mauritius time · Version {request.consent_version}</p></details>
    {active && request.consultation_code ? <p className="inline-flex flex-wrap items-center gap-2 rounded-full bg-[#edf6f3] px-3 py-2 text-xs text-[#376168]">Consultation code <strong className="tracking-widest">{request.consultation_code}</strong></p> : null}
    {error ? <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-2xl bg-rose-50 p-3 text-sm text-red-800 outline-none">{error}</p> : null}
    {request.status === "pending" && !request.accepted_at ? <div className="border-t border-[#e3eeeb] pt-4"><button type="button" className={`${primary} w-full`} disabled={disabled} onClick={() => onAction(request, "accept", {})}>{busyId === request.id ? "Accepting…" : "Accept request"}</button><p className="mt-2 text-xs text-[#5b7379]">Accept this request before assigning a doctor.</p></div> : null}
    {assignable ? <form onSubmit={async event => { event.preventDefault(); if (await onAction(request, "assign", { doctor_id: Number(doctorId ?? request.assigned_doctor_id) })) setDoctorId(null); }}>
      <fieldset disabled={disabled} className="min-w-0 space-y-3 border-t border-[#e3eeeb] pt-4">
        <legend className="sr-only">Assign a doctor</legend>
        <label htmlFor={`tele-doctor-${request.id}`} className="block text-sm font-semibold">{request.status === "assigned" ? "Doctor assignment" : "Assign doctor"}</label>
        <select id={`tele-doctor-${request.id}`} aria-label="Assign doctor" required className={field} value={doctorId ?? String(request.assigned_doctor_id || "")} onChange={event => setDoctorId(event.target.value)}>
          <option value="">Choose a doctor</option>
          {request.assigned_doctor_id && !doctors.some(doctor => Number(doctor.id) === Number(request.assigned_doctor_id)) ? <option value={request.assigned_doctor_id}>{request.doctor_name || "Current doctor"}</option> : null}
          {doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>)}
        </select>
        {doctorError ? <p role="alert" className="text-xs text-red-800">Doctor list unavailable: {doctorError} <button type="button" onClick={retryDoctors} className="min-h-11 font-semibold underline">Retry doctor list</button></p> : null}
        <button type="submit" className={`${primary} w-full`} disabled={disabled || !Number(doctorId ?? request.assigned_doctor_id) || request.status === "assigned" && (doctorId === null || doctorId === String(request.assigned_doctor_id))}>{busyId === request.id ? "Assigning…" : request.status === "assigned" ? "Update assignment" : "Assign doctor"}</button>
      </fieldset>
    </form> : null}
    {request.accepted_at ? <p className="text-xs text-[#5b7379]">Accepted by {request.accepted_by_name || "OCS dispatch"} · {formatTime(request.accepted_at)}</p> : null}
    {active ? <details className="group border-t border-[#e3eeeb] pt-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">More actions<ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden="true" /></summary>
      <form className="space-y-3 pt-3" onSubmit={async event => { event.preventDefault(); if (await onAction(request, "close", { outcome: "cancelled", outcome_note: reason, follow_up: nextStep })) { setReason(""); setNextStep(""); } }}>
        <fieldset disabled={disabled} className="min-w-0 space-y-3">
          <div><label htmlFor={`tele-outcome-${request.id}`} className="block text-xs font-semibold">Patient-facing reason</label><textarea id={`tele-outcome-${request.id}`} required maxLength={2000} rows={2} value={reason} onChange={event => setReason(event.target.value)} className={`${field} mt-1.5 resize-y`} /></div>
          <label className="block text-xs font-semibold">Next step for patient<input required maxLength={2000} value={nextStep} onChange={event => setNextStep(event.target.value)} className={`${field} mt-1.5`} /></label>
          <button type="submit" disabled={disabled || !reason.trim() || !nextStep.trim()} className={`${pill} border-rose-200 text-rose-800`}>{busyId === request.id ? "Closing…" : "Cancel request"}</button>
        </fieldset>
      </form>
    </details> : <div className="space-y-3 border-t border-[#e3eeeb] pt-4 text-sm">
      {request.record_withdrawn ? <p className="rounded-2xl bg-amber-50 p-3 text-amber-900">This consultation record has been voided. It is no longer shared in OCS Care.</p> : null}
      {request.status === "completed" ? <p className="font-medium text-emerald-800">Consultation saved to the patient record.</p> : null}
      {request.patient_summary ? <div><p className="text-xs font-semibold text-[#137b80]">Patient care summary</p><p className="mt-1 whitespace-pre-wrap break-words">{request.patient_summary}</p></div> : null}
      {request.outcome_note ? <p className="whitespace-pre-wrap break-words">{request.outcome_note}</p> : null}
      {request.follow_up ? <p className="whitespace-pre-wrap break-words"><strong>Next steps: </strong>{request.follow_up}</p> : null}
      {request.consultation_id ? <Link to={`/consultations/${request.consultation_id}`} className={pill}>Open saved consultation</Link> : null}
    </div>}
    <p className="border-t border-[#e3eeeb] pt-3 text-xs text-[#5b7379]">{request.patient_identifier} · Request #{request.id} · {formatTime(request.created_at)}</p>
  </div>;
}

export default function OperatorTeleconsultations({ user }) {
  const compact = useIsMobile(1024);
  const refreshKey = useLiveRefreshKey();
  const [searchParams] = useSearchParams();
  const deepId = Number(searchParams.get("request")) || null;
  const handledDeepId = useRef(null);
  const [requests, setRequests] = useState([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState("");
  const [doctors, setDoctors] = useState([]);
  const [doctorError, setDoctorError] = useState("");
  const [view, setView] = useState("attention");
  const [stage, setStage] = useState("all");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  const [confirmAction, setConfirmAction] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [actionErrors, setActionErrors] = useState({});
  const [now, setNow] = useState(Date.now);
  const version = useRef(0);
  const busy = useRef(false);
  const drafts = useRef(new Map());
  const load = useCallback(async () => {
    const current = ++version.current;
    setRefreshing(true);
    try {
      const data = await api.get("/teleconsultations");
      if (!Array.isArray(data.requests)) throw new Error("Invalid request response.");
      if (current === version.current) { setRequests(data.requests); setHasMoreHistory(Boolean(data.has_more_history)); setLastUpdated(Date.now()); setError(""); }
    } catch (failure) { if (current === version.current) setError(failure.message || "Could not load teleconsultations."); }
    finally { if (current === version.current) { setLoading(false); setRefreshing(false); } }
  }, []);
  const loadDoctors = useCallback(async () => {
    try { const data = await api.get("/doctors"); setDoctors(data.filter(doctor => doctor.user_id && doctor.login_active && doctor.is_active !== 0)); setDoctorError(""); }
    catch (failure) { setDoctorError(failure.message || "Could not load doctors."); }
  }, []);
  useEffect(() => {
    void load(); void loadDoctors();
    const poll = window.setInterval(load, 10000);
    const tick = window.setInterval(() => setNow(Date.now()), 15000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); version.current += 1; };
  }, [load, loadDoctors]);
  useEffect(() => { if (refreshKey > 0) void load(); }, [load, refreshKey]);

  function guard(action) { if (busy.current) return; if (dirty) setConfirmAction(() => action); else action(); }
  useEffect(() => {
    if (!deepId || handledDeepId.current === deepId) return;
    const request = requests.find(row => row.id === deepId);
    if (!request) return;
    handledDeepId.current = deepId;
    const open = () => { setSelectedId(deepId); setView(requestView(request)); setStage("all"); setQuery(""); setSheetOpen(true); };
    if (dirty) setConfirmAction(() => open); else open();
  }, [deepId, requests, dirty]);

  const counts = { attention: requests.filter(row => requestView(row) === "attention").length, progress: requests.filter(row => requestView(row) === "progress").length };
  const search = query.trim().toLowerCase();
  const visible = requests.filter(row => requestView(row) === view
    && (stage === "all" || stage === "unaccepted" && row.status === "pending" && !row.accepted_at || stage === "accepted" && row.status === "pending" && row.accepted_at || row.status === stage)
    && (!search || [row.patient_name, row.patient_identifier, row.callback_number, row.reason, row.doctor_name, row.current_location].some(value => String(value || "").toLowerCase().includes(search))))
    .sort((a,b) => view === "history" ? timestamp(b.updated_at || b.created_at) - timestamp(a.updated_at || a.created_at) || b.id - a.id : timestamp(a.created_at) - timestamp(b.created_at) || a.id - b.id);
  const selected = visible.find(row => row.id === selectedId) || (!compact ? visible[0] : null);
  const detailOpen = Boolean(selected && (!compact || sheetOpen));
  const selectedRequestId = selected?.id;
  useEffect(() => {
    if (!compact && selectedRequestId) setSelectedId(selectedRequestId);
    if (compact && dirty && selectedRequestId) setSheetOpen(true);
  }, [compact, dirty, selectedRequestId]);
  function openRequest(request) { guard(() => { setSelectedId(request.id); setSheetOpen(true); }); }
  function changeView(next) { guard(() => { setView(next); setStage("all"); setSelectedId(null); setSheetOpen(false); }); }

  async function action(request, name, body) {
    if (busy.current || user.is_read_only) return false;
    busy.current = true; setBusyId(request.id); setActionErrors(current => ({ ...current, [request.id]: "" }));
    try {
      const data = await api.post(`/teleconsultations/${request.id}/${name}`, body);
      if (!data.request?.id) throw new Error("Could not confirm the updated request. Please refresh.");
      version.current += 1;
      setRequests(current => current.map(row => row.id === data.request.id ? data.request : row));
      setSelectedId(data.request.id); setView(requestView(data.request)); setStage("all");
      if (compact && name === "accept") setSheetOpen(true);
      toast.success({ accept: "Request accepted. You can now assign a doctor.", assign: "Doctor assigned.", close: "Request cancelled." }[name]);
      window.dispatchEvent(new CustomEvent(PATIENTS_LIVE_EVENT));
      await load();
      return true;
    } catch (failure) {
      setActionErrors(current => ({ ...current, [request.id]: failure.message || "Could not update this request. Please retry." }));
      if ([404,409].includes(failure.status)) await load();
      return false;
    } finally { busy.current = false; setBusyId(null); }
  }
  function accept(request) {
    if (detailOpen && selected.id !== request.id) guard(() => action(request,"accept",{}));
    else void action(request,"accept",{});
  }
  const details = selected ? <RequestDetails key={`${selected.id}-${detailVersion}`} request={selected} user={user} doctors={doctors} doctorError={doctorError} retryDoctors={loadDoctors} busyId={busyId} error={actionErrors[selected.id]} onAction={action} onDirtyChange={setDirty} guard={guard} now={now} drafts={drafts} /> : null;
  const live = <span className={cx("inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold", error ? "bg-amber-50 text-amber-900" : "bg-[#def7ef] text-[#137b80]")}><span className={cx("size-2 rounded-full", error ? "bg-amber-500" : "bg-[#14b88b]")} />{error ? "Connection issue" : loading ? "Connecting" : "Live"}</span>;
  const stageOptions = view === "attention" ? [["unaccepted","Awaiting acceptance"],["accepted","Awaiting doctor"]] : view === "progress" ? [["assigned","Doctor assigned"],["in_consultation","In consultation"]] : [["completed","Completed"],["cancelled","Cancelled"],["referred","In-person assessment"]];

  return <section aria-label="Operator teleconsultations" className="operator-teleconsultations mx-auto w-full min-w-0 max-w-7xl space-y-5 pb-4 text-[#173f4a]">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3"><h1 className={cx("font-bold tracking-tight", compact ? "text-xl" : "text-3xl")}>Teleconsultations</h1>{!compact ? live : null}</div>
      <div className="flex items-center gap-2">{!user.is_read_only ? <PushNotificationBanner role="operator" compact /> : null}<AppUpdateBanner compact /><button type="button" className={`${pill} px-3`} aria-label="Refresh teleconsultations" disabled={loading || refreshing || busyId !== null} onClick={() => { void load(); void loadDoctors(); }}><RefreshCw className={cx("size-4", refreshing && "animate-spin")} aria-hidden="true" /></button></div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Teleconsultation views" className="flex flex-wrap items-center gap-2">
        {[{value:"attention",label:"Needs attention",count:counts.attention},{value:"progress",label:"In progress",count:counts.progress},{value:"history",label:"History"}].map(tab => <button type="button" key={tab.value} aria-pressed={view === tab.value} disabled={busyId !== null} onClick={() => changeView(tab.value)} className={cx(pill,"px-3", view === tab.value && "border-[#137b80] bg-[#137b80] text-white hover:bg-[#106b70]")}>{tab.label}{tab.count != null ? <span className={cx("rounded-full px-2 py-0.5 text-xs tabular-nums",view === tab.value ? "bg-white/20" : "bg-[#eaf3f1]")}>{loading ? "…" : error && !requests.length ? "—" : tab.count}</span> : null}</button>)}
        {compact ? live : null}
      </nav>
      <div className="flex w-full min-w-0 items-center gap-2 lg:w-auto">
        <label className="relative block min-w-0 flex-1"><span className="sr-only">Search teleconsultations</span><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#5b7379]" aria-hidden="true" /><input type="search" disabled={busyId !== null} className={`${field} rounded-full pl-9 lg:w-64`} placeholder="Search patient or mobile" value={query} onChange={event => { const value=event.target.value; guard(() => { setQuery(value); setSelectedId(null); setSheetOpen(false); }); }} /></label>
        <button type="button" className={`${pill} px-3`} aria-label="Filters" aria-expanded={filtersOpen} aria-controls="teleconsultation-filters" disabled={busyId !== null} onClick={() => setFiltersOpen(open => !open)}><SlidersHorizontal className="size-4" aria-hidden="true" /><span className="hidden sm:inline">Filters</span>{stage !== "all" ? <span className="size-2 rounded-full bg-[#137b80]" aria-label="Status filter applied" /> : null}</button>
      </div>
    </div>
    {stage !== "all" && !filtersOpen ? <p className="text-xs text-[#5b7379]">Status filter applied · Open Filters to change or clear it.</p> : null}
    {filtersOpen ? <div id="teleconsultation-filters" className="rounded-[22px] border border-[#d8ebe7] bg-white p-4"><label className="flex flex-wrap items-center gap-3 text-sm font-semibold">Filter by status<select aria-label="Filter by status" disabled={busyId !== null} className={`${field} sm:w-auto`} value={stage} onChange={event => { const value=event.target.value; guard(() => { setStage(value); setSelectedId(null); setSheetOpen(false); }); }}><option value="all">All {view === "history" ? "closed requests" : view === "progress" ? "requests in progress" : "requests needing attention"}</option>{stageOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div> : null}
    {error ? <p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-red-800">{error} {requests.length ? "Showing the last loaded requests." : ""} <button type="button" className="min-h-11 font-semibold underline" onClick={load}>Retry teleconsultations</button></p> : null}
    {loading ? <LoadingState label="Loading teleconsultations" /> : !visible.length ? <EmptyState title={error && !requests.length ? "Requests unavailable" : query || stage !== "all" ? "No matching requests" : view === "attention" ? "No requests need attention" : view === "progress" ? "No teleconsultations in progress" : "No teleconsultation history yet"} description={error && !requests.length ? "Retry to load teleconsultations." : query || stage !== "all" ? "Try another search or status filter." : view === "history" ? "Completed, cancelled and referred requests appear here." : "New requests and consultation updates appear here automatically."} /> : <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3 lg:rounded-[26px] lg:border lg:border-[#d8ebe7] lg:bg-white/50 lg:p-3">
        <ul aria-label="Teleconsultation request queue" className="space-y-3">
          {visible.map(request => <li key={request.id} className="min-w-0"><article aria-label={`Teleconsultation for ${request.patient_name}`} className={cx("min-w-0 rounded-[22px] border bg-white p-4 transition", !compact && selected?.id === request.id ? "border-[#52b8ac] bg-[#f0faf7]" : "border-[#d8ebe7]")}>
            <button type="button" aria-label={`Open request for ${request.patient_name}`} aria-current={!compact && selected?.id === request.id ? "true" : undefined} className="w-full min-w-0 text-left" disabled={busyId !== null} onClick={() => openRequest(request)}>
              <div className="flex items-start gap-3"><span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dff3ef] text-xs font-bold text-[#137b80]">{initials(request.patient_name)}</span><div className="min-w-0 flex-1"><h2 className="break-words text-base font-bold">{request.patient_name}</h2><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><StatusBadge request={request} /><RequestAge request={request} now={now} /></div></div></div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm font-normal leading-5 text-[#376168]">{request.reason || "No reason provided"}</p>
              
            </button>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><div className="min-w-0 flex-1 text-xs text-[#5b7379]"><p className="flex items-start gap-2 leading-5"><MapPin className="mt-0.5 size-3.5 shrink-0 text-[#137b80]" aria-hidden="true" /><span className="min-w-0 break-words">{request.current_location || "Location not provided"}</span></p>{request.doctor_name ? <p className="mt-1 break-words">{request.doctor_name}</p> : null}</div>
              {request.status === "pending" && !request.accepted_at && !user.is_read_only ? <button type="button" aria-label={`Accept request for ${request.patient_name}`} disabled={busyId !== null} className={primary} onClick={() => accept(request)}><Check className="size-4" aria-hidden="true" />{busyId === request.id ? "Accepting…" : "Accept"}</button> : <button type="button" aria-label={`${request.status === "pending" && !user.is_read_only ? "Assign doctor" : "Manage request"} for ${request.patient_name}`} disabled={busyId !== null} className={primary} onClick={() => openRequest(request)}>{request.status === "pending" && !user.is_read_only ? "Assign doctor" : "Manage request"}<ChevronRight className="size-3.5" aria-hidden="true" /></button>}
            </div>
            {actionErrors[request.id] && !(detailOpen && selected?.id === request.id) ? <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-red-800">{actionErrors[request.id]}</p> : null}
          </article></li>)}
        </ul>
      </div>
      {!compact && selected ? <aside aria-label="Request details" className="min-w-0 rounded-[26px] border border-[#d8ebe7] bg-white p-5 lg:sticky lg:top-4"><h2 className="mb-5 text-lg font-bold">Request details</h2>{details}</aside> : null}
    </div>}
    {!loading && !error && lastUpdated ? <p className="flex items-center gap-2 text-xs text-[#5b7379]"><span className="size-2 rounded-full bg-[#14b88b]" />{refreshing ? "Refreshing…" : `Updated ${new Date(lastUpdated).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`}{view === "history" && hasMoreHistory ? " · Latest 100 closed requests" : ""}</p> : null}
    <Modal open={Boolean(compact && sheetOpen && selected)} title="Request details" onClose={() => guard(() => setSheetOpen(false))} size="md">{compact ? details : null}</Modal>
    <Modal open={Boolean(confirmAction)} title="Discard teleconsultation changes?" onClose={() => setConfirmAction(null)} size="sm"><p className="text-sm text-[#5b7379]">Your edits have not been saved.</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={pill} onClick={() => setConfirmAction(null)}>Continue editing</button><button type="button" className={primary} onClick={() => { const next=confirmAction; if (selected) drafts.current.delete(selected.id); setConfirmAction(null); setDirty(false); setDetailVersion(value=>value+1); next?.(); }}>Discard changes</button></div></Modal>
  </section>;
}
