import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";
import PatientAuthShell from "../components/auth/PatientAuthShell.jsx";

function PatientResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/patient-auth/reset-password", { token, new_password: password }, { skipAuth: true });
      toast.success("Password updated. Sign in with your new password.");
      navigate("/login", { replace: true });
    } catch (error) {
      toast.error(error.message || "This reset link is invalid or expired.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PatientAuthShell pill="Password reset" title="Choose a new password">
      {!token ? (
        <p className="text-sm text-[#5b7f8a]">This reset link is missing a token.</p>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label
              htmlFor="patient-reset-password"
              className="mb-2 block text-[10px] font-black uppercase tracking-wider text-[#3b595c]"
            >
              New password
            </label>
            <input
              id="patient-reset-password"
              required
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-[#14213d] placeholder:text-gray-400 transition-all focus:border-[#065a60] focus:outline-none focus:ring-4 focus:ring-[#065a60]/5"
            />
          </div>
          <div>
            <label
              htmlFor="patient-reset-confirm"
              className="mb-2 block text-[10px] font-black uppercase tracking-wider text-[#3b595c]"
            >
              Confirm password
            </label>
            <input
              id="patient-reset-confirm"
              required
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Confirm new password"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-[#14213d] placeholder:text-gray-400 transition-all focus:border-[#065a60] focus:outline-none focus:ring-4 focus:ring-[#065a60]/5"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="glow-teal-capsule mt-4 block w-full rounded-full bg-gradient-to-r from-[#1c4e52] to-[#123638] py-4 text-center text-xs font-black tracking-wide text-white shadow-[0_10px_25px_-5px_rgba(28,78,82,0.35)] transition-all duration-300 hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Saving..." : "Update password"}
          </button>
        </form>
      )}
      <Link to="/login" className="mt-8 inline-block text-xs font-bold text-[#065a60]">
        Back to sign in
      </Link>
    </PatientAuthShell>
  );
}

export default PatientResetPasswordPage;
