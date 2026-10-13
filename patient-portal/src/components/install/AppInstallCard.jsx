import { useId } from "react";
import { ArrowDownToLine, Smartphone } from "lucide-react";
import { useAppInstallation } from "../../hooks/useAppInstallation.jsx";
import { useRequestVisit } from "../../hooks/useRequestVisit.jsx";

export default function AppInstallCard({ eligible = true }) {
  const { canPromote, actionLabel, install, installing, dismiss } = useAppInstallation();
  const { sheetOpen } = useRequestVisit();
  const titleId = useId();
  if (!eligible || !canPromote || sheetOpen) return null;

  return (
    <section className="care-install-card" aria-labelledby={titleId}>
      <div className="care-install-card-heading">
        <img src="/pwa-192.png" alt="" className="care-install-app-icon" />
        <div>
          <span className="care-install-eyebrow">OCS Care, always close</span>
          <h2 id={titleId}>Your care, one tap away.</h2>
        </div>
      </div>
      <p className="care-install-description">
        Add OCS Care to your home screen for quick access to appointments and health records.
      </p>
      <div className="care-install-card-actions">
        <button type="button" onClick={install} disabled={installing} className="care-install-primary">
          <ArrowDownToLine size={18} aria-hidden="true" />
          {installing ? "Opening installation…" : actionLabel}
        </button>
        <button type="button" onClick={dismiss} className="care-install-later">Maybe later</button>
      </div>
      <p className="care-install-card-footnote">
        <Smartphone size={14} aria-hidden="true" />
        Made for your phone. No app store needed.
      </p>
    </section>
  );
}
