import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { formatDisplayName } from "../lib/formatDisplayName.js";
import PatientAuthShell from "../components/auth/PatientAuthShell.jsx";

function PatientLoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isBootstrapping, login } = usePatientAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({ email: location.state?.setupComplete ? location.state.email || "" : "", password: "" });

  if (!isBootstrapping && isAuthenticated) {
    const destination = location.state?.from?.pathname || "/dashboard";
    return <Navigate to={destination} replace />;
  }

  function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);

    login(form)
      .then((signedInUser) => {
        toast.success(`Welcome back, ${formatDisplayName(signedInUser.full_name)}!`);
        navigate(location.state?.from?.pathname || "/dashboard", { replace: true });
      })
      .catch((error) => {
        toast.error(error.message);
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  return (
    <PatientAuthShell
      title="Sign in to access your health records"
      showStaffLink
    >
      {location.state?.setupComplete && <p role="status" className="mb-5 rounded-xl bg-teal-50 p-4 text-sm leading-relaxed text-teal-900">Your sign-in is ready. Next time, use your email and the password you chose. You are now signed out.</p>}
      {location.state?.magicLinkRequired && <p role="status" className="mb-5 rounded-xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">You are signed out. To return without a password, contact OCS for a new personal sign-in link.</p>}
      <form className="space-y-6" onSubmit={handleSubmit}>
        <div>
          <label
            htmlFor="patient-login-email"
            className="mb-2 block text-[10px] font-black uppercase tracking-wider text-[#3b595c]"
          >
            Email address
          </label>
          <input
            id="patient-login-email"
            required
            type="email"
            value={form.email}
            onChange={(event) =>
              setForm((current) => ({ ...current, email: event.target.value }))
            }
            placeholder="Enter your email address"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-[#14213d] placeholder:text-gray-400 transition-all focus:border-[#065a60] focus:outline-none focus:ring-4 focus:ring-[#065a60]/5"
          />
        </div>

        <div>
          <label
            htmlFor="patient-login-password"
            className="mb-2 block text-[10px] font-black uppercase tracking-wider text-[#3b595c]"
          >
            Password
          </label>
          <input
            id="patient-login-password"
            required
            type="password"
            value={form.password}
            onChange={(event) =>
              setForm((current) => ({ ...current, password: event.target.value }))
            }
            placeholder="Enter your password"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-[#14213d] placeholder:text-gray-400 transition-all focus:border-[#065a60] focus:outline-none focus:ring-4 focus:ring-[#065a60]/5"
          />
        </div>

        <div className="text-right">
          <Link to="/forgot-password" className="text-xs font-bold text-[#065a60]">
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="glow-teal-capsule mt-8 block w-full rounded-full bg-gradient-to-r from-[#1c4e52] to-[#123638] py-4 text-center text-xs font-black tracking-wide text-white shadow-[0_10px_25px_-5px_rgba(28,78,82,0.35)] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_15px_30px_-5px_rgba(28,78,82,0.5)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Signing in..." : "Sign in to OCS Care"}
        </button>
      </form>

      <div className="mt-8 text-center">
        <Link
          to="/register"
          className="group inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 transition-colors hover:text-[#065a60]"
        >
          New here? Create your patient account
          <span className="transform transition-transform duration-200 group-hover:translate-x-0.5">
            →
          </span>
        </Link>
      </div>
    </PatientAuthShell>
  );
}

export default PatientLoginPage;
