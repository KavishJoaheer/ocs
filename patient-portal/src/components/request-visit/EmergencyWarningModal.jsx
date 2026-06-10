/** SAMU emergency gate — shared by mobile wizard and desktop request form. */
function EmergencyWarningModal({ open, onAcknowledge, variant = "sheet" }) {
  if (!open) return null;

  const overlayClass =
    variant === "page"
      ? "request-emergency-overlay fixed inset-0 z-[var(--z-emergency)] flex items-center justify-center p-5"
      : "request-emergency-overlay absolute inset-0 z-[var(--z-emergency)] flex items-center justify-center rounded-t-[24px] p-5";

  return (
    <div
      className={overlayClass}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-warning-title"
      aria-describedby="emergency-warning-desc"
    >
      <div className="absolute inset-0 bg-[rgba(13,42,46,0.55)] backdrop-blur-[3px]" aria-hidden="true" />
      <div className="request-emergency-dialog relative w-full max-w-[320px] rounded-[20px] bg-white p-6 shadow-[0_20px_60px_rgba(13,42,46,0.22)]">
        <h3 id="emergency-warning-title" className="native-display text-center text-[18px] text-[#c23a2f]">
          Medical Emergency Warning
        </h3>
        <p id="emergency-warning-desc" className="mt-4 text-center text-[14px] leading-relaxed text-[#5b7f8a]">
          If this is a life-threatening medical emergency, please call SAMU (114) immediately. OCS home
          visits are for non-life-threatening conditions.
        </p>
        <div className="mt-6 space-y-3">
          <a
            href="tel:114"
            className="request-emergency-call-btn flex h-[48px] w-full items-center justify-center rounded-full bg-[#e2574c] text-[14px] font-bold text-white shadow-[0_4px_16px_rgba(226,87,76,0.32)] transition active:scale-[0.98]"
          >
            Call 114
          </a>
          <button
            type="button"
            onClick={onAcknowledge}
            className="flex h-[48px] w-full items-center justify-center rounded-full bg-[rgba(138,158,154,0.16)] text-[14px] font-semibold text-[#5b7f8a] transition active:scale-[0.98]"
          >
            I Understand
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmergencyWarningModal;
