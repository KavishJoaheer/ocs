import { Link } from "react-router-dom";
import { useRequestVisit } from "../../hooks/useRequestVisit.jsx";
import { usePatientAuth } from "../../hooks/usePatientAuth.jsx";
import { isPatientAccountLinked } from "../../lib/patientAccountLink.js";

/**
 * Unified request-visit CTA — mobile opens the bottom-sheet wizard;
 * desktop routes to the full-page form.
 */
function RequestVisitCta({ className = "", children }) {
  const { openRequestSheet } = useRequestVisit();
  const { user } = usePatientAuth();
  const isLinked = isPatientAccountLinked(user);

  if (!isLinked) {
    return (
      <span
        className={["cursor-not-allowed opacity-50", className].join(" ")}
        title="Link your account with the clinic before requesting a visit"
      >
        {children}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => openRequestSheet()}
        className={["lg:hidden", className].join(" ")}
      >
        {children}
      </button>
      <Link to="/request-visit" className={["hidden lg:inline-flex", className].join(" ")}>
        {children}
      </Link>
    </>
  );
}

export default RequestVisitCta;
