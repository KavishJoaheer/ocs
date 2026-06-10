import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useRequestVisit } from "../../hooks/useRequestVisit.jsx";
import RequestVisitForm from "./RequestVisitForm.jsx";

/** On mobile, open the shared request sheet and return to dashboard. Desktop shows the form. */
function RequestVisitFormGate() {
  const navigate = useNavigate();
  const { openRequestSheet } = useRequestVisit();

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    if (!media.matches) return undefined;

    let cancelled = false;

    (async () => {
      await openRequestSheet();
      if (!cancelled) {
        navigate("/dashboard", { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, openRequestSheet]);

  return (
    <>
      <div className="flex min-h-[30vh] items-center justify-center lg:hidden">
        <span className="size-8 animate-spin rounded-full border-2 border-[#d6ebea] border-t-[#065a60]" />
      </div>
      <div className="max-lg:hidden">
        <RequestVisitForm />
      </div>
    </>
  );
}

export default RequestVisitFormGate;
