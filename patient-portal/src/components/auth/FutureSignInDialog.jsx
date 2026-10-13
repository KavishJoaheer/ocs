import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { useScrollLock } from "../../hooks/useScrollLock.js";

export default function FutureSignInDialog({ onSetup, onSkip, onClose }) {
  const [settingUp, setSettingUp] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", confirm_password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef(null);
  const emailInput = useRef(null);
  const headingId = useId();
  const descriptionId = useId();
  useFocusTrap(true, panel);
  useScrollLock(true);
  useEffect(() => {
    if (settingUp) emailInput.current?.focus();
  }, [settingUp]);
  useEffect(() => {
    function escape(event) { if (event.key === "Escape" && !busy) onClose(); }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);
  async function skip() {
    if (busy) return;
    setBusy(true); setError("");
    try { await onSkip(); }
    catch (err) { setError(err.message || "Could not sign out. Please try again."); setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault(); if (busy) return;
    if (form.password !== form.confirm_password) { setError("The passwords do not match."); return; }
    setBusy(true); setError("");
    try { await onSetup(form); }
    catch (err) { setError(err.message || "Could not save your sign-in details. You are still signed in."); setBusy(false); }
  }
  const primary = "min-h-11 w-full rounded-xl bg-brand-teal px-4 py-3 text-sm font-semibold text-white disabled:opacity-50";
  const secondary = "min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50";
  const field = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900";
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId} tabIndex={-1} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 sm:p-6">
        <h2 id={headingId} className="text-xl font-semibold text-slate-900">{settingUp ? "Set up future sign-in" : "Before you sign out"}</h2>
        <p id={descriptionId} className="mt-3 text-sm leading-relaxed text-slate-600">{settingUp ? "Add an email address you control and choose your own password. We will save them before signing you out." : "Would you like to choose an email and password so you can sign in next time without requesting another link from OCS?"}</p>
        {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {settingUp ? <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block text-sm font-medium text-slate-800">Email address<input ref={emailInput} type="email" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} value={form.email} onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} disabled={busy} className={field} /></label>
          <label className="block text-sm font-medium text-slate-800">Choose a password<input type="password" required minLength={8} maxLength={1024} autoComplete="new-password" value={form.password} onChange={e => setForm(prev => ({ ...prev, password: e.target.value }))} disabled={busy} className={field} /><span className="mt-1 block text-xs text-slate-500">At least 8 characters. Keep your password private.</span></label>
          <label className="block text-sm font-medium text-slate-800">Confirm your password<input type="password" required minLength={8} maxLength={1024} autoComplete="new-password" value={form.confirm_password} onChange={e => setForm(prev => ({ ...prev, confirm_password: e.target.value }))} disabled={busy} className={field} /></label>
          <button type="submit" disabled={busy} className={primary}>{busy ? "Saving…" : "Save & sign out"}</button>
          <button type="button" disabled={busy} onClick={skip} className={secondary}>Sign out for now</button>
          <p className="text-xs leading-relaxed text-slate-500">If you skip setup, ask OCS for a new magic link next time.</p>
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 w-full text-sm font-semibold text-brand-teal disabled:opacity-50">Stay signed in</button>
        </form> : <div className="mt-5 space-y-3">
          <button type="button" disabled={busy} onClick={() => { setSettingUp(true); setError(""); }} className={primary}>Set up future sign-in</button>
          <button type="button" disabled={busy} onClick={skip} className={secondary}>{busy ? "Signing out…" : "Sign out for now"}</button>
          <p className="text-xs leading-relaxed text-slate-500">If you skip setup, ask OCS for a new magic link next time.</p>
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 w-full text-sm font-semibold text-brand-teal disabled:opacity-50">Stay signed in</button>
        </div>}
      </section>
    </div>, document.body,
  );
}
