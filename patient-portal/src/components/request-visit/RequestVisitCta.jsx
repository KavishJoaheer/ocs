import { Link } from "react-router-dom";
import { useRequestVisit } from "../../hooks/useRequestVisit.jsx";

/**
 * Unified request-visit CTA — mobile opens the bottom-sheet wizard;
 * desktop routes to the full-page form.
 */
function RequestVisitCta({ className = "", children }) {
  const { openRequestSheet } = useRequestVisit();

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
