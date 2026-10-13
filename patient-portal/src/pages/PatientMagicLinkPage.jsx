import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PatientAuthShell from "../components/auth/PatientAuthShell.jsx";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { CLINIC_TEL_HREF } from "../lib/clinicContact.js";

export default function PatientMagicLinkPage() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { redeemMagicLink, isBootstrapping } = usePatientAuth();
  const navigate = useNavigate();
  useEffect(() => {
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  async function enter() {
    if (busy) return;
    setBusy(true); setError("");
    try { await redeemMagicLink(token); navigate("/dashboard", { replace: true }); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <PatientAuthShell pill="Personal invitation" title="Welcome to OCS Care">
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-slate-600">Your OCS team has prepared your patient profile. Continue to sign in securely without a password.</p>
      <p className="text-sm text-slate-600">This personal link works once and expires 10 minutes after it was created. Keep it private.</p>
      <div role="alert" className="text-sm text-red-700">{error || (!token ? "This link is incomplete. Please ask OCS for a new invitation." : "")}</div>
      <button type="button" disabled={!token || busy || isBootstrapping || Boolean(error)} onClick={enter} className="w-full rounded-xl bg-brand-teal px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? "Signing in…" : "Continue to OCS Care"}</button>
      <a href={CLINIC_TEL_HREF} className="block text-center text-sm font-semibold text-brand-teal">Contact OCS for help or a new link</a>
    </div>
  </PatientAuthShell>;
}
