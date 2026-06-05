import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  UserPlus,
  Mail,
  Lock,
  User,
  Phone,
  Calendar,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Shield,
} from "lucide-react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";

function PatientRegisterPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isBootstrapping, register } = usePatientAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    date_of_birth: "",
    gender: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState({});

  if (!isBootstrapping && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  function validate() {
    const newErrors = {};

    if (!form.full_name.trim()) newErrors.full_name = "Full name is required.";
    if (!form.email.trim()) newErrors.email = "Email is required.";
    if (!form.phone.trim()) newErrors.phone = "Phone number is required.";
    if (!form.date_of_birth) newErrors.date_of_birth = "Date of birth is required.";
    if (!form.gender) newErrors.gender = "Please select your gender.";
    if (!form.password) newErrors.password = "Password is required.";
    if (form.password.length < 6) newErrors.password = "Password must be at least 6 characters.";
    if (form.password !== form.confirmPassword) newErrors.confirmPassword = "Passwords do not match.";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);

    register({
      full_name: form.full_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      date_of_birth: form.date_of_birth,
      gender: form.gender,
      password: form.password,
    })
      .then((newUser) => {
        toast.success(`Welcome, ${newUser.full_name}! Your account has been created.`);
        navigate("/", { replace: true });
      })
      .catch((error) => {
        toast.error(error.message);
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  function setField(field) {
    return (e) => {
      const value = e.target ? e.target.value : e;
      setForm((c) => ({ ...c, [field]: value }));
      if (errors[field]) setErrors((c) => ({ ...c, [field]: undefined }));
    };
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(65,200,198,0.18),_transparent_24%),linear-gradient(180deg,_#f8fdfd_0%,_#edf8f8_100%)] px-4 py-8 lg:px-8">
      <div className="mx-auto max-w-3xl">
        {/* Back link */}
        <Link
          to="/login"
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-[rgba(65,200,198,0.2)] bg-white/80 px-4 py-2 text-sm font-semibold text-[#2d8f98] backdrop-blur transition hover:bg-white"
        >
          <ArrowLeft className="size-4" />
          Back to sign in
        </Link>

        <div className="rounded-[42px] border border-[rgba(65,200,198,0.16)] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,251,250,0.9))] p-6 shadow-[0_36px_90px_rgba(34,72,91,0.16)] sm:p-8 lg:p-10">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="rounded-2xl bg-[linear-gradient(135deg,#41c8c6,#2d8f98)] p-3 shadow-lg shadow-[rgba(45,143,152,0.22)]">
              <UserPlus className="size-6 text-white" />
            </div>
            <div>
              <h1 className="font-display text-2xl tracking-tight text-slate-950 sm:text-3xl">
                Create your patient account
              </h1>
              <p className="mt-2 text-sm leading-7 text-[#496773]">
                Join OCS Médecins to access your health records, appointments, and billing.
              </p>
            </div>
          </div>

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            {/* Personal info section */}
            <div className="rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-white/60 p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <User className="size-4 text-[#2d8f98]" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
                  Personal information
                </h2>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                {/* Full Name */}
                <div className="space-y-2 sm:col-span-2">
                  <label className="text-sm font-semibold text-slate-700">Full name</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
                    <input
                      value={form.full_name}
                      onChange={setField("full_name")}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                      placeholder="Jean-Pierre Dupont"
                    />
                  </div>
                  {errors.full_name && <p className="text-xs font-medium text-red-500">{errors.full_name}</p>}
                </div>

                {/* Email */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
                    <input
                      type="email"
                      value={form.email}
                      onChange={setField("email")}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                      placeholder="you@example.com"
                    />
                  </div>
                  {errors.email && <p className="text-xs font-medium text-red-500">{errors.email}</p>}
                </div>

                {/* Phone */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Phone number</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
                    <input
                      type="tel"
                      value={form.phone}
                      onChange={setField("phone")}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                      placeholder="+230 5XXX XXXX"
                    />
                  </div>
                  {errors.phone && <p className="text-xs font-medium text-red-500">{errors.phone}</p>}
                </div>

                {/* Date of Birth */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Date of birth</label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
                    <input
                      type="date"
                      value={form.date_of_birth}
                      onChange={setField("date_of_birth")}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                    />
                  </div>
                  {errors.date_of_birth && <p className="text-xs font-medium text-red-500">{errors.date_of_birth}</p>}
                </div>

                {/* Gender */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Gender</label>
                  <div className="flex gap-3">
                    {[
                      { value: "M", label: "Male" },
                      { value: "F", label: "Female" },
                    ].map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => { setField("gender")(value); }}
                        className={[
                          "flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition",
                          form.gender === value
                            ? "border-[rgba(45,143,152,0.5)] bg-[rgba(65,200,198,0.12)] text-[#2d8f98] shadow-[0_4px_12px_rgba(45,143,152,0.1)]"
                            : "border-slate-200 bg-slate-50 text-slate-600 hover:border-[rgba(65,200,198,0.3)] hover:bg-white",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {errors.gender && <p className="text-xs font-medium text-red-500">{errors.gender}</p>}
                </div>
              </div>
            </div>

            {/* Security section */}
            <div className="rounded-[28px] border border-[rgba(65,200,198,0.14)] bg-white/60 p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-[#2d8f98]" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]">
                  Create your password
                </h2>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
                    <input
                      type="password"
                      value={form.password}
                      onChange={setField("password")}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                      placeholder="Min. 6 characters"
                    />
                  </div>
                  {errors.password && <p className="text-xs font-medium text-red-500">{errors.password}</p>}
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Confirm password</label>
                  <div className="relative">
                    <CheckCircle2 className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
                    <input
                      type="password"
                      value={form.confirmPassword}
                      onChange={setField("confirmPassword")}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-11 pr-4 outline-none transition focus:border-sky-400 focus:bg-white"
                      placeholder="Repeat password"
                    />
                  </div>
                  {errors.confirmPassword && <p className="text-xs font-medium text-red-500">{errors.confirmPassword}</p>}
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[rgba(45,143,152,0.22)] transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Creating account...
                </>
              ) : (
                <>
                  Create account
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-[#6e949b]">
            Already have an account?{" "}
            <Link
              to="/login"
              className="font-semibold text-[#2d8f98] underline decoration-[rgba(65,200,198,0.4)] underline-offset-2 transition hover:text-[#277f88]"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default PatientRegisterPage;
