import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";

const STAFF_PORTAL_URL =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "https://staff.ocsvp.com/login"
    : "http://localhost:5173/login";

function PatientLoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isBootstrapping, login } = usePatientAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  if (!isBootstrapping && isAuthenticated) {
    const destination = location.state?.from?.pathname || "/dashboard";
    return <Navigate to={destination} replace />;
  }

  function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);

    login(form)
      .then((signedInUser) => {
        toast.success(`Welcome back, ${signedInUser.full_name}!`);
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
    <div className="flex min-h-svh w-full min-w-0 max-w-[100vw] flex-col overflow-hidden bg-white font-sans antialiased md:flex-row">
      {/* Left: brand canvas — 1:1 staff portal skeleton */}
      <div className="auth-canvas-panel auth-canvas-panel--patient md:w-1/2">
        <div className="auth-canvas-orb-teal" />
        <div className="auth-canvas-orb-amber" />

        <div className="auth-brand-header">
          <Link to="/login" className="transition-opacity hover:opacity-90">
            <span className="auth-logo-frame">
              <img src="/ocs-medecins-logo.png" alt="OCS Médecins" />
            </span>
            <span className="auth-sub-brand auth-sub-brand--patient">OCS Care</span>
          </Link>
        </div>

        <div className="auth-hero-body">
          <div className="auth-hero-row">
            <div className="auth-hero-copy">
              <div className="auth-headline-group">
                <div className="auth-accent-bar amber-banner-accent" aria-hidden="true" />
                <h1 className="auth-headline auth-headline--staff">
                  <span className="block">Your Health.</span>
                  <span className="block">Experienced</span>
                  <span className="block">differently.</span>
                </h1>
              </div>
              <p className="auth-tagline">
                Every visit, every record, every moment of care — safely organised with the same heart we bring to your door.
              </p>
            </div>
          </div>
        </div>

        <div className="auth-canvas-footer">
          PATIENT HEALTH HUB © {new Date().getFullYear()} OCS MÉDECINS
        </div>
      </div>

      {/* Right: secure entry portal */}
      <div className="auth-form-panel md:w-1/2">
        <div className="h-8" />

        <div className="auth-form-body mx-auto">
          <div className="auth-form-header">
            <span className="auth-form-pill">Your Care Space</span>
            <h2 className="auth-form-title">Sign in to access your health records</h2>
          </div>

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
        </div>

        <div className="text-center">
          <a
            href={STAFF_PORTAL_URL}
            className="group inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 transition-colors hover:text-[#065a60]"
          >
            Staff member? Sign in to staff portal
          </a>
        </div>
      </div>
    </div>
  );
}

export default PatientLoginPage;
