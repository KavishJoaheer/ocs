import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import { useLiveRefreshKey } from "../hooks/useLiveRefreshKey.js";

export default function PatientCareInvitation({ patient, readOnly = false, onSignedIn }) {
  const [purpose, setPurpose] = useState("records");
  const [identity, setIdentity] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [screened, setScreened] = useState(false);
  const [invitation, setInvitation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [statusRetry, setStatusRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const refreshKey = useLiveRefreshKey();
  const invitationId = invitation?.invitation_id;
  useEffect(() => {
    if (!invitationId || busy) return;
    let ignore = false;
    let checking = false;
    const check = async () => {
      if (checking || ignore) return;
      checking = true;
      try {
        const status = await api.get(`/patients/${patient.id}/care-invitation/${invitationId}`);
        if (ignore) return;
        setStatusError(false);
        if (status.status === "used") {
          ignore = true;
          window.clearInterval(timer);
          toast.success("Patient signed in to OCS Care.");
          onSignedIn?.();
        } else if (["expired", "revoked"].includes(status.status)) {
          window.clearInterval(timer);
        }
      } catch {
        if (!ignore) setStatusError(true);
      } finally { checking = false; }
    };
    const timer = window.setInterval(check, 3000);
    void check();
    return () => { ignore = true; window.clearInterval(timer); };
  }, [invitationId, patient.id, busy, refreshKey, statusRetry, onSignedIn]);
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
        mobile: patient.patient_contact_number, teleconsultation_screened: purpose === "teleconsultation" && screened,
      });
      setInvitation(next); setNow(Date.now()); setStatusError(false);
      toast.success("Personal sign-in link created. Share it with the confirmed patient.");
    } catch (error) { toast.error(error.message); }
    finally { setBusy(false); }
  }
  async function copy(linkOnly = false) {
    try { await navigator.clipboard.writeText(linkOnly ? invitation.url : invitation.message); toast.success(linkOnly ? "Sign-in link copied." : "Invitation copied. Send it to the confirmed patient’s WhatsApp conversation."); }
    catch { toast.error("Select and copy the link and message below."); }
  }
  const rowClass = "flex items-start gap-3 text-sm text-slate-700";
  function choosePurpose(next) {
    setPurpose(next);
    setScreened(false);
    setInvitation(null);
  }
  return <div className="space-y-4">
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-ocs-slate">Access needed for</legend>
      <div className="flex flex-wrap gap-4">
        <label className={rowClass}><input type="radio" name="care-invitation-purpose" value="records" checked={purpose === "records"} onChange={() => choosePurpose("records")} disabled={busy} />Patient records</label>
        <label className={rowClass}><input type="radio" name="care-invitation-purpose" value="teleconsultation" checked={purpose === "teleconsultation"} onChange={() => choosePurpose("teleconsultation")} disabled={busy} />Teleconsultation</label>
      </div>
    </fieldset>
    <p className="text-sm text-slate-600">Confirm identity and the patient’s own mobile: <strong>{patient.patient_contact_number || "Add a mobile number first"}</strong>.</p>
    <div className="mt-4 space-y-3">
      <label className={rowClass}><input type="checkbox" checked={identity} onChange={e => setIdentity(e.target.checked)} />Patient identity checked using the agreed OCS procedure.</label>
      <label className={rowClass}><input type="checkbox" checked={mobile} onChange={e => setMobile(e.target.checked)} />Patient personally controls this mobile; number read back and confirmed.</label>
      {purpose === "teleconsultation" && <label className={rowClass}><input type="checkbox" checked={screened} onChange={e => setScreened(e.target.checked)} />Hotline screening completed; potentially suitable for teleconsultation, subject to the doctor’s assessment.</label>}
    </div>
    <button type="button" disabled={readOnly || busy || !identity || !mobile || !patient.patient_contact_number || (purpose === "teleconsultation" && !screened)} onClick={generate} className="rounded-xl bg-ocs-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Preparing…" : invitation ? "Create replacement link" : "Create 10-minute sign-in link"}</button>
    {invitation && <div className="mt-4 space-y-3">
      {seconds > 0 ? <>
        <div className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <label className="block text-sm font-semibold text-ocs-slate">
            Personal sign-in link
            <input readOnly value={invitation.url} onFocus={event => event.target.select()} className="mt-2 w-full min-w-0 rounded-lg border border-slate-200 bg-white p-3 text-sm font-normal text-ocs-teal" />
          </label>
          <p className="text-xs font-semibold text-ocs-teal">{`Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · one use`}</p>
          <p aria-label="Invitation message" className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{invitation.instructions || invitation.message.replace(invitation.url, "").trim()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => copy()} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold">Copy invitation for WhatsApp</button>
          <button type="button" onClick={() => copy(true)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold">Copy link only</button>
        </div>
      </> : <p role="status" className="text-sm font-semibold">Link expired. Create a replacement if needed.</p>}
      <p className="text-xs text-slate-500">Copying does not send a message. Share only with the confirmed patient. A replacement invalidates the earlier link. The sign-in link is separate from consent and the consultation code.</p></div>}
    {invitation && statusError && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Waiting to confirm patient sign-in. This window will close when access is confirmed.<button type="button" onClick={() => setStatusRetry(value => value + 1)} className="ml-2 min-h-11 font-semibold underline">Check again</button></p>}
  </div>;
}
