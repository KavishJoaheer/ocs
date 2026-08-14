import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";

function PatientForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/patient-auth/forgot-password", { email }, { skipAuth: true });
      setSent(true);
    } catch (error) {
      toast.error(error.message || "Could not send a reset email.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-white px-6">
      <div className="w-full max-w-md">
        <h1 className="font-display text-3xl text-[#1a5c52]">Reset your password</h1>
        {sent ? (
          <p className="mt-4 text-sm leading-relaxed text-[#5b7f8a]">
            If an OCS Care account exists for that email, we sent a reset link. Check your inbox
            (and spam) and follow the link within one hour.
          </p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Email address"
              className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-sm"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full bg-[#123638] py-4 text-xs font-black tracking-wide text-white disabled:opacity-60"
            >
              {submitting ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}
        <Link to="/login" className="mt-6 inline-block text-xs font-bold text-[#065a60]">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default PatientForgotPasswordPage;
