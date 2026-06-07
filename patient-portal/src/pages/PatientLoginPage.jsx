import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";

const STAFF_PORTAL_URL =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "https://ocsvp.com/login"
    : "http://localhost:5173/login";

function PatientLoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isBootstrapping, login } = usePatientAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  if (!isBootstrapping && isAuthenticated) {
    const destination = location.state?.from?.pathname || "/";
    return <Navigate to={destination} replace />;
  }

  function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);

    login(form)
      .then((signedInUser) => {
        toast.success(`Welcome back, ${signedInUser.full_name}!`);
        navigate(location.state?.from?.pathname || "/", { replace: true });
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
      {/* Left: brand canvas */}
      <div className="relative flex w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-[#f4fbfb] via-[#ebf6f6] to-[#dceeee] p-12 md:w-1/2 lg:p-16">
        <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-[#2bccc4]/15 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-[#f7ba24]/10 blur-[100px]" />

        <div className="relative z-10 flex flex-col items-start">
          <div className="transition-opacity hover:opacity-90">
            <img
              src="/ocs-medecins-logo.png"
              alt="OCS Médecins"
              className="h-[52px] w-auto max-w-[280px]"
            />
            <span className="mt-3 block text-xs font-bold uppercase tracking-[0.25em] text-[#065a60]">
              Patient Portal
            </span>
          </div>
        </div>

        <div className="relative z-10 flex flex-1 flex-col justify-center py-10 lg:py-14">
          <div className="flex max-w-xl gap-5 lg:gap-6">
            <div
              className="amber-banner-accent w-1.5 shrink-0 self-stretch rounded-full bg-gradient-to-b from-[#f7ba24] to-[#e0a112]"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h1 className="text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl xl:text-[4.25rem]">
                <span className="block text-[#3b595c]">Your Health.</span>
                <span className="block text-[#3b595c]">
                  <span className="text-[#f7ba24]">Seamlessly</span> Managed.
                </span>
              </h1>
              <p className="mt-6 max-w-lg text-base font-semibold leading-relaxed tracking-wide text-[#065a60] sm:text-lg lg:mt-8 lg:text-xl">
                Premium care, always within reach
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-[10px] font-medium tracking-wider text-[#3b595c]/45">
          PATIENT HEALTH HUB © {new Date().getFullYear()} OCS MÉDECINS
        </div>
      </div>

      {/* Right: secure entry portal */}
      <div className="flex w-full flex-col justify-between bg-white p-12 md:w-1/2 lg:p-16">
        <div className="h-8" />

        <div className="mx-auto my-auto w-full max-w-sm py-4">
          <div className="mb-8">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#065a60]">
              → Secure Patient Access
            </span>
            <h2 className="mt-1.5 text-2xl font-black tracking-tight text-[#14213d]">
              Sign in to your health portal
            </h2>
            <p className="mt-2 text-xs font-medium leading-relaxed text-gray-500">
              Enter your registered email and password to view appointments, records, and
              billing in one secure place.
            </p>
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
              {isSubmitting ? "Signing in..." : "Sign in to Portal"}
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
