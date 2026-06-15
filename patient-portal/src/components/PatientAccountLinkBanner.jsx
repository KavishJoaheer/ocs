import { Link2 } from "lucide-react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";
import { getPatientLinkBlockMessage, getPatientLinkState } from "../lib/patientAccountLink.js";

const CLINIC_PHONE = "52522234";
const CLINIC_PHONE_DISPLAY = "5252 2234";

const BANNER_COPY = {
  unlinked: {
    title: "Account not linked to your clinic record",
    body: (
      <>
        Your portal login is active, but we couldn&apos;t match it to an OCS patient file yet. Contact
        the clinic at{" "}
        <a
          href={`tel:${CLINIC_PHONE}`}
          className="font-semibold text-brand-teal underline-offset-2 hover:underline"
        >
          {CLINIC_PHONE_DISPLAY}
        </a>{" "}
        with your National ID so staff can link your account.
      </>
    ),
  },
  pending_review: {
    title: "Clinic link pending confirmation",
    body: (
      <>
        We matched your account to an existing clinic record. Staff will confirm the link shortly.
        For urgent help, call{" "}
        <a
          href={`tel:${CLINIC_PHONE}`}
          className="font-semibold text-brand-teal underline-offset-2 hover:underline"
        >
          {CLINIC_PHONE_DISPLAY}
        </a>
        .
      </>
    ),
  },
  self_registered: {
    title: "Clinic record needs to be merged",
    body: (
      <>
        Your sign-up created a temporary chart. Contact the clinic at{" "}
        <a
          href={`tel:${CLINIC_PHONE}`}
          className="font-semibold text-brand-teal underline-offset-2 hover:underline"
        >
          {CLINIC_PHONE_DISPLAY}
        </a>{" "}
        with your National ID so staff can merge it with your official record.
      </>
    ),
  },
  pending: {
    title: "Clinic record not fully verified",
    body: (
      <>
        Your account is not ready for clinical services yet. Please contact the clinic at{" "}
        <a
          href={`tel:${CLINIC_PHONE}`}
          className="font-semibold text-brand-teal underline-offset-2 hover:underline"
        >
          {CLINIC_PHONE_DISPLAY}
        </a>
        .
      </>
    ),
  },
};

function PatientAccountLinkBanner({ className = "" }) {
  const { user } = usePatientAuth();
  const linkState = getPatientLinkState(user);

  if (!user || linkState === "verified") {
    return null;
  }

  const copy = BANNER_COPY[linkState] || BANNER_COPY.pending;

  return (
    <div
      role="status"
      className={[
        "rounded-2xl border border-brand-gold/35 bg-brand-gold/10 px-4 py-4 sm:px-5",
        className,
      ].join(" ")}
    >
      <div className="flex gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-gold/20 text-brand-dark-grey">
          <Link2 className="size-5" strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-brand-dark-grey">{copy.title}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-brand-cool-grey">{copy.body}</p>
        </div>
      </div>
    </div>
  );
}

export default PatientAccountLinkBanner;
