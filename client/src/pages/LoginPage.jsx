import { useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import BrandMark from "../components/BrandMark.jsx";
import { useAuth } from "../hooks/useAuth.jsx";
import { canAccessPath, getDefaultPathForRole } from "../lib/access.js";

function LoginPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, isBootstrapping, login, user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  const attemptedPath = useMemo(
    () => location.state?.from?.pathname || "",
    [location.state],
  );

  if (!isBootstrapping && isAuthenticated && user) {
    const destination = canAccessPath(user.role, attemptedPath)
      ? attemptedPath
      : getDefaultPathForRole(user.role);

    return <Navigate to={destination} replace />;
  }

  function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);

    login(form)
      .then((signedInUser) => {
        const destination = canAccessPath(signedInUser.role, attemptedPath)
          ? attemptedPath
          : getDefaultPathForRole(signedInUser.role);

        toast.success(`Signed in as ${signedInUser.full_name}.`);
        navigate(destination, { replace: true });
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
      <div className="auth-canvas-panel auth-canvas-panel--staff md:w-1/2">
        <div className="auth-canvas-orb-teal" />
        <div className="auth-canvas-orb-amber" />

        <div className="auth-brand-header">
          <a href="/welcome" className="transition-opacity hover:opacity-90">
            <BrandMark maxWidth={280} size={52} />
            <span className="auth-sub-brand">Virtual Practice</span>
          </a>
        </div>

        <div className="auth-hero-body">
          <div className="auth-hero-row">
            <div className="auth-hero-copy">
              <div className="auth-headline-group">
                <div className="auth-accent-bar amber-banner-accent" aria-hidden="true" />
                <h1 className="auth-headline auth-headline--staff">
                  <span className="block">Step into a</span>
                  <span className="block auth-headline--staff-accent">Practice of</span>
                  <span className="block auth-headline--staff-accent">Excellence</span>
                </h1>
              </div>
              <p className="auth-tagline">
                Together, let&apos;s make a difference in healthcare
              </p>
            </div>
          </div>
        </div>

        <div className="auth-canvas-footer">
          DIGITAL HEADQUARTERS © {new Date().getFullYear()} OCS MÉDECINS
        </div>
      </div>

      {/* Right: secure entry portal */}
      <div className="auth-form-panel md:w-1/2">
        <div className="h-8" />

        <div className="auth-form-body mx-auto">
          <div className="auth-form-header">
            <span className="auth-form-pill">Protected Access Gateway</span>
            <h2 className="auth-form-title">Sign in with credentials</h2>
            <p className="auth-form-desc">
              Enter the administrative username and secure password provided by system
              operations to enter your custom workspace.
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div>
              <label
                htmlFor="login-username"
                className="mb-2 block text-[10px] font-black uppercase tracking-wider text-[#3b595c]"
              >
                Username
              </label>
              <input
                id="login-username"
                required
                type="text"
                value={form.username}
                onChange={(event) =>
                  setForm((current) => ({ ...current, username: event.target.value }))
                }
                placeholder="Enter your username"
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-[#14213d] placeholder:text-gray-400 transition-all focus:border-[#065a60] focus:outline-none focus:ring-4 focus:ring-[#065a60]/5"
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="mb-2 block text-[10px] font-black uppercase tracking-wider text-[#3b595c]"
              >
                Password
              </label>
              <input
                id="login-password"
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
              {isSubmitting ? "Signing in..." : "Sign in to Workspace"}
            </button>
          </form>

          <div className="mt-8 text-center">
            <button
              type="button"
              onClick={() => navigate("/welcome")}
              className="group inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 transition-colors hover:text-[#065a60]"
            >
              <span className="transform transition-transform duration-200 group-hover:-translate-x-0.5">
                ←
              </span>
              Back to Welcome Gateway
            </button>
          </div>
        </div>

        <div className="h-4" />
      </div>
    </div>
  );
}

export default LoginPage;
