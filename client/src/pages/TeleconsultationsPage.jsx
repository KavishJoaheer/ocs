import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useAuth } from "../hooks/useAuth.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";

const labels = { pending: "Awaiting assignment", assigned: "Doctor assigned", in_consultation: "In consultation", completed: "Completed", cancelled: "Cancelled", referred: "In-person assessment" };
const input = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800";
function RequestCard({ request, user, doctors, reload }) {
  const [doctorId, setDoctorId] = useState(String(request.assigned_doctor_id || ""));
  const [code, setCode] = useState("");
  const [checks, setChecks] = useState(false);
  const [note, setNote] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [prescription, setPrescription] = useState("");
  const [summary, setSummary] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [outcomeNote, setOutcomeNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isDispatch = ["admin", "operator"].includes(user.role);
  const isClinician = user.role === "admin" || (user.role === "doctor" && Number(user.doctor_id) === Number(request.assigned_doctor_id));
  const active = ["pending", "assigned", "in_consultation"].includes(request.status);
  async function action(name, body) {
    if (busy || user.is_read_only) return;
    setBusy(true); setError("");
    try { await api.post(`/teleconsultations/${request.id}/${name}`, body); await reload(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link to={`/patients/${request.patient_id}`} className="font-bold text-ocs-teal">{request.patient_name}</Link><p className="mt-1 text-xs text-slate-500">{request.patient_identifier} · Request #{request.id}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{labels[request.status]}</span></div>
    <p className="whitespace-pre-wrap text-sm text-slate-700">{request.reason}</p>
    <dl className="grid gap-2 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Current location</dt><dd>{request.current_location}</dd></div><div><dt className="text-slate-500">Confirmed mobile</dt><dd><a href={`tel:+${request.callback_number}`}>{request.callback_number}</a></dd></div></dl>
    {request.consultation_code && isDispatch && <p className="text-sm">Consultation code: <strong className="tracking-widest">{request.consultation_code}</strong></p>}
    <p className="text-xs text-slate-500">Consent accepted {new Date(`${request.consented_at.replace(" ", "T")}Z`).toLocaleString()} · Version {request.consent_version}</p>
    {request.doctor_name && <p className="text-sm">Doctor: <strong>{request.doctor_name}</strong></p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {isDispatch && ["pending", "assigned"].includes(request.status) && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void action("assign", { doctor_id: Number(doctorId) }); }}><label className="min-w-0 flex-1 text-sm font-semibold">Assign doctor<select required value={doctorId} onChange={e => setDoctorId(e.target.value)} className={`${input} mt-2`}><option value="">Choose doctor</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></label><button disabled={busy || user.is_read_only} className="rounded-xl bg-ocs-teal px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Assign</button></form>}
    {isClinician && request.status === "assigned" && <form onSubmit={e => { e.preventDefault(); void action("start", { consultation_code: code, checks_confirmed: checks }); }} className="space-y-3 border-t border-slate-100 pt-4">
      <a href={`https://wa.me/${request.callback_number}`} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-semibold text-ocs-teal underline">Open patient in WhatsApp</a><p className="text-sm text-slate-600">Place the WhatsApp call, introduce yourself and ask for the OCS consultation code. No call is placed automatically.</p>
      <label className="block text-sm font-semibold">Patient’s consultation code<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)} className={`${input} mt-2`} /></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={checks} onChange={e => setChecks(e.target.checked)} required />Identity, current location, callback, privacy, consent and clinical suitability confirmed.</label><button disabled={busy || !checks || user.is_read_only} className="rounded-xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Verify code & begin consultation</button>
    </form>}
    {isClinician && request.status === "in_consultation" && <form onSubmit={e => { e.preventDefault(); void action("complete", { clinical_note: note, patient_diagnosis: diagnosis, patient_prescription: prescription, patient_summary: summary, follow_up: followUp }); }} className="space-y-4 border-t border-slate-100 pt-4">
      <h3 className="font-semibold">Consultation record</h3>
      {[ ["Internal clinical note", note, setNote], ["Patient-facing diagnosis / assessment", diagnosis, setDiagnosis], ["Prescription · optional", prescription, setPrescription], ["Patient care summary and warning signs", summary, setSummary], ["Follow-up: responsible person, timing and contact route", followUp, setFollowUp] ].map(([label, value, setter]) => <label key={label} className="block text-sm font-medium">{label}<textarea required={label !== "Prescription · optional"} maxLength={label.startsWith("Follow-up") ? 2000 : 10000} rows={3} value={value} onChange={e => setter(e.target.value)} className={`${input} mt-2`} /></label>)}
      <button disabled={busy || user.is_read_only} className="rounded-xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Save consultation & publish care plan</button>
    </form>}
    {active && (isDispatch || isClinician) && <details className="border-t border-slate-100 pt-3"><summary className="text-sm font-semibold text-slate-600">Referral or cancellation</summary><div className="mt-3 space-y-3"><label className="block text-sm">Patient-facing reason<textarea value={outcomeNote} onChange={e => setOutcomeNote(e.target.value)} className={`${input} mt-1`} /></label><label className="block text-sm">Next step and responsible person<input value={followUp} onChange={e => setFollowUp(e.target.value)} className={`${input} mt-1`} /></label><div className="flex flex-wrap gap-3">{isClinician && request.assigned_doctor_id && <button type="button" disabled={busy || !outcomeNote.trim() || !followUp.trim() || user.is_read_only} onClick={() => action("close", { outcome: "referred", outcome_note: outcomeNote, follow_up: followUp })} className="rounded-xl border border-slate-200 px-4 py-2 text-sm disabled:opacity-50">Refer for in-person assessment</button>}{isDispatch && <button type="button" disabled={busy || !outcomeNote.trim() || !followUp.trim() || user.is_read_only} onClick={() => action("close", { outcome: "cancelled", outcome_note: outcomeNote, follow_up: followUp })} className="rounded-xl border border-slate-200 px-4 py-2 text-sm disabled:opacity-50">Cancel request</button>}</div></div></details>}
    {request.patient_summary && <p className="whitespace-pre-wrap text-sm"><strong>Care plan: </strong>{request.patient_summary}</p>}
    {request.follow_up && <p className="whitespace-pre-wrap text-sm"><strong>Follow-up: </strong>{request.follow_up}</p>}
    {request.outcome_note && <p className="whitespace-pre-wrap text-sm">{request.outcome_note}</p>}
    {request.consultation_id && <Link to={`/consultations/${request.consultation_id}`} className="inline-block text-sm font-semibold text-ocs-teal underline">Open saved consultation</Link>}
  </section>;
}
export default function TeleconsultationsPage() {
  const { user } = useAuth();
  const refreshKey = useLiveRefreshKey();
  const [requests, setRequests] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const response = await api.get("/teleconsultations"); setRequests(response.requests); setError(""); }
    catch (err) { setError(err.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(load, 15000); return () => window.clearInterval(timer); }, [load, refreshKey]);
  useEffect(() => {
    if (!["admin", "operator"].includes(user.role)) return;
    api.get("/doctors").then(setDoctors).catch(err => setError(err.message));
  }, [user.role]);
  return <div className="ocs-page mx-auto max-w-5xl space-y-5 p-4 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-bold text-ocs-slate">Manage teleconsultations</h1><p className="mt-1 text-sm text-slate-600">Consent, assignment, WhatsApp consultation and follow-up.</p></div><Link to="/patients/add" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold">Add patient</Link></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}<button onClick={load} type="button" className="ml-3 underline">Retry</button></p>}
    {loading ? <p role="status">Loading requests…</p> : requests.length ? requests.map(r => <RequestCard key={r.id} request={r} user={user} doctors={doctors} reload={load} />) : <p className="rounded-xl bg-white p-5 text-sm text-slate-600">{user.role === "doctor" ? "No teleconsultations assigned to you yet." : "No teleconsultation requests yet. Open a patient profile to prepare their OCS Care invitation."}</p>}
  </div>;
}
