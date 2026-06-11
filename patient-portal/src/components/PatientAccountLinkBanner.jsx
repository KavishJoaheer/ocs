import { Link2 } from "lucide-react";
import { usePatientAuth } from "../hooks/usePatientAuth.jsx";

const CLINIC_PHONE = "52522234";
const CLINIC_PHONE_DISPLAY = "5252 2234";

function PatientAccountLinkBanner({ className = "" }) {
  const { user } = usePatientAuth();

  if (!user || user.patient_id != null) {
    return null;
  }

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
          <p className="text-sm font-bold text-brand-dark-grey">Account not linked to your clinic record</p>
          <p className="mt-1 text-[13px] leading-relaxed text-brand-cool-grey">
            Your portal login is active, but we couldn&apos;t match it to an OCS patient file yet. Contact the
            clinic at{" "}
            <a href={`tel:${CLINIC_PHONE}`} className="font-semibold text-brand-teal underline-offset-2 hover:underline">
              {CLINIC_PHONE_DISPLAY}
            </a>{" "}
            with your National ID so staff can link your account. Your OCS care number (e.g. #OCS-224) is assigned
            by the clinic — do not enter it during registration.
          </p>
        </div>
      </div>
    </div>
  );
}

export default PatientAccountLinkBanner;
