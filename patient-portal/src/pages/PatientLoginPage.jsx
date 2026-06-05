import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { LogIn, Mail, Lock, ArrowRight, Shield, Heart, Star } from "lucide-react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";

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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(65,200,198,0.18),_transparent_24%),linear-gradient(180deg,_#f8fdfd_0%,_#edf8f8_100%)] px-4 py-8 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-center">
        {/* ─── Left: Branding ─── */}
        <section className="relative overflow-hidden rounded-[42px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(236,246,247,0.94))] p-5 shadow-[0_36px_90px_rgba(34,72,91,0.16)] lg:p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.62),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(65,200,198,0.08),transparent_22%)]" />

          <div className="relative z-10 rounded-[36px] border border-[rgba(255,255,255,0.72)] bg-[linear-gradient(180deg,#dfe8ea_0%,#d4dde0_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.56)] lg:p-7">
            <div className="rounded-[20px] border border-[rgba(65,200,198,0.14)] bg-white/94 px-4 py-4 shadow-[0_16px_34px_rgba(34,72,91,0.12)]">
              <img
                src="/ocs-medecins-logo.png"
                alt="OCS Médecins"
                className="h-14 w-auto"
              />
              <p className="mt-3 text-[1.35rem] font-medium italic tracking-[0.02em] text-[#2d5f69] sm:text-[1.55rem]">
                Patient Portal
              </p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-[0.94fr_1.06fr]">
              <div className="rounded-[30px] border border-[rgba(65,200,198,0.18)] bg-[rgba(226,234,236,0.88)] p-6 shadow-[0_16px_34px_rgba(34,72,91,0.08)]">
                <p className="text-[1.65rem] font-semibold leading-[1.15] tracking-tight text-slate-950 sm:text-[2rem]">
                  Welcome to the <span className="text-[#f1bc35]">Patient Portal</span>, your health hub.
                </p>
              </div>

              <div className="rounded-[30px] border border-[rgba(45,143,152,0.2)] bg-[linear-gradient(180deg,#5f8690_0%,#537781_100%)] p-6 shadow-[0_18px_40px_rgba(34,72,91,0.16)]">
                <p className="text-[1.65rem] font-semibold leading-[1.14] tracking-tight text-slate-950 sm:text-[1.95rem]">
                  Your care, at your fingertips.
                </p>
                <p className="mt-4 text-[1.55rem] font-medium italic leading-[1.12] text-[#ffd24a] sm:text-[1.9rem]">
                  Stay connected with your health.
                </p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { icon: Shield, label: "Secure", desc: "Data encrypted" },
                { icon: Heart, label: "Personal", desc: "Your records" },
                { icon: Star, label: "24/7", desc: "Always available" },
              ].map(({ icon: Icon, label, desc }) => (
                <div
                  key={label}
                  className="rounded-[20px] border border-[rgba(65,200,198,0.18)] bg-white/90 px-3 py-4 text-center shadow-[0_8px_24px_rgba(34,72,91,0.06)]"
                >
                  <Icon className="mx-auto size-5 text-[#2d8f98]" />
                  <p className="mt-2 text-sm font-bold text-[#22485b]">{label}</p>
                  <p className="mt-0.5 text-xs text-[#5b7f8a]">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Right: Login form ─── */}
        <section className="rounded-[34px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,251,250,0.9))] p-6 shadow-[0_30px_80px_rgba(34,72,91,0.12)] lg:p-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(65,200,198,0.2)] bg-[rgba(65,200,198,0.08)] px-3 py-1.5">
              <LogIn className="size-3.5 text-[#2d8f98]" />
              <span className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
                Patient sign-in
              </span>
            </div>
            <h2 className="mt-4 font-display text-3xl tracking-tight text-slate-950">
              Access your health portal
            </h2>
            <p className="mt-3 text-sm leading-7 text-[#496773]">
              Sign in with your registered email and password to view appointments, billing, and more.
            </p>
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Email address</span>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                  placeholder="you@example.com"
                />
              </div>
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Password</span>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
                <input
                  required
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((c) => ({ ...c, password: e.target.value }))}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                  placeholder="Enter your password"
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[rgba(45,143,152,0.22)] transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 space-y-4">
            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-[rgba(65,200,198,0.2)]" />
              <span className="text-xs font-semibold text-[#6e949b]">NEW HERE?</span>
              <div className="h-px flex-1 bg-[rgba(65,200,198,0.2)]" />
            </div>
            <Link
              to="/register"
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[rgba(65,200,198,0.28)] bg-[rgba(65,200,198,0.06)] px-4 py-3 text-sm font-semibold text-[#2d8f98] transition hover:bg-[rgba(65,200,198,0.12)]"
            >
              Create your patient account
              <ArrowRight className="size-4" />
            </Link>
          </div>

          <p className="mt-6 text-center text-xs text-[#6e949b]">
            Staff member?{" "}
            <a
              href="http://localhost:5173"
              className="font-semibold text-[#2d8f98] underline decoration-[rgba(65,200,198,0.4)] underline-offset-2 transition hover:text-[#277f88]"
            >
              Sign in to staff portal
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}

export default PatientLoginPage;
