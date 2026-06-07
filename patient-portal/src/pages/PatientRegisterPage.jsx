import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";

const STAFF_PORTAL_URL =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "https://ocsvp.com/login"
    : "http://localhost:5173/login";

const INPUT_CLASS =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-sm font-medium text-[#14213d] placeholder:text-gray-400 transition-all focus:border-[#065a60] focus:outline-none focus:ring-4 focus:ring-[#065a60]/5";

const LABEL_CLASS =
  "mb-2 block text-[10px] font-black uppercase tracking-wider text-[#3b595c]";

const SECTION_CLASS =
  "text-[10px] font-extrabold uppercase tracking-widest text-[#065a60]";

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
    if (form.password !== form.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match.";
    }

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
    return (event) => {
      const value = event.target ? event.target.value : event;
      setForm((current) => ({ ...current, [field]: value }));
      if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
    };
  }

  return (
    <div className="flex min-h-svh w-full min-w-0 max-w-[100vw] flex-col overflow-hidden bg-white font-sans antialiased md:flex-row">
      {/* Left: brand canvas */}
      <div className="relative flex w-full shrink-0 flex-col justify-between overflow-hidden bg-gradient-to-br from-[#f4fbfb] via-[#ebf6f6] to-[#dceeee] p-12 md:sticky md:top-0 md:h-svh md:w-1/2 lg:p-16">
        <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-[#2bccc4]/15 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-[#f7ba24]/10 blur-[100px]" />

        <div className="relative z-10 flex flex-col items-start">
          <Link to="/login" className="transition-opacity hover:opacity-90">
            <img
              src="/ocs-medecins-logo.png"
              alt="OCS Médecins"
              className="h-[52px] w-auto max-w-[280px]"
            />
            <span className="mt-3 block text-xs font-bold uppercase tracking-[0.25em] text-[#065a60]">
              Patient Portal
            </span>
          </Link>
        </div>

        <div className="relative z-10 flex flex-1 flex-col justify-center py-10 lg:py-14">
          <div className="flex max-w-xl gap-5 lg:gap-6">
            <div
              className="amber-banner-accent w-1.5 shrink-0 self-stretch rounded-full bg-gradient-to-b from-[#f7ba24] to-[#e0a112]"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h1 className="text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl xl:text-[4.25rem]">
                <span className="block text-[#3b595c]">Premium Care</span>
                <span className="block text-[#3b595c]">
                  at Your <span className="text-[#f7ba24]">Doorstep.</span>
                </span>
              </h1>
              <p className="mt-6 max-w-lg text-base font-semibold leading-relaxed tracking-wide text-[#065a60] sm:text-lg lg:mt-8 lg:text-xl">
                Join OCS Médecins to manage your health in one secure place
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-10 text-[10px] font-medium tracking-wider text-[#3b595c]/45">
          PATIENT HEALTH HUB © {new Date().getFullYear()} OCS MÉDECINS
        </div>
      </div>

      {/* Right: registration form */}
      <div className="flex w-full flex-col bg-white md:w-1/2 md:overflow-y-auto">
        <div className="flex min-h-svh flex-col justify-between p-12 lg:p-16">
          <div className="h-8" />

          <div className="mx-auto my-auto w-full max-w-sm py-4">
            <div className="mb-8">
              <span className={SECTION_CLASS}>→ Create Patient Account</span>
              <h2 className="mt-1.5 text-2xl font-black tracking-tight text-[#14213d]">
                Create your patient account
              </h2>
              <p className="mt-2 text-xs font-medium leading-relaxed text-gray-500">
                Register with your personal details to access appointments, records, and
                billing through the patient portal.
              </p>
            </div>

            <form className="space-y-6" onSubmit={handleSubmit}>
              <div>
                <p className={SECTION_CLASS}>Personal information</p>
                <div className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="register-full-name" className={LABEL_CLASS}>
                      Full name
                    </label>
                    <input
                      id="register-full-name"
                      value={form.full_name}
                      onChange={setField("full_name")}
                      placeholder="Enter your full name"
                      className={INPUT_CLASS}
                    />
                    {errors.full_name && (
                      <p className="mt-1.5 text-xs font-medium text-red-500">{errors.full_name}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="register-email" className={LABEL_CLASS}>
                      Email address
                    </label>
                    <input
                      id="register-email"
                      type="email"
                      value={form.email}
                      onChange={setField("email")}
                      placeholder="Enter your email address"
                      className={INPUT_CLASS}
                    />
                    {errors.email && (
                      <p className="mt-1.5 text-xs font-medium text-red-500">{errors.email}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="register-phone" className={LABEL_CLASS}>
                      Phone number
                    </label>
                    <input
                      id="register-phone"
                      type="tel"
                      value={form.phone}
                      onChange={setField("phone")}
                      placeholder="Enter your phone number"
                      className={INPUT_CLASS}
                    />
                    {errors.phone && (
                      <p className="mt-1.5 text-xs font-medium text-red-500">{errors.phone}</p>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="register-dob" className={LABEL_CLASS}>
                        Date of birth
                      </label>
                      <input
                        id="register-dob"
                        type="date"
                        value={form.date_of_birth}
                        onChange={setField("date_of_birth")}
                        className={INPUT_CLASS}
                      />
                      {errors.date_of_birth && (
                        <p className="mt-1.5 text-xs font-medium text-red-500">
                          {errors.date_of_birth}
                        </p>
                      )}
                    </div>

                    <div>
                      <span className={LABEL_CLASS}>Gender</span>
                      <div className="mt-2 flex gap-2">
                        {[
                          { value: "M", label: "Male" },
                          { value: "F", label: "Female" },
                        ].map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setField("gender")(value)}
                            className={[
                              "flex-1 rounded-xl border px-3 py-3.5 text-xs font-bold tracking-wide transition-all",
                              form.gender === value
                                ? "border-[#065a60] bg-[#065a60]/5 text-[#065a60] ring-4 ring-[#065a60]/5"
                                : "border-gray-200 bg-white text-gray-500 hover:border-[#065a60]/30",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {errors.gender && (
                        <p className="mt-1.5 text-xs font-medium text-red-500">{errors.gender}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <p className={SECTION_CLASS}>Create your password</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="register-password" className={LABEL_CLASS}>
                      Password
                    </label>
                    <input
                      id="register-password"
                      type="password"
                      value={form.password}
                      onChange={setField("password")}
                      placeholder="Enter your password"
                      className={INPUT_CLASS}
                    />
                    {errors.password && (
                      <p className="mt-1.5 text-xs font-medium text-red-500">{errors.password}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="register-confirm-password" className={LABEL_CLASS}>
                      Confirm password
                    </label>
                    <input
                      id="register-confirm-password"
                      type="password"
                      value={form.confirmPassword}
                      onChange={setField("confirmPassword")}
                      placeholder="Confirm your password"
                      className={INPUT_CLASS}
                    />
                    {errors.confirmPassword && (
                      <p className="mt-1.5 text-xs font-medium text-red-500">
                        {errors.confirmPassword}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="glow-teal-capsule mt-2 block w-full rounded-full bg-gradient-to-r from-[#1c4e52] to-[#123638] py-4 text-center text-xs font-black tracking-wide text-white shadow-[0_10px_25px_-5px_rgba(28,78,82,0.35)] transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_15px_30px_-5px_rgba(28,78,82,0.5)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Creating account..." : "Create Patient Account"}
              </button>
            </form>

            <div className="mt-8 text-center">
              <Link
                to="/login"
                className="group inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 transition-colors hover:text-[#065a60]"
              >
                <span className="transform transition-transform duration-200 group-hover:-translate-x-0.5">
                  ←
                </span>
                Already have an account? Sign in
              </Link>
            </div>
          </div>

          <div className="text-center">
            <a
              href={STAFF_PORTAL_URL}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 transition-colors hover:text-[#065a60]"
            >
              Staff member? Sign in to staff portal
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PatientRegisterPage;
