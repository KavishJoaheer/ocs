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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(65,200,198,0.18),_transparent_24%),linear-gradient(180deg,_#f8fdfd_0%,_#edf8f8_100%)] px-4 py-8 text-slate-900 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        <section className="relative overflow-hidden rounded-[42px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(236,246,247,0.94))] p-5 shadow-[0_36px_90px_rgba(34,72,91,0.16)] lg:p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.62),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(65,200,198,0.08),transparent_22%)]" />

          <div className="relative z-10 rounded-[36px] border border-[rgba(255,255,255,0.72)] bg-[linear-gradient(180deg,#dfe8ea_0%,#d4dde0_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.56)] lg:p-7">
            <div className="rounded-[20px] border border-[rgba(65,200,198,0.14)] bg-white/94 px-4 py-4 shadow-[0_16px_34px_rgba(34,72,91,0.12)]">
              <BrandMark maxWidth={264} size={58} />
              <p className="mt-3 text-[1.35rem] font-medium italic tracking-[0.02em] text-[#2d5f69] sm:text-[1.55rem]">
                Virtual Practice
              </p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-[0.94fr_1.06fr]">
              <div className="rounded-[30px] border border-[rgba(65,200,198,0.18)] bg-[rgba(226,234,236,0.88)] p-6 shadow-[0_16px_34px_rgba(34,72,91,0.08)]">
                <p className="text-[1.65rem] font-semibold leading-[1.15] tracking-tight text-slate-950 sm:text-[2rem]">
                  Welcome to the <span className="text-[#f1bc35]">OCS VP</span>, our new digital headquarters.
                </p>
              </div>

              <div className="rounded-[30px] border border-[rgba(45,143,152,0.2)] bg-[linear-gradient(180deg,#5f8690_0%,#537781_100%)] p-6 shadow-[0_18px_40px_rgba(34,72,91,0.16)]">
                <p className="text-[1.65rem] font-semibold leading-[1.14] tracking-tight text-slate-950 sm:text-[1.95rem]">
                  Step into a practice of excellence.
                </p>
                <p className="mt-4 text-[1.55rem] font-medium italic leading-[1.12] text-[#ffd24a] sm:text-[1.9rem]">
                  Together, let&apos;s make a difference.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,251,250,0.9))] p-6 shadow-[0_30px_80px_rgba(34,72,91,0.12)] lg:p-8">
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
        </section>
      </div>
    </div>
  );
}

export default LoginPage;
