import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronUp, ClipboardList, FileText, MapPin, Phone, Plus, RefreshCw, Search, ShieldCheck, Stethoscope } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";

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

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Indian/Mauritius", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function RecordField({ id, label, value, onChange, required = false, rows = 3, placeholder }) {
  return <div className="min-w-0 space-y-2">
    <label htmlFor={id} className="block text-sm font-semibold text-ocs-slate">{label}</label>
    <textarea id={id} required={required} maxLength={10000} rows={rows} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={`${input} resize-y leading-relaxed`} />
  </div>;
}

function RequestCard({ request, user, doctors, expanded, visible, onToggle, onOpen, onUpdated }) {
  const [doctorId, setDoctorId] = useState(null);
  const [code, setCode] = useState("");
  const [checks, setChecks] = useState(false);
  const [note, setNote] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [prescription, setPrescription] = useState("");
  const [summary, setSummary] = useState("");
  const [outcomeNextStep, setOutcomeNextStep] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const errorRef = useRef(null);
  const isDispatch = ["admin", "operator"].includes(user.role);
  const isClinician = user.role === "admin" || (user.role === "doctor" && Number(user.doctor_id) === Number(request.assigned_doctor_id));
  const active = ACTIVE.includes(request.status);
  const status = statuses[request.status] || statuses.pending;
  const detailsId = `teleconsultation-${request.id}`;

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function action(name, body) {
    if (busy || user.is_read_only) return;
    setBusy(true); setError("");
    try {
      const response = await api.post(`/teleconsultations/${request.id}/${name}`, body);
      if (name === "assign") setDoctorId(null);
      onUpdated(response.request);
      toast.success({ assign: "Doctor assigned.", start: "Consultation started.", complete: "Consultation saved.", close: "Request closed." }[name]);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section hidden={!visible} className={`min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm ${expanded ? "border-ocs-teal/40" : "border-slate-200"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/patients/${request.patient_id}`} className="break-words text-base font-bold text-ocs-slate hover:text-ocs-teal hover:underline">{request.patient_name}</Link>
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${status.color}`}>{status.label}</span>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">{request.patient_identifier} · Request #{request.id} <span title="Mauritius time">· {formatTime(request.created_at)}</span></p>
        {!expanded && <p className="mt-2 line-clamp-1 text-sm text-slate-600">{request.reason}</p>}
      </div>
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-ocs-slate hover:bg-slate-50">
        {expanded ? "Hide details" : active ? "Open consultation" : "View details"}
        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>
    </div>

    <div id={detailsId} hidden={!expanded} onFocusCapture={onOpen} className="space-y-5 border-t border-slate-100 p-4 sm:p-5">
      <div className="rounded-xl bg-slate-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason for consultation</p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ocs-slate">{request.reason}</p>
        <dl className="mt-4 grid gap-4 border-t border-slate-200/70 pt-4 sm:grid-cols-3">
          <div className="min-w-0"><dt className="flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="size-3.5" />Current location</dt><dd className="mt-1 break-words text-sm font-medium text-ocs-slate">{request.current_location}</dd></div>
          <div><dt className="flex items-center gap-1.5 text-xs text-slate-500"><Phone className="size-3.5" />Confirmed mobile</dt><dd className="mt-1 text-sm font-medium text-ocs-slate"><a href={`tel:+${request.callback_number}`} className="hover:underline">+{request.callback_number}</a></dd></div>
          <div><dt className="flex items-center gap-1.5 text-xs text-slate-500"><Stethoscope className="size-3.5" />Doctor</dt><dd className="mt-1 text-sm font-medium text-ocs-slate">{request.doctor_name || "Not assigned yet"}</dd></div>
        </dl>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <details className="text-xs text-slate-500"><summary className="cursor-pointer font-medium text-emerald-700">Patient consent accepted</summary><p className="mt-2">{formatTime(request.consented_at)} · Mauritius time · Version {request.consent_version}</p></details>
        {request.consultation_code && isDispatch && <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-900">Consultation code <strong className="ml-2 text-base tracking-[0.2em]">{request.consultation_code}</strong></p>}
      </div>

      {error && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-xl bg-red-50 p-3 text-sm text-red-800 outline-none">{error}</p>}

      {isDispatch && ["pending", "assigned"].includes(request.status) && <form onSubmit={event => { event.preventDefault(); void action("assign", { doctor_id: Number(doctorId ?? request.assigned_doctor_id) }); }}>
        <fieldset disabled={busy || user.is_read_only} className="space-y-3 rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-ocs-slate">{request.status === "assigned" ? "Doctor assignment" : "Assign a doctor"}</legend>
          <div className="flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1 text-sm font-medium text-slate-600">Assign doctor<select required value={doctorId ?? String(request.assigned_doctor_id || "")} onChange={event => setDoctorId(event.target.value)} className={`${input} mt-2`}><option value="">Choose doctor</option>{doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>)}</select></label><button className={primary}>{busy ? "Assigning…" : request.status === "assigned" ? "Update assignment" : "Assign"}</button></div>
        </fieldset>
      </form>}

      {isClinician && request.status === "assigned" && <form onSubmit={event => { event.preventDefault(); void action("start", { consultation_code: code, checks_confirmed: checks }); }}>
        <fieldset disabled={busy || user.is_read_only} className="space-y-4 rounded-xl border border-teal-200 bg-teal-50/40 p-4">
          <legend className="px-1 text-base font-semibold text-ocs-slate">Confirm patient & begin</legend>
          <div className="flex flex-wrap items-center gap-3"><a href={`https://wa.me/${request.callback_number}`} target="_blank" rel="noopener noreferrer" className={secondary}><Phone className="size-4" />Open patient in WhatsApp</a><p className="max-w-lg text-sm leading-relaxed text-slate-600">Call the patient, introduce yourself and ask for their six-digit consultation code.</p></div>
          <label className="block max-w-xs text-sm font-semibold text-ocs-slate">Patient’s consultation code<input required inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} placeholder="6-digit code" className={`${input} mt-2 font-mono text-lg tracking-widest`} /></label>
          <label className="flex items-start gap-3 rounded-xl bg-white p-3 text-sm leading-relaxed text-slate-700"><input type="checkbox" className="mt-1 size-4 shrink-0 accent-teal-600" checked={checks} onChange={event => setChecks(event.target.checked)} required />Identity, current location, callback, privacy, consent and clinical suitability confirmed.</label>
          <button disabled={!checks} className={`${primary} w-full sm:w-auto`}><ShieldCheck className="size-4" />{busy ? "Verifying…" : "Verify code & begin consultation"}</button>
        </fieldset>
      </form>}

      {isClinician && request.status === "in_consultation" && <form onSubmit={event => { event.preventDefault(); void action("complete", { clinical_note: note, patient_diagnosis: diagnosis, patient_prescription: prescription, patient_summary: summary }); }}>
        <fieldset disabled={busy || user.is_read_only} className="space-y-4">
          <div><h3 className="flex items-center gap-2 text-lg font-bold text-ocs-slate"><FileText className="size-5 text-ocs-teal" />Consultation record</h3><p className="mt-1 text-sm text-slate-500">Complete the consultation note and diagnosis. Prescription and care summary are optional.</p></div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><ShieldCheck className="size-3.5" />Clinical record · VP only</p>
              <RecordField id={`${detailsId}-note`} label="Consultation note (not visible to patient)" required rows={4} value={note} onChange={setNote} placeholder="Document the consultation, findings and clinical reasoning." />
            </div>
            <div className="space-y-3 rounded-xl border border-teal-100 bg-teal-50/40 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-teal-700"><CheckCircle2 className="size-3.5" />Visible to patient in OCS Care</p>
              <RecordField id={`${detailsId}-diagnosis`} label="Patient-facing diagnosis / assessment" required rows={4} value={diagnosis} onChange={setDiagnosis} placeholder="Write the diagnosis or assessment for the patient." />
            </div>
          </div>
          <div className="rounded-xl border border-teal-100 bg-teal-50/40 p-4">
            <p className="mb-3 text-xs font-semibold text-teal-700">Additional information for the patient · optional</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <RecordField id={`${detailsId}-prescription`} label="Prescription (optional)" value={prescription} onChange={setPrescription} placeholder="Add prescription instructions if needed." />
              <RecordField id={`${detailsId}-summary`} label="Patient care summary (optional)" value={summary} onChange={setSummary} placeholder="Add a short summary of the care discussed, if needed." />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><p className="max-w-lg text-xs leading-relaxed text-slate-500">Saving completes the consultation and shares the diagnosis, plus any prescription or care summary, in OCS Care.</p><button className={`${primary} w-full sm:w-auto`}><CheckCircle2 className="size-4" />{busy ? "Saving consultation…" : "Save & complete consultation"}</button></div>
        </fieldset>
      </form>}

      {active && (isDispatch || isClinician) && <details className="border-t border-slate-100 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-500">Referral or cancellation</summary>
        <fieldset disabled={busy || user.is_read_only} className="mt-4 space-y-3 rounded-xl border border-orange-100 bg-orange-50/30 p-4">
          <label className="block text-sm font-medium text-ocs-slate">Patient-facing reason<textarea maxLength={2000} rows={2} value={outcomeNote} onChange={event => setOutcomeNote(event.target.value)} className={`${input} mt-2`} /></label>
          <label className="block text-sm font-medium text-ocs-slate">Next step for patient<input maxLength={2000} value={outcomeNextStep} onChange={event => setOutcomeNextStep(event.target.value)} className={`${input} mt-2`} /></label>
          <div className="flex flex-wrap gap-3">{isClinician && request.assigned_doctor_id && <button type="button" disabled={!outcomeNote.trim() || !outcomeNextStep.trim()} onClick={() => action("close", { outcome: "referred", outcome_note: outcomeNote, follow_up: outcomeNextStep })} className={secondary}>Refer for in-person assessment</button>}{isDispatch && <button type="button" disabled={!outcomeNote.trim() || !outcomeNextStep.trim()} onClick={() => action("close", { outcome: "cancelled", outcome_note: outcomeNote, follow_up: outcomeNextStep })} className={secondary}>Cancel request</button>}</div>
        </fieldset>
      </details>}

      {!active && <div className="space-y-3 rounded-xl bg-slate-50 p-4">
        {request.status === "completed" && <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 className="size-4 shrink-0" />Consultation saved to the patient record.</p>}
        {request.patient_summary && <div><h3 className="text-xs font-semibold text-slate-500">Patient care summary</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{request.patient_summary}</p></div>}
        {request.follow_up && <p className="whitespace-pre-wrap break-words text-sm text-slate-700"><strong>Next steps: </strong>{request.follow_up}</p>}
        {request.outcome_note && <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{request.outcome_note}</p>}
        {request.consultation_id && <Link to={`/consultations/${request.consultation_id}`} className={`${secondary} w-full sm:w-auto`}><FileText className="size-4" />Open saved consultation</Link>}
      </div>}
    </div>
  </section>;
}

export default function TeleconsultationsPage() {
  const { user } = useAuth();
  const refreshKey = useLiveRefreshKey();
  const [requests, setRequests] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [doctorError, setDoctorError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [expandedId, setExpandedId] = useState(undefined);
  const loadVersion = useRef(0);
  const isDispatch = ["admin", "operator"].includes(user.role);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const response = await api.get("/teleconsultations");
      if (version === loadVersion.current) { setRequests(response.requests); setError(""); }
    } catch (err) { if (version === loadVersion.current) setError(err.message); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 15000);
    return () => { window.clearInterval(timer); loadVersion.current += 1; };
  }, [load, refreshKey]);

  const loadDoctors = useCallback(async () => {
    try { setDoctors(await api.get("/doctors")); setDoctorError(""); }
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
      {(!error || requests.length > 0) && <p role="status" className="text-xs text-slate-500">{visible.length} {visible.length === 1 ? "request" : "requests"}{requests.length >= 100 ? " · Showing up to 100 requests" : ""} · Updates automatically</p>}
      {!visible.length && !error && <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center"><ClipboardList className="mx-auto size-8 text-slate-300" /><h2 className="mt-3 font-semibold text-ocs-slate">{query || filter !== "active" ? "No matching requests" : "No active teleconsultations"}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">{query ? "Try another patient name, mobile number or consultation reason." : filter === "active" ? isDispatch ? "Open a patient profile to send an OCS Care link. Requests appear here after the patient accepts consent." : "New teleconsultations will appear here when they are assigned to you." : "Choose a different status to see other consultations."}</p>{(query || filter !== "all") && <button type="button" onClick={() => { setQuery(""); setFilter("all"); setExpandedId(undefined); }} className={`${secondary} mt-4`}>View all requests</button>}</div>}
      <div className="space-y-4">
        {/* Keep cards mounted so filtering, folding and live refresh preserve entered notes. */}
        {requests.map(request => <RequestCard key={request.id} request={request} user={user} doctors={doctors} visible={visibleIds.has(request.id)} expanded={request.id === openId} onToggle={() => setExpandedId(request.id === openId ? null : request.id)} onOpen={() => setExpandedId(request.id)} onUpdated={onUpdated} />)}
      </div>
    </>}
  </div>;
}
