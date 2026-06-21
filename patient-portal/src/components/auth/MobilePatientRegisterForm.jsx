import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { usePatientAuth } from "../../hooks/usePatientAuth.jsx";
import { formatDisplayName } from "../../lib/formatDisplayName.js";

const STAFF_PORTAL_URL =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "https://staff.ocsvp.com/login"
    : "http://localhost:5173/login";

const INPUT_CLASS =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-[#14213d] placeholder:text-gray-400 transition-all focus:border-[#065a60] focus:outline-none focus:ring-4 focus:ring-[#065a60]/5";

const LABEL_CLASS =
  "mb-2 block text-[10px] font-black uppercase tracking-wider text-[#3b595c]";

const SECTION_CLASS =
  "text-[10px] font-extrabold uppercase tracking-widest text-[#065a60]";

function MobilePatientRegisterForm() {
  const navigate = useNavigate();
  const { register } = usePatientAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    phone: "",
    national_id: "",
    password: "",
    confirmPassword: "",
  });
  const [errors, setErrors] = useState({});

  function validate() {
    const newErrors = {};

    if (!form.full_name.trim()) newErrors.full_name = "Full name is required.";
    if (!form.email.trim()) newErrors.email = "Email is required.";
    if (!form.phone.trim()) newErrors.phone = "Phone number is required.";
    if (!form.national_id.trim()) {
      newErrors.national_id = "National ID is required to match your medical records.";
    }
    if (!form.password) newErrors.password = "Password is required.";
    if (form.password.length < 6) newErrors.password = "Password must be at least 6 characters.";
    if (form.password !== form.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match.";
    }

    setErrors(newErrors);

    if (newErrors.national_id) {
      toast.error(newErrors.national_id);
    }

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
      national_id: form.national_id.trim(),
      password: form.password,
    })
      .then((newUser) => {
        toast.success(`Welcome, ${formatDisplayName(newUser.full_name)}! Your account has been created.`);
        navigate("/dashboard", { replace: true });
      })
      .catch((error) => {
        toast.error(error.message);
      })
      .finally(() => {
        setIsSubmitting(false);
      });
  }

  function setField(field) {
    return (event) => {
      const value = event.target ? event.target.value : event;
      setForm((current) => ({ ...current, [field]: value }));
      if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    };
  }

  return (
    <div className="flex min-h-svh w-full min-w-0 max-w-[100vw] flex-col bg-white font-sans antialiased">
      <div className="border-b border-gray-100 px-[var(--native-pad-screen)] pb-5 pt-[max(1rem,var(--sat))]">
        <Link to="/login" className="inline-flex flex-col transition-opacity hover:opacity-90">
          <img src="/ocs-medecins-logo.png" alt="OCS Médecins" className="h-10 w-auto" />
          <span className="mt-2 text-[10px] font-bold uppercase tracking-[0.25em] text-[#065a60]">
            Patient Portal
          </span>
        </Link>
      </div>

      <div className="flex flex-1 flex-col px-[var(--native-pad-screen)] py-6">
        <div className="mb-6">
          <span className={SECTION_CLASS}>→ Create Patient Account</span>
          <h1 className="mt-1.5 text-2xl font-black tracking-tight text-[#14213d]">
            Create your patient account
          </h1>
          <p className="mt-2 text-xs font-medium leading-relaxed text-gray-500">
            Register with your personal details to access appointments, records, and billing.
          </p>
        </div>

        <form className="space-y-6" onSubmit={handleSubmit} noValidate>
          <div>
            <p className={SECTION_CLASS}>Personal information</p>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="mobile-register-full-name" className={LABEL_CLASS}>
                  Full name
                </label>
                <input
                  id="mobile-register-full-name"
                  value={form.full_name}
                  onChange={setField("full_name")}
                  placeholder="Enter your full name"
                  className={INPUT_CLASS}
                  autoComplete="name"
                />
                {errors.full_name ? (
                  <p className="mt-1.5 text-xs font-medium text-red-500">{errors.full_name}</p>
                ) : null}
              </div>

              <div>
                <label htmlFor="mobile-register-email" className={LABEL_CLASS}>
                  Email address
                </label>
                <input
                  id="mobile-register-email"
                  type="email"
                  value={form.email}
                  onChange={setField("email")}
                  placeholder="Enter your email address"
                  className={INPUT_CLASS}
                  autoComplete="email"
                />
                {errors.email ? (
                  <p className="mt-1.5 text-xs font-medium text-red-500">{errors.email}</p>
                ) : null}
              </div>

              <div>
                <label htmlFor="mobile-register-phone" className={LABEL_CLASS}>
                  Phone number
                </label>
                <input
                  id="mobile-register-phone"
                  type="tel"
                  value={form.phone}
                  onChange={setField("phone")}
                  placeholder="Enter your phone number"
                  className={INPUT_CLASS}
                  autoComplete="tel"
                />
                {errors.phone ? (
                  <p className="mt-1.5 text-xs font-medium text-red-500">{errors.phone}</p>
                ) : null}
              </div>

              <div>
                <label htmlFor="mobile-register-national-id" className={LABEL_CLASS}>
                  National ID number <span className="text-[#065a60]">*</span>
                </label>
                <input
                  id="mobile-register-national-id"
                  value={form.national_id}
                  onChange={setField("national_id")}
                  placeholder="e.g. your government-issued NIC"
                  className={INPUT_CLASS}
                  autoComplete="off"
                  required
                />
                {errors.national_id ? (
                  <p className="mt-1.5 text-xs font-medium text-red-500">{errors.national_id}</p>
                ) : null}
                <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
                  Enter your government-issued ID to help us match your clinic record. This is{" "}
                  <span className="font-semibold text-[#14213d]">not</span> your OCS care number.
                </p>
              </div>
            </div>
          </div>

          <div>
            <p className={SECTION_CLASS}>Create your password</p>
            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="mobile-register-password" className={LABEL_CLASS}>
                  Password
                </label>
                <input
                  id="mobile-register-password"
                  type="password"
                  value={form.password}
                  onChange={setField("password")}
                  placeholder="Enter your password"
                  className={INPUT_CLASS}
                  autoComplete="new-password"
                />
                {errors.password ? (
                  <p className="mt-1.5 text-xs font-medium text-red-500">{errors.password}</p>
                ) : null}
              </div>

              <div>
                <label htmlFor="mobile-register-confirm-password" className={LABEL_CLASS}>
                  Confirm password
                </label>
                <input
                  id="mobile-register-confirm-password"
                  type="password"
                  value={form.confirmPassword}
                  onChange={setField("confirmPassword")}
                  placeholder="Confirm your password"
                  className={INPUT_CLASS}
                  autoComplete="new-password"
                />
                {errors.confirmPassword ? (
                  <p className="mt-1.5 text-xs font-medium text-red-500">{errors.confirmPassword}</p>
                ) : null}
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="glow-teal-capsule mt-2 block w-full rounded-full bg-gradient-to-r from-[#1c4e52] to-[#123638] py-4 text-center text-xs font-black tracking-wide text-white shadow-[0_10px_25px_-5px_rgba(28,78,82,0.35)] transition-all duration-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            style={{ minHeight: 48 }}
          >
            {isSubmitting ? "Creating account..." : "Create Patient Account"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 transition-colors hover:text-[#065a60]"
          >
            <span aria-hidden="true">←</span>
            Already have an account? Sign in
          </Link>
        </div>

        <div className="mt-6 pb-[max(1rem,var(--sab))] text-center">
          <a
            href={STAFF_PORTAL_URL}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 transition-colors hover:text-[#065a60]"
          >
            Staff member? Sign in to staff portal
          </a>
        </div>
      </div>
    </div>
  );
}

export default MobilePatientRegisterForm;
