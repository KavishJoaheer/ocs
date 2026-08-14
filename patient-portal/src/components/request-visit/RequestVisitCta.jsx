import { Link } from "react-router-dom";
import { useRequestVisit } from "../../hooks/useRequestVisit.jsx";
import { usePatientAuth } from "../../hooks/usePatientAuth.jsx";
import { useFamilyProfile } from "../../hooks/useFamilyProfile.jsx";
import { isPatientAccountLinked } from "../../lib/patientAccountLink.js";
import { getVisitRequestLabel } from "../../lib/familyProfiles.js";

/**
 * Unified request-visit CTA — mobile opens the bottom-sheet wizard;
 * desktop routes to the full-page form.
 */
function RequestVisitCta({ className = "", leading = null }) {
  const { openRequestSheet } = useRequestVisit();
  const { user } = usePatientAuth();
  const { activeProfile } = useFamilyProfile();
  const isLinked = isPatientAccountLinked(user);
  const label = getVisitRequestLabel(activeProfile);
  const content = (
    <>
      {leading}
      {label}
    </>
  );

  if (!isLinked) {
    return (
      <span
        className={["cursor-not-allowed opacity-50", className].join(" ")}
        title="Link your account with the clinic before requesting a visit"
      >
        {content}
      </span>
    );
  }

  return (
    <>
      <Link to="/request-visit" className={["hidden lg:inline-flex", className].join(" ")}>
        {content}
      </Link>
      <button
        type="button"
        onClick={() => openRequestSheet()}
        className={["lg:hidden", className].join(" ")}
      >
        {content}
      </button>
    </>
  );
}

export default RequestVisitCta;
