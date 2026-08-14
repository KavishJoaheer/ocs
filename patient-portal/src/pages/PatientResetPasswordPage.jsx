import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api.js";

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
    <div className="flex min-h-svh items-center justify-center bg-white px-6">
      <div className="w-full max-w-md">
        <h1 className="font-display text-3xl text-[#1a5c52]">Choose a new password</h1>
        {!token ? (
          <p className="mt-4 text-sm text-[#5b7f8a]">This reset link is missing a token.</p>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <input
              required
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-sm"
            />
            <input
              required
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Confirm new password"
              className="w-full rounded-xl border border-gray-200 px-4 py-3.5 text-sm"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full bg-[#123638] py-4 text-xs font-black tracking-wide text-white disabled:opacity-60"
            >
              {submitting ? "Saving..." : "Update password"}
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

export default PatientResetPasswordPage;
