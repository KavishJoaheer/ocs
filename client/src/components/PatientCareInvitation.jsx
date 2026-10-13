import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";

export default function PatientCareInvitation({ patient, readOnly = false }) {
  const [identity, setIdentity] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [screened, setScreened] = useState(false);
  const [invitation, setInvitation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!invitation) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [invitation]);
  const seconds = invitation ? Math.max(0, Math.ceil((Date.parse(invitation.expires_at) - now) / 1000)) : 0;
  async function generate() {
    setBusy(true);
    try {
      const next = await api.post(`/patients/${patient.id}/care-invitation`, {
        identity_confirmed: identity, mobile_confirmed: mobile,
        mobile: patient.patient_contact_number, teleconsultation_screened: screened,
      });
      setInvitation(next); setNow(Date.now());
      toast.success("Personal sign-in link created. Share it with the confirmed patient.");
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(invitation.message); toast.success("Invitation copied. Send it in the patient’s confirmed hotline conversation."); }
    catch { toast.error("Copy the invitation from the text box below."); }
  }
  const rowClass = "flex items-start gap-3 text-sm text-slate-700";
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold text-ocs-slate">Invite to OCS Care</h2><Link to="/teleconsultations" className="text-sm font-semibold text-ocs-teal underline">Teleconsultation queue</Link></div>
    <p className="mt-2 text-sm text-slate-600">Confirm identity and the patient’s own mobile: <strong>{patient.patient_contact_number || "Add a mobile number first"}</strong>. The patient stays on the hotline while you prepare access.</p>
    <div className="mt-4 space-y-3">
      <label className={rowClass}><input type="checkbox" checked={identity} onChange={e => setIdentity(e.target.checked)} />Patient identity checked using the agreed OCS procedure.</label>
      <label className={rowClass}><input type="checkbox" checked={mobile} onChange={e => setMobile(e.target.checked)} />Patient personally controls this mobile; number read back and confirmed.</label>
      <label className={rowClass}><input type="checkbox" checked={screened} onChange={e => setScreened(e.target.checked)} />Hotline screening completed; potentially suitable for teleconsultation, subject to the doctor’s assessment.</label>
    </div>
    <button type="button" disabled={readOnly || busy || !identity || !mobile || !patient.patient_contact_number} onClick={generate} className="mt-4 rounded-xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Preparing…" : invitation ? "Create replacement link" : "Create 10-minute sign-in link"}</button>
    {invitation && <div className="mt-4 space-y-3" role="status"><p className="text-sm font-semibold">{seconds ? `Valid for ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · one use` : "Link expired. Create a replacement if needed."}</p>
      {seconds > 0 && <><textarea aria-label="Personal invitation to copy" readOnly value={invitation.message} rows={5} className="w-full rounded-xl border border-slate-200 p-3 text-sm" /><button type="button" onClick={copy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold">Copy invitation for hotline WhatsApp</button></>}
      <p className="text-xs text-slate-500">Copying does not send a message. Share only with the confirmed patient. A replacement invalidates the earlier link. The sign-in link is separate from consent and the consultation code.</p></div>}
  </section>;
}
