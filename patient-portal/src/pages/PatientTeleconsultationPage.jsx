import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight, Clock3, Copy, Phone, ShieldCheck, Stethoscope, Video } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { useFamilyProfile } from "../hooks/useFamilyProfile.jsx";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";
import { CLINIC_TEL_HREF, CLINIC_TEL_DISPLAY } from "../lib/clinicContact.js";
import { formatDoctorName } from "../lib/healthRecordsDisplay.js";

const ACTIVE = ["pending", "assigned", "in_consultation"];
const field = "mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base leading-relaxed text-slate-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/10 disabled:opacity-60";
const primary = "care-primary-button inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-dark-grey px-4 py-3 text-base font-semibold leading-relaxed text-white disabled:cursor-not-allowed disabled:opacity-50";
const emptyForm = { reason: "", current_location: "", terms: false, consent: false, consent_version: "" };

function RequestRecord({ request, busy, onCancel }) {
  const [copied, setCopied] = useState(false);
  async function copyCode() {
    try { await navigator.clipboard.writeText(request.consultation_code); setCopied(true); }
    catch { toast.error("Select the consultation code to copy it, or read it to your doctor."); }
  }
  const active = ACTIVE.includes(request.status);
  const title = request.record_withdrawn ? "Consultation record withdrawn" : request.status === "pending" ? request.accepted_at ? "Request accepted by OCS" : "Request sent to OCS" : {
    assigned: "Doctor assigned", in_consultation: "Consultation in progress", completed: "Consultation completed", cancelled: "Request cancelled", referred: "In-person assessment recommended",
  }[request.status];
  const stage = request.status === "assigned" || request.status === "in_consultation" ? 2 : request.accepted_at ? 1 : 0;
  return <section className="care-consultation-card overflow-hidden rounded-3xl border border-teal-100 bg-white shadow-sm">
    <div className="space-y-4 p-4 sm:p-5">
      <div className="care-consultation-status -mx-4 -mt-4 flex items-start gap-3 p-4 sm:-mx-5 sm:-mt-5 sm:p-5"><span className="rounded-xl bg-teal-50 p-2.5 text-teal-700">{request.status === "assigned" ? <Phone className="size-5" /> : active ? <Clock3 className="size-5" /> : <CheckCircle2 className="size-5" />}</span><div className="min-w-0"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider">OCS teleconsultation</p><h2 className="font-semibold leading-relaxed text-brand-dark-grey">{title}</h2><p className="mt-1 break-words text-sm leading-relaxed text-slate-500">{request.reason}</p></div></div>
      {active && <ol aria-label="Request progress" className="grid grid-cols-3 gap-2 border-y border-slate-100 py-4">
        {["Request sent", "OCS accepted", "Doctor assigned"].map((label, index) => <li key={label} aria-current={stage === index ? "step" : undefined} className="text-center"><span className={`mx-auto flex size-7 items-center justify-center rounded-full text-xs font-semibold ${index <= stage ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-400"}`}>{index <= stage ? <Check className="size-4" /> : index + 1}</span><p className={`mt-2 text-[11px] leading-relaxed ${index <= stage ? "font-semibold text-teal-800" : "text-slate-500"}`}>{label}</p></li>)}
      </ol>}
      {request.doctor_name && <div className="care-doctor-card flex items-center gap-3 rounded-2xl p-4"><span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-teal-800 text-amber-100"><Stethoscope className="size-5" /></span><div className="min-w-0"><p className="text-xs font-semibold text-teal-700">Your OCS doctor</p><p className="mt-1 break-words text-base font-bold text-brand-dark-grey">{formatDoctorName(request.doctor_name)}</p><p className="mt-1 text-xs text-slate-500">WhatsApp consultation</p></div></div>}
      {request.consultation_code && <div className="care-consultation-code-panel rounded-2xl p-4 text-center"><p className="text-xs font-semibold text-teal-800">Your OCS consultation code</p><p className="care-consultation-code mt-2 select-all text-4xl font-bold tracking-[0.2em]">{request.consultation_code}</p><button type="button" onClick={copyCode} className="mx-auto mt-2 inline-flex min-h-11 items-center gap-2 rounded-full border border-amber-300 bg-white/70 px-4 text-xs font-semibold text-teal-900">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "Code copied" : "Copy code"}</button><p className="mt-3 text-xs leading-relaxed text-teal-900">Give this code to the doctor when they call. Keep your sign-in link, password and WhatsApp registration code private.</p></div>}
      {request.status === "pending" && <p className="text-sm leading-relaxed text-slate-600">{request.accepted_at ? "The OCS team has accepted your request and will assign a doctor. Keep your phone available." : "Your request is waiting for an OCS operator to accept it. Keep your phone available; call OCS if you need an update."}</p>}
      {request.status === "assigned" && <p className="text-sm leading-relaxed text-slate-600">Keep WhatsApp available on your confirmed mobile. Your doctor will contact you for the consultation.</p>}
      {request.record_withdrawn && <p className="rounded-xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">OCS has withdrawn this consultation record. Contact the hotline if you need help or an updated record.</p>}
      {request.patient_summary && <div><h3 className="text-sm font-semibold text-brand-dark-grey">Your care summary</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{request.patient_summary}</p></div>}
      {request.outcome_note && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{request.outcome_note}</p>}
      {request.follow_up && <div><h3 className="text-sm font-semibold text-brand-dark-grey">Follow-up and next steps</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{request.follow_up}</p></div>}
      {request.consultation_id && <Link to={`/health-records/visits/${request.consultation_id}`} className="flex min-h-12 items-center justify-between gap-2 rounded-xl bg-brand-dark-grey px-4 py-3 text-sm font-semibold text-white"><span>View consultation and prescription</span><ChevronRight className="size-4 shrink-0" /></Link>}
      {["pending", "assigned"].includes(request.status) && <button type="button" disabled={busy} onClick={() => onCancel(request.id)} className="min-h-11 text-sm font-medium text-slate-500 underline disabled:opacity-50">Cancel request</button>}
    </div>
  </section>;
}

function CompletedConsultation({ request }) {
  return <section className="care-completion-card space-y-5 rounded-3xl border p-5 sm:p-6">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="care-completion-icon grid size-12 shrink-0 place-items-center rounded-2xl"><CheckCircle2 className="size-6" /></span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-900">Teleconsultation</p>
        <h1 className="mt-1 text-xl font-bold leading-snug text-brand-dark-grey sm:text-2xl">{request.record_withdrawn ? "Consultation record withdrawn" : "Consultation completed"}</h1>
      </div>
    </div>
    {request.doctor_name && <p className="flex items-center gap-2 text-sm font-semibold text-brand-dark-grey"><Stethoscope className="size-4 shrink-0" aria-hidden="true" />{formatDoctorName(request.doctor_name)}</p>}
    <p role="status" className="text-sm leading-relaxed text-brand-dark-grey">{request.record_withdrawn ? "Contact OCS for an updated record." : "Your record is ready."}</p>
    {request.consultation_id && <Link to={`/health-records/visits/${request.consultation_id}`} className={`${primary} !text-sm`}>
      View consultation &amp; prescription<ChevronRight className="size-4 shrink-0" aria-hidden="true" />
    </Link>}
    {(request.patient_summary || request.follow_up) && <details className="border-t border-amber-300/60 pt-2 text-sm text-brand-dark-grey">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">Care summary &amp; next steps</summary>
      {request.patient_summary && <p className="mb-3 whitespace-pre-wrap break-words leading-relaxed">{request.patient_summary}</p>}
      {request.follow_up && <p className="whitespace-pre-wrap break-words leading-relaxed">{request.follow_up}</p>}
    </details>}
  </section>;
}

function TeleconsultationContent({ isPrimary }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("details");
  const [form, setForm] = useState(emptyForm);
  const version = useRef(0);
  const topRef = useRef(null);
  const errorRef = useRef(null);
  const refreshKey = useLiveRefreshKey();
  const load = useCallback(async () => {
    const current = ++version.current;
    try {
      const next = await api.get("/patient-portal/teleconsultations");
      if (current === version.current) { setData(next); setLoadError(""); }
    } catch (err) { if (current === version.current) setLoadError(err.message); }
  }, []);
  useEffect(() => {
    void load(); const interval = window.setInterval(load, 15000);
    return () => { window.clearInterval(interval); version.current += 1; };
  }, [load, refreshKey]);
  const active = data?.requests.find(request => ACTIVE.includes(request.status));
  const activeId = active?.id;
  // Remember the case on this history entry, so refresh keeps its completion screen.
  // A fresh entry from Home has no case and must start with hotline triage.
  const trackedRequestId = location.state?.teleconsultationRequestId;
  useEffect(() => {
    if (activeId && activeId !== trackedRequestId) {
      navigate(`${location.pathname}${location.search}${location.hash}`, {
        replace: true, state: { ...location.state, teleconsultationRequestId: activeId },
      });
    }
  }, [activeId, trackedRequestId, location, navigate]);
  useEffect(() => {
    topRef.current?.focus({ preventScroll: true });
    topRef.current?.scrollIntoView({ block: "start" });
  }, [step, activeId]);
  useEffect(() => { if (actionError) errorRef.current?.focus(); }, [actionError]);

  function setDetail(key, value) { setForm(current => ({ ...current, [key]: value, terms: false, consent: false })); }
  function setConsent(key, value) {
    setForm(current => ({ ...current, ...(current.consent_version !== data.consent_version ? { terms: false, consent: false, consent_version: data.consent_version } : {}), [key]: value }));
  }
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setActionError("");
    try {
      const response = await api.post("/patient-portal/teleconsultations", { reason: form.reason, current_location: form.current_location, callback_number: data.confirmed_mobile, consent_version: form.consent_version, terms_accepted: form.terms, clinical_consent: form.consent });
      setData(current => ({ ...current, eligible: false, confirmed_mobile: null,
        requests: [response.request, ...current.requests.filter(request => request.id !== response.request.id)] }));
      setForm(emptyForm); setStep("details"); await load();
    } catch (err) { setActionError(err.message); } finally { setBusy(false); }
  }
  async function cancel(id) {
    if (busy || !window.confirm("Cancel this teleconsultation request?")) return;
    setBusy(true); setActionError("");
    try {
      const response = await api.post(`/patient-portal/teleconsultations/${id}/cancel`);
      setData(current => ({ ...current, requests: current.requests.map(request => request.id === id ? response.request : request) }));
      await load();
    } catch (err) { setActionError(err.message); } finally { setBusy(false); }
  }
  const latest = data?.requests[0];
  const eligible = isPrimary && data?.eligible && data?.confirmed_mobile;
  const trackedRequest = data?.requests.find(request => request.id === trackedRequestId);
  const completed = !active && !eligible && trackedRequest?.status === "completed" ? trackedRequest : null;
  const showForm = data && !active && !completed;
  const hotlineRequired = showForm && !eligible;
  const nextSteps = !active && latest && ["referred", "cancelled"].includes(latest.status) && (latest.outcome_note || latest.follow_up) ? latest : null;
  const currentConsent = data?.consent_version === form.consent_version;

  return <div className="mx-auto max-w-3xl space-y-5 py-3 lg:py-6">
    <Link to="/dashboard" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-dark-grey"><ArrowLeft className="size-4" />{completed ? "Back to dashboard" : "Back to your dashboard"}</Link>
    {!completed && !hotlineRequired && <>
      <div ref={topRef} tabIndex={-1} className="care-tele-hero scroll-mt-4 outline-none"><div className="flex items-center gap-3"><span className="rounded-2xl bg-teal-100 p-3 text-teal-800"><Video className="size-6" /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-teal-700">OCS remote care</p><h1 className="mt-1 text-2xl font-bold text-brand-dark-grey">Teleconsultation</h1></div></div><p className="mt-4 text-sm leading-relaxed text-slate-600">Speak with an OCS doctor through WhatsApp, after hotline screening.</p></div>
      <p className="rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">This service is not for emergencies. Seek urgent care if you have an emergency.</p>
    </>}
    {loadError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{loadError}<button type="button" onClick={load} className="ml-2 min-h-11 font-semibold underline">Retry</button></p>}
    {actionError && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-xl bg-red-50 p-4 text-sm text-red-800 outline-none">{actionError}</p>}
    {!data && !loadError && <p role="status" className="rounded-2xl bg-white p-5 text-sm text-slate-500">Loading your consultations…</p>}
    {active && <RequestRecord request={active} busy={busy} onCancel={cancel} />}
    {completed && <div ref={topRef} tabIndex={-1} className="scroll-mt-4 space-y-3 outline-none">
      <CompletedConsultation request={completed} />
      <p className="px-2 text-center text-sm leading-relaxed text-slate-600">For another consultation, call OCS for triage and a new OCS Care link.</p>
      <a href={CLINIC_TEL_HREF} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-brand-dark-grey hover:bg-white/60">
        <Phone className="size-4" aria-hidden="true" />Call OCS hotline
      </a>
    </div>}
    {nextSteps && <section aria-label="Latest next steps from OCS" className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
      <h2 className="font-semibold text-amber-950">Next steps from OCS</h2>
      {nextSteps.outcome_note && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-amber-950">{nextSteps.outcome_note}</p>}
      {nextSteps.follow_up && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-amber-950">{nextSteps.follow_up}</p>}
    </section>}

    {showForm && (eligible ? <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="text-lg font-semibold text-brand-dark-grey">Request a teleconsultation</h2><ol aria-label="Request steps" className="mt-4 grid grid-cols-2 gap-3">{[ ["details", "Your details"], ["consent", "Review & consent"] ].map(([key, title], index) => <li key={key} aria-current={step === key ? "step" : undefined} className={`flex items-center gap-2 text-xs font-semibold ${step === key ? "text-teal-800" : "text-slate-400"}`}><span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${step === key ? "bg-teal-700 text-white" : "bg-slate-100"}`}>{index + 1}</span>{title}</li>)}</ol></div>
      {step === "details" ? <form onSubmit={event => { event.preventDefault(); setForm(current => ({ ...current, terms: false, consent: false, consent_version: data.consent_version })); setActionError(""); setStep("consent"); }} className="space-y-5 p-4 sm:p-5">
        <div><label htmlFor="tele-reason" className="text-sm font-semibold text-brand-dark-grey">Reason for consultation</label><textarea id="tele-reason" required maxLength={2000} rows={4} value={form.reason} onChange={event => setDetail("reason", event.target.value)} placeholder="Tell us briefly why you would like to speak with a doctor." className={field} /></div>
        <div><label htmlFor="tele-location" className="text-sm font-semibold text-brand-dark-grey">Your current location</label><input id="tele-location" required maxLength={1000} autoComplete="street-address" value={form.current_location} onChange={event => setDetail("current_location", event.target.value)} placeholder="Where you will be during the call" className={field} /><p className="mt-2 text-xs leading-relaxed text-slate-500">For example, your address or the town and place where you are now.</p></div>
        <div><label htmlFor="tele-mobile" className="text-sm font-semibold text-brand-dark-grey">Mobile confirmed with OCS</label><input id="tele-mobile" type="tel" readOnly value={`+${data.confirmed_mobile}`} className={`${field} bg-slate-50 text-slate-600`} /><p className="mt-2 text-xs leading-relaxed text-slate-500">Your doctor will contact you on WhatsApp at this number. Contact OCS if it needs changing.</p></div>
        <button type="submit" className={primary}>Continue to consent<ArrowRight className="size-4" /></button>
      </form> : <form onSubmit={submit} className="space-y-5 p-4 sm:p-5">
        <fieldset disabled={busy} className="space-y-5">
          <div className="rounded-2xl bg-slate-50 p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-brand-dark-grey">Your request</h3><button type="button" onClick={() => { setActionError(""); setStep("details"); }} className="min-h-11 text-sm font-semibold text-teal-800 underline">Edit details</button></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">{form.reason}</p><p className="mt-2 break-words text-xs leading-relaxed text-slate-500">{form.current_location} · +{data.confirmed_mobile}</p></div>
          <div><h3 className="flex items-center gap-2 text-base font-semibold text-brand-dark-grey"><ShieldCheck className="size-5 text-teal-700" />Terms, conditions and limitations</h3><p className="mt-2 text-sm leading-relaxed text-slate-500">Please read these before confirming your request.</p></div>
          {!currentConsent && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">The terms have changed. Read the current terms and confirm both choices again.</p>}
          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 px-4">{data.consent.map(section => <div key={section.title} className="py-4"><p className="text-sm font-semibold text-brand-dark-grey">{section.title}</p><p className="mt-2 text-sm leading-6 text-slate-600">{section.text}</p></div>)}</div>
          <div className="space-y-3">{[ ["terms", "I have read and accept these service terms and limitations."], ["consent", "I understand the benefits and limitations, have had the opportunity to ask questions, and consent to teleconsultation."] ].map(([key, text]) => <label key={key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm leading-relaxed text-slate-700"><input required type="checkbox" className="mt-1 size-5 shrink-0 accent-teal-700" checked={currentConsent && form[key]} onChange={event => setConsent(key, event.target.checked)} />{text}</label>)}</div>
          <button disabled={!currentConsent || !form.terms || !form.consent} className={primary}>{busy ? "Sending your request…" : "Accept & request teleconsultation"}</button>
          <button type="button" onClick={() => { setActionError(""); setStep("details"); }} className="min-h-11 w-full text-sm font-semibold text-slate-500">Back to your details</button>
        </fieldset>
      </form>}
    </div> : <section ref={topRef} tabIndex={-1} className="care-hotline-card scroll-mt-4 space-y-5 rounded-3xl border p-5 outline-none sm:p-6">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="care-completion-icon grid size-12 shrink-0 place-items-center rounded-2xl"><Phone className="size-6" /></span>
        <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wider text-amber-900">Teleconsultation</p><h1 className="mt-1 text-xl font-bold leading-snug text-brand-dark-grey sm:text-2xl">{isPrimary ? "Start with a call to OCS" : "Arrange care for your family"}</h1></div>
      </div>
      <p className="text-sm leading-relaxed text-brand-dark-grey">{isPrimary ? "Call before every new consultation. Our operator will assess your case and send an OCS Care link if suitable." : "Call OCS to arrange a teleconsultation for a dependent through the verified guardian account."}</p>
      <a href={CLINIC_TEL_HREF} className={primary}><Phone className="size-4 shrink-0" aria-hidden="true" />Call OCS hotline</a>
      <p className="text-xs leading-relaxed text-amber-950">For emergencies, seek urgent care.</p>
    </section>)}
    {hotlineRequired && <Link to="/health-records" className="flex min-h-12 items-center justify-center gap-2 text-sm font-semibold text-brand-dark-grey">View past consultations<ChevronRight className="size-4 shrink-0" aria-hidden="true" /></Link>}

    {!completed && !hotlineRequired && <a href={CLINIC_TEL_HREF} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-brand-dark-grey"><Phone className="size-4 shrink-0" />Ask OCS a question · {CLINIC_TEL_DISPLAY}</a>}
  </div>;
}

export default function PatientTeleconsultationPage() {
  const { activeProfile } = useFamilyProfile();
  return <TeleconsultationContent key={activeProfile?.id} isPrimary={Boolean(activeProfile?.isPrimary)} />;
}
