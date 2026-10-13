import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useFamilyProfile } from "../hooks/useFamilyProfile.jsx";
import { CLINIC_TEL_HREF } from "../lib/clinicContact.js";

const statusLabels = { pending: "Request received · awaiting doctor assignment", assigned: "Doctor assigned · awaiting WhatsApp call", in_consultation: "Consultation in progress", completed: "Consultation completed", cancelled: "Request cancelled", referred: "In-person assessment recommended" };
export default function PatientTeleconsultationPage() {
  const { activeProfile } = useFamilyProfile();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [form, setForm] = useState({ reason: "", current_location: "", callback_number: "", terms: false, consent: false });
  const load = useCallback(async () => {
    try { const next = await api.get("/patient-portal/teleconsultations"); setData(next); setError(""); }
    catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { void load(); const interval = window.setInterval(load, 15000); return () => window.clearInterval(interval); }, [load, activeProfile?.id]);
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    try {
      await api.post("/patient-portal/teleconsultations", { ...form, consent_version: data.consent_version, terms_accepted: form.terms, clinical_consent: form.consent });
      setForm({ reason: "", current_location: "", callback_number: "", terms: false, consent: false }); setRequesting(false); await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function cancel(id) {
    if (!window.confirm("Cancel this teleconsultation request?")) return;
    setBusy(true);
    try { await api.post(`/patient-portal/teleconsultations/${id}/cancel`); await load(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const active = data?.requests.find(r => ["pending", "assigned", "in_consultation"].includes(r.status));
  const inputClass = "mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800";
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  return <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 lg:px-8">
    <Link to="/dashboard" className="text-sm font-semibold text-brand-teal">Back to your dashboard</Link>
    <h1 className="text-2xl font-semibold text-slate-900">Teleconsultation</h1>
    <p className="text-sm leading-relaxed text-slate-600">Speak with an OCS doctor through WhatsApp. If you have an emergency, seek urgent care rather than waiting for this service.</p>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" onClick={load} className="ml-3 underline">Retry</button></div>}
    {!data && !error && <p role="status">Loading your consultations…</p>}
    {data?.requests.map(r => <section key={r.id} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="font-semibold">{statusLabels[r.status]}</h2><p className="text-sm text-slate-600">{r.reason}</p>
      {r.consultation_code && <div><p className="text-xs font-semibold text-slate-600">Your OCS consultation code</p><p className="mt-1 text-2xl font-semibold tracking-widest text-brand-teal">{r.consultation_code}</p><p className="mt-2 text-sm">Give this appointment code to the doctor when they call. Never give your account password, sign-in link or WhatsApp registration code.</p></div>}
      {r.doctor_name && <p className="text-sm">Assigned doctor: <strong>{r.doctor_name}</strong></p>}
      {["pending", "assigned"].includes(r.status) && <><p className="text-sm text-slate-600">Keep your phone available. OCS will confirm your callback arrangements. Contact the hotline if you need an update.</p><button type="button" disabled={busy} onClick={() => cancel(r.id)} className="text-sm font-semibold text-slate-600 underline">Cancel request</button></>}
      {r.patient_summary && <div><h3 className="text-sm font-semibold">Your care plan</h3><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{r.patient_summary}</p></div>}
      {r.outcome_note && <p className="whitespace-pre-wrap text-sm">{r.outcome_note}</p>}
      {r.follow_up && <div><h3 className="text-sm font-semibold">Follow-up and next steps</h3><p className="mt-1 whitespace-pre-wrap text-sm">{r.follow_up}</p></div>}
      {r.consultation_id && <Link to={`/health-records/visits/${r.consultation_id}`} className="inline-block text-sm font-semibold text-brand-teal">View consultation and prescription</Link>}
    </section>)}
    {data && !active && data.requests.length > 0 && !requesting && <button type="button" onClick={() => setRequesting(true)} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-brand-teal">Request another teleconsultation</button>}
    {data && !active && (data.requests.length === 0 || requesting) && (data.eligible ? <form onSubmit={submit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Request a teleconsultation</h2>
      <label className="block text-sm font-medium">Reason for consultation<textarea required maxLength={2000} rows={3} value={form.reason} onChange={e => set("reason", e.target.value)} className={inputClass} /></label>
      <label className="block text-sm font-medium">Your current location<input required maxLength={1000} value={form.current_location} onChange={e => set("current_location", e.target.value)} placeholder="Where you will be during the call" className={inputClass} /></label>
      <label className="block text-sm font-medium">Mobile confirmed with OCS<input required type="tel" value={form.callback_number} onChange={e => set("callback_number", e.target.value)} autoComplete="tel" className={inputClass} /></label>
      <h3 className="font-semibold">Terms, conditions and limitations</h3>
      {data.consent.map(section => <div key={section.title}><p className="text-sm font-semibold">{section.title}</p><p className="mt-1 text-sm leading-relaxed text-slate-600">{section.text}</p></div>)}
      <label className="flex items-start gap-3 text-sm"><input required type="checkbox" checked={form.terms} onChange={e => set("terms", e.target.checked)} />I have read and accept these service terms and limitations.</label>
      <label className="flex items-start gap-3 text-sm"><input required type="checkbox" checked={form.consent} onChange={e => set("consent", e.target.checked)} />I understand the benefits and limitations, have had the opportunity to ask questions, and consent to teleconsultation.</label>
      <button disabled={busy || !form.terms || !form.consent} className="rounded-xl bg-brand-teal px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Submitting…" : "Accept & request teleconsultation"}</button>
      <a href={CLINIC_TEL_HREF} className="block text-sm font-semibold text-brand-teal">Ask OCS a question or discuss alternatives</a>
    </form> : <div className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-sm">Call OCS for screening before requesting a teleconsultation. If your screening was more than 24 hours ago, the operator will reassess your request.</p><a href={CLINIC_TEL_HREF} className="mt-3 inline-block font-semibold text-brand-teal">Call the OCS hotline</a></div>)}

  </div>;
}
