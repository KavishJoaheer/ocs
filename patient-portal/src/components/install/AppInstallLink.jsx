import { CheckCircle2, Smartphone } from "lucide-react";
import { useAppInstallation } from "../../hooks/useAppInstallation.jsx";

export default function AppInstallLink({ variant = "link" }) {
  const { standalone, confirmed, openGuide } = useAppInstallation();
  if (standalone) {
    return variant === "profile" ? (
      <div className="care-install-profile-status">
        <CheckCircle2 size={21} aria-hidden="true" />
        <div>
          <strong>You’re using the OCS Care app</strong>
          <p>Appointments and health records, close at hand.</p>
        </div>
      </div>
    ) : null;
  }

  return (
    <button type="button" onClick={openGuide} className={`care-install-entry care-install-entry-${variant}`}>
      <Smartphone size={variant === "profile" ? 22 : 17} aria-hidden="true" />
      <span>
        <strong>{confirmed ? "OCS Care installation help" : "Add OCS Care to your phone"}</strong>
        {variant === "profile" ? <span>Quick access from your home screen</span> : null}
      </span>
    </button>
  );
}
