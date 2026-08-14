import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import PatientAuthShell from "../components/auth/PatientAuthShell.jsx";

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
    <PatientAuthShell pill="Password reset" title="Reset your password">
      {sent ? (
        <p className="text-sm leading-relaxed text-[#5b7f8a]">
          If an OCS Care account exists for that email, we sent a reset link. Check your inbox
          (and spam) and follow the link within one hour.
        </p>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="patient-forgot-email"
              className="mb-2 block text-[10px] font-black uppercase tracking-wider text-[#3b595c]"
            >
              Email address
            </label>
            <input
              id="patient-forgot-email"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email address"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-[#14213d] placeholder:text-gray-400 transition-all focus:border-[#065a60] focus:outline-none focus:ring-4 focus:ring-[#065a60]/5"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="glow-teal-capsule mt-4 block w-full rounded-full bg-gradient-to-r from-[#1c4e52] to-[#123638] py-4 text-center text-xs font-black tracking-wide text-white shadow-[0_10px_25px_-5px_rgba(28,78,82,0.35)] transition-all duration-300 hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}
      <Link to="/login" className="mt-8 inline-block text-xs font-bold text-[#065a60]">
        Back to sign in
      </Link>
    </PatientAuthShell>
  );
}

export default PatientForgotPasswordPage;
