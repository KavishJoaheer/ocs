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
    <div
      className="min-h-svh w-full min-w-0 max-w-[100vw] overflow-x-hidden bg-[radial-gradient(circle_at_top_right,_rgba(65,200,198,0.18),_transparent_24%),linear-gradient(180deg,_#f8fdfd_0%,_#edf8f8_100%)] px-4 py-8 text-slate-900 lg:px-8"
      style={{ paddingTop: `max(2rem, var(--sat))`, paddingBottom: `max(2rem, var(--sab))`, paddingLeft: `max(1rem, var(--sal))`, paddingRight: `max(1rem, var(--sar))` }}
    >
      <div className="mx-auto grid min-h-[calc(100svh-4rem)] w-full min-w-0 max-w-7xl gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        <section className="hidden min-h-[500px] w-full max-w-md flex-col justify-between rounded-[32px] bg-[#eef3f5] p-10 lg:flex">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <BrandMark maxWidth={220} size={36} />
            <p className="mt-3 text-base font-black tracking-tight text-[#065a60]">OCS VP</p>
          </div>

          <div className="my-auto py-6 text-center">
            <h1 className="text-3xl font-black leading-tight tracking-tight md:text-4xl">
              <span className="text-[#3b595c]">Step into a</span>{" "}
              <span className="block text-[#065a60]">practice of excellence</span>
            </h1>

            <p className="mx-auto mt-4 max-w-xs text-xs font-bold leading-relaxed tracking-wide text-[#3b595c]">
              Together, let&apos;s make a difference in healthcare
            </p>
          </div>

          <div className="h-6" />
        </section>

        <section
          className="rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,251,250,0.9))] p-6 shadow-[0_30px_80px_rgba(34,72,91,0.12)] lg:p-8"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
              Secure sign-in
            </p>
            <h2 className="mt-3 font-display text-3xl tracking-tight text-slate-950">
              Sign in with your assigned credentials
            </h2>
            <p className="mt-3 text-sm leading-7 text-[#496773]">
              Enter the username and password provided by admin to access your workspace.
            </p>
          </div>

          <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Username</span>
              <input
                required
                value={form.username}
                onChange={(event) =>
                  setForm((current) => ({ ...current, username: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
                placeholder="Enter your username"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <input
                required
                type="password"
                value={form.password}
                onChange={(event) =>
                  setForm((current) => ({ ...current, password: event.target.value }))
                }
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition focus:border-sky-400 focus:bg-white"
                placeholder="Enter your password"
              />
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-2xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => navigate("/welcome")}
              className="text-sm font-semibold text-[#2d8f98] transition-colors hover:text-[#22485b]"
            >
              ← Back to Home
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

export default LoginPage;
