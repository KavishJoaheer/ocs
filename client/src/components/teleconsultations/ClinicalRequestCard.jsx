import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ChevronDown, ChevronUp, FileText, MapPin, Phone, ShieldCheck, Stethoscope } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../../lib/api.js";
import { useClinicalDraft } from "../../hooks/useClinicalDraft.js";
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

export default function RequestCard({ request, user, doctors = [], expanded = true, visible = true, onToggle, onOpen, onUpdated, workspace = false }) {
  const [doctorId, setDoctorId] = useState(null);
  const [code, setCode] = useState("");
  const [checks, setChecks] = useState(false);
  const { draft, patch, clear, dirty, retained } = useClinicalDraft(user, request);
  const { note, diagnosis, prescription, summary, outcomeNote, outcomeNextStep } = draft;
  const setNote = value => patch("note", value);
  const setDiagnosis = value => patch("diagnosis", value);
  const setPrescription = value => patch("prescription", value);
  const setSummary = value => patch("summary", value);
  const setOutcomeNote = value => patch("outcomeNote", value);
  const setOutcomeNextStep = value => patch("outcomeNextStep", value);
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
      if (["complete", "close"].includes(name)) clear();
      onUpdated(response.request);
      toast.success({ assign: "Doctor assigned.", start: "Consultation started.", complete: "Consultation saved.", close: "Request closed." }[name]);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section hidden={!visible} aria-label={workspace ? `Consultation for ${request.patient_name}` : undefined} className={`${workspace ? "clinical-workspace " : ""}min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm ${expanded ? "border-ocs-teal/40" : "border-slate-200"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/patients/${request.patient_id}`} className="break-words text-base font-bold text-ocs-slate hover:text-ocs-teal hover:underline">{request.patient_name}</Link>
          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${status.color}`}>{request.status === "pending" && !request.accepted_at ? "Awaiting acceptance" : status.label}</span>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">{request.patient_identifier} · Request #{request.id} <span title="Mauritius time">· {formatTime(request.created_at)}</span></p>
        {!expanded && <p className="mt-2 line-clamp-1 text-sm text-slate-600">{request.reason}</p>}
      </div>
      {!workspace && <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={detailsId} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-ocs-slate hover:bg-slate-50">
        {expanded ? "Hide details" : active ? "Open consultation" : "View details"}
        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
      </button>}
    </div>

    <div id={detailsId} hidden={!expanded} onFocusCapture={onOpen} className="space-y-5 border-t border-slate-100 p-4 sm:p-5">
      {workspace && active && <p role="status" className="text-xs text-[#5b7379]">{dirty ? retained ? "Draft kept in this tab · not saved to patient record" : "Unsaved changes · keep this page open" : "No unsaved changes"}</p>}
      <details open={!workspace || request.status !== "in_consultation"} className="rounded-2xl bg-[#edf7f4] p-4"><summary className="cursor-pointer text-sm font-semibold text-ocs-slate">Patient details</summary><div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason for consultation</p>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-ocs-slate">{request.reason}</p>
        <dl className="mt-4 grid gap-4 border-t border-slate-200/70 pt-4 sm:grid-cols-3">
          <div className="min-w-0"><dt className="flex items-center gap-1.5 text-xs text-slate-500"><MapPin className="size-3.5" />Current location</dt><dd className="mt-1 break-words text-sm font-medium text-ocs-slate">{request.current_location}</dd></div>
          <div><dt className="flex items-center gap-1.5 text-xs text-slate-500"><Phone className="size-3.5" />Confirmed mobile</dt><dd className="mt-1 text-sm font-medium text-ocs-slate"><a href={`tel:+${request.callback_number}`} className="hover:underline">+{request.callback_number}</a></dd></div>
          <div><dt className="flex items-center gap-1.5 text-xs text-slate-500"><Stethoscope className="size-3.5" />Doctor</dt><dd className="mt-1 text-sm font-medium text-ocs-slate">{request.doctor_name || "Not assigned yet"}</dd></div>
        </dl>
      </div></details>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <details className="text-xs text-slate-500"><summary className="cursor-pointer font-medium text-emerald-700">Patient consent accepted</summary><p className="mt-2">{formatTime(request.consented_at)} · Mauritius time · Version {request.consent_version}</p></details>
        {request.consultation_code && isDispatch && <p className="rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-900">Consultation code <strong className="ml-2 text-base tracking-[0.2em]">{request.consultation_code}</strong></p>}
      </div>

      {error && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-xl bg-red-50 p-3 text-sm text-red-800 outline-none">{error}</p>}

      {isDispatch && request.accepted_at && <p className="text-xs text-emerald-800">Accepted by {request.accepted_by_name || "OCS dispatch"} · {formatTime(request.accepted_at)}</p>}
      {isDispatch && request.status === "pending" && !request.accepted_at && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">Accept this request in the notification above before assigning a doctor.</p>}

      {isDispatch && request.accepted_at && ["pending", "assigned"].includes(request.status) && <form onSubmit={event => { event.preventDefault(); void action("assign", { doctor_id: Number(doctorId ?? request.assigned_doctor_id) }); }}>
        <fieldset disabled={busy || user.is_read_only} className="space-y-3 rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-ocs-slate">{request.status === "assigned" ? "Doctor assignment" : "Assign a doctor"}</legend>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="min-w-0 w-full text-sm font-medium text-slate-600 sm:flex-1">Assign doctor<select required value={doctorId ?? String(request.assigned_doctor_id || "")} onChange={event => setDoctorId(event.target.value)} className={`${input} mt-2`}><option value="">Choose doctor</option>{doctors.map(doctor => <option key={doctor.id} value={doctor.id}>{doctor.full_name}</option>)}</select></label><button className={`${primary} w-full sm:w-auto`}>{busy ? "Assigning…" : request.status === "assigned" ? "Update assignment" : "Assign"}</button></div>
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
          <details open={!workspace || Boolean(prescription || summary) || undefined} className="rounded-2xl border border-teal-100 bg-teal-50/40 p-4">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold text-teal-800">Prescription & care summary (optional)</summary><div className="pt-3">
            <p className="mb-3 text-xs font-semibold text-teal-700">Additional information for the patient · optional</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <RecordField id={`${detailsId}-prescription`} label="Prescription (optional)" value={prescription} onChange={setPrescription} placeholder="Add prescription instructions if needed." />
              <RecordField id={`${detailsId}-summary`} label="Patient care summary (optional)" value={summary} onChange={setSummary} placeholder="Add a short summary of the care discussed, if needed." />
            </div>
          </div></details>
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"><p className="max-w-lg text-xs leading-relaxed text-slate-500">Saving completes the consultation and shares the diagnosis, plus any prescription or care summary, in OCS Care.</p><button className={`${primary} w-full sm:w-auto`}><CheckCircle2 className="size-4" />{busy ? "Saving consultation…" : "Save & complete consultation"}</button></div>
        </fieldset>
      </form>}

      {active && (isDispatch || isClinician) && <details className="border-t border-slate-100 pt-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-500">{workspace ? "Refer for in-person assessment" : "Referral or cancellation"}</summary>
        <fieldset disabled={busy || user.is_read_only} className="mt-4 space-y-3 rounded-xl border border-orange-100 bg-orange-50/30 p-4">
          <label className="block text-sm font-medium text-ocs-slate">Patient-facing reason<textarea maxLength={2000} rows={2} value={outcomeNote} onChange={event => setOutcomeNote(event.target.value)} className={`${input} mt-2`} /></label>
          <label className="block text-sm font-medium text-ocs-slate">Next step for patient<input maxLength={2000} value={outcomeNextStep} onChange={event => setOutcomeNextStep(event.target.value)} className={`${input} mt-2`} /></label>
          <div className="flex flex-wrap gap-3">{isClinician && request.assigned_doctor_id && <button type="button" disabled={!outcomeNote.trim() || !outcomeNextStep.trim()} onClick={() => action("close", { outcome: "referred", outcome_note: outcomeNote, follow_up: outcomeNextStep })} className={secondary}>Refer for in-person assessment</button>}{isDispatch && <button type="button" disabled={!outcomeNote.trim() || !outcomeNextStep.trim()} onClick={() => action("close", { outcome: "cancelled", outcome_note: outcomeNote, follow_up: outcomeNextStep })} className={secondary}>Cancel request</button>}</div>
        </fieldset>
      </details>}

      {workspace && !active && dirty && <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p role="alert" className="text-sm text-amber-900">This request was closed elsewhere. Your unfinished draft is kept in this tab and has not been saved to the patient record.</p>
        <details><summary className="min-h-11 cursor-pointer text-sm font-semibold text-amber-900">View unfinished draft</summary>
          <div className="space-y-3 pt-3">{Object.entries({ note: "Private clinical note", diagnosis: "Patient-facing diagnosis", prescription: "Patient-facing prescription", summary: "Patient care summary", outcomeNote: "Referral reason", outcomeNextStep: "Referral next step" }).filter(([key]) => draft[key]).map(([key, label]) => <div key={key}><label htmlFor={`${detailsId}-recover-${key}`} className="block text-xs font-semibold text-ocs-slate">{label}</label><textarea id={`${detailsId}-recover-${key}`} readOnly rows={3} value={draft[key]} className={`${input} mt-2`} /></div>)}</div>
        </details>
        <button type="button" className={secondary} onClick={() => { if (window.confirm("Discard this unfinished draft? It has not been saved to the patient record.")) clear(); }}>Discard unfinished draft</button>
      </div>}
      {!active && <div className="space-y-3 rounded-xl bg-slate-50 p-4">
        {request.record_withdrawn && <p className="text-sm font-semibold text-amber-900">This consultation record has been voided. It is no longer shared in OCS Care.</p>}
        {request.status === "completed" && <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 className="size-4 shrink-0" />Consultation saved to the patient record.</p>}
        {request.patient_summary && <div><h3 className="text-xs font-semibold text-slate-500">Patient care summary</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{request.patient_summary}</p></div>}
        {request.follow_up && <p className="whitespace-pre-wrap break-words text-sm text-slate-700"><strong>Next steps: </strong>{request.follow_up}</p>}
        {request.outcome_note && <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{request.outcome_note}</p>}
        {request.consultation_id && <Link to={`/consultations/${request.consultation_id}`} className={`${secondary} w-full sm:w-auto`}><FileText className="size-4" />Open saved consultation</Link>}
      </div>}
    </div>
  </section>;
}
