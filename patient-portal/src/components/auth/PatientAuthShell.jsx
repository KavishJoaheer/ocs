import { Link } from "react-router-dom";

const STAFF_PORTAL_URL =
  typeof window !== "undefined" && window.location.hostname !== "localhost"
    ? "https://staff.ocsvp.com/login"
    : "http://localhost:5173/login";

function PatientAuthShell({
  pill = "Your Care Space",
  title,
  children,
  footer = null,
  showStaffLink = false,
}) {
  return (
    <div className="flex min-h-svh w-full min-w-0 max-w-[100vw] flex-col overflow-hidden bg-white font-sans antialiased md:flex-row">
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

      <div className="auth-form-panel md:w-1/2">
        <div className="h-8" />

        <div className="auth-form-body mx-auto">
          <div className="auth-form-header">
            <span className="auth-form-pill">{pill}</span>
            <h2 className="auth-form-title">{title}</h2>
          </div>
          {children}
        </div>

        {footer}
        {showStaffLink ? (
          <div className="text-center">
            <a
              href={STAFF_PORTAL_URL}
              className="group inline-flex items-center gap-1.5 text-xs font-bold text-gray-400 transition-colors hover:text-[#065a60]"
            >
              Staff member? Sign in to staff portal
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default PatientAuthShell;
