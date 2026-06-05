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
      <div className="relative flex w-full flex-col justify-between overflow-hidden bg-gradient-to-br from-[#f4fbfb] via-[#ebf6f6] to-[#dceeee] p-12 md:w-1/2 lg:p-16">
        <div className="pointer-events-none absolute -left-20 -top-20 h-96 w-96 rounded-full bg-[#2bccc4]/15 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-80 w-80 rounded-full bg-[#f7ba24]/10 blur-[100px]" />

        <div className="relative z-10 flex flex-col items-start">
          <a href="/welcome" className="transition-opacity hover:opacity-90">
            <BrandMark maxWidth={280} size={52} />
            <span className="mt-3 block text-xs font-bold uppercase tracking-[0.25em] text-[#065a60]">
              Virtual Practice
            </span>
          </a>
        </div>

        <div className="relative z-10 flex flex-1 flex-col justify-center py-10 lg:py-14">
          <div className="max-w-xl">
            <h1 className="text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl xl:text-[4.25rem]">
              <span className="block text-[#3b595c]">Step into a</span>
              <span className="block bg-gradient-to-r from-[#2bccc4] to-[#065a60] bg-clip-text text-transparent">
                Practice of Excellence
              </span>
            </h1>
            <p className="mt-6 max-w-lg text-base font-medium leading-relaxed tracking-wide text-[#f7ba24] sm:text-lg lg:mt-8 lg:text-xl">
              Together, let&apos;s make a difference in healthcare
            </p>
          </div>
        </div>

        <div className="relative z-10 text-[10px] font-medium tracking-wider text-[#3b595c]/45">
          DIGITAL HEADQUARTERS © {new Date().getFullYear()} OCS MÉDECINS
        </div>
      </div>

      {/* Right: secure entry portal */}
      <div className="flex w-full flex-col justify-between bg-slate-50/50 p-12 md:w-1/2 lg:p-16">
        <div className="h-8" />

        <div className="mx-auto my-auto w-full max-w-sm py-4">
          <div className="mb-8">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#065a60]">
              Protected Access Gateway
            </span>
            <h2 className="mt-1.5 text-2xl font-black tracking-tight text-[#14213d]">
              Sign in with credentials
            </h2>
            <p className="mt-2 text-xs font-medium leading-relaxed text-gray-500">
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
