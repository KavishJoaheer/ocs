import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, MapPin, User, Users } from "lucide-react";
import { api } from "../../lib/api.js";

const VISIT_DRAFT_KEY = "ocs-visit-draft";

function useKeyboardOffset(enabled) {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !window.visualViewport) return undefined;

    const viewport = window.visualViewport;

    function updateOffset() {
      const keyboardInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setOffset(keyboardInset);
    }

    viewport.addEventListener("resize", updateOffset);
    viewport.addEventListener("scroll", updateOffset);
    updateOffset();

    return () => {
      viewport.removeEventListener("resize", updateOffset);
      viewport.removeEventListener("scroll", updateOffset);
    };
  }, [enabled]);

  return offset;
}

function MiniMapPreview() {
  return (
    <div className="request-minimap relative h-[140px] w-full overflow-hidden rounded-[16px]" aria-hidden="true">
      <div className="absolute inset-0 bg-gradient-to-br from-[#e8f4f3] via-[#d4ebe8] to-[#c5e0dc]" />
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(rgba(45,143,152,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(45,143,152,0.12) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="absolute left-[18%] top-[22%] h-16 w-24 rounded-full bg-[rgba(65,200,198,0.18)] blur-[1px]" />
      <div className="absolute bottom-[18%] right-[12%] h-20 w-28 rounded-full bg-[rgba(26,160,140,0.14)] blur-[1px]" />
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-[calc(50%+6px)] flex-col items-center">
        <MapPin className="size-8 fill-[#e2574c] text-[#e2574c] drop-shadow-[0_2px_6px_rgba(226,87,76,0.35)]" strokeWidth={1.5} />
        <span className="mt-1 size-2 rounded-full bg-[rgba(226,87,76,0.25)] blur-[2px]" />
      </div>
    </div>
  );
}

function EmergencyWarningModal({ open, onAcknowledge }) {
  if (!open) return null;

  return (
    <div
      className="request-emergency-overlay absolute inset-0 z-10 flex items-center justify-center p-5"
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

function StepBackButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="request-wizard-back mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-[#5b7f8a] transition active:text-[#2d8f98]"
    >
      <ChevronLeft className="size-4" strokeWidth={2.25} />
      Back
    </button>
  );
}

function RequestDoctorSheet({ open, onClose }) {
  const navigate = useNavigate();
  const keyboardOffset = useKeyboardOffset(open);

  const [currentStep, setCurrentStep] = useState(1);
  const [stepDirection, setStepDirection] = useState("forward");
  const [visitFor, setVisitFor] = useState(null);
  const [pendingPatient, setPendingPatient] = useState(null);
  const [address, setAddress] = useState("Sky Garden");
  const [reason, setReason] = useState("");
  const [urgency, setUrgency] = useState("routine");
  const [emergencyModalOpen, setEmergencyModalOpen] = useState(false);

  function resetWizard() {
    setCurrentStep(1);
    setStepDirection("forward");
    setVisitFor(null);
    setPendingPatient(null);
    setAddress("Sky Garden");
    setReason("");
    setUrgency("routine");
    setEmergencyModalOpen(false);
  }

  function handleClose() {
    resetWizard();
    onClose();
  }

  function goToStep(step) {
    setStepDirection(step < currentStep ? "back" : "forward");
    setCurrentStep(step);
  }

  function handlePatientSelect(value) {
    setPendingPatient(value);
    setVisitFor(value);
    window.setTimeout(() => {
      setStepDirection("forward");
      setCurrentStep(2);
      setPendingPatient(null);
    }, 300);
  }

  function handleUrgencySelect(level) {
    if (level === "emergency") {
      setUrgency("emergency");
      setEmergencyModalOpen(true);
      return;
    }
    setUrgency(level);
  }

  function handleReviewSubmit() {
    if (!reason.trim() || !address.trim() || !visitFor) return;

    sessionStorage.setItem(
      VISIT_DRAFT_KEY,
      JSON.stringify({
        visitFor,
        address: address.trim(),
        reason: reason.trim(),
        urgency,
      }),
    );

    handleClose();
    navigate("/request-visit/review");
  }

  useEffect(() => {
    if (!open) return undefined;

    let ignore = false;

    async function loadAddress() {
      try {
        const data = await api.get("/patient-portal/profile");
        const profileAddress = data.profile?.address || data.address || "";
        if (!ignore && profileAddress) {
          setAddress(profileAddress);
        }
      } catch {
        // Keep placeholder address when profile is unavailable.
      }
    }

    loadAddress();

    function handleKeyDown(event) {
      if (event.key === "Escape" && !emergencyModalOpen) handleClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      ignore = true;
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, emergencyModalOpen]);

  if (!open) return null;

  const stepAnimationClass =
    stepDirection === "back" ? "request-wizard-step-back" : "request-wizard-step-forward";

  const canConfirmLocation = address.trim().length > 0;
  const canReviewSubmit = reason.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="request-doctor-title">
      <button
        type="button"
        aria-label="Close request doctor dialog"
        onClick={handleClose}
        className="animate-sheet-overlay absolute inset-0 bg-[rgba(13,42,46,0.45)] backdrop-blur-[2px]"
      />

      <div
        className="request-doctor-sheet animate-sheet-up absolute inset-x-0 bottom-0 flex max-h-[92vh] flex-col rounded-t-[24px] bg-white shadow-[0_-12px_48px_rgba(13,42,46,0.16)]"
        style={{
          paddingBottom: `calc(max(env(safe-area-inset-bottom, 0px), 16px) + ${keyboardOffset}px)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3">
          <span className="h-[5px] w-[40px] rounded-full bg-[rgba(13,42,46,0.14)]" aria-hidden="true" />
        </div>

        <div className="request-sheet-scroll relative flex-1 overflow-y-auto overscroll-contain px-5 pb-2 pt-4">
          <EmergencyWarningModal
            open={emergencyModalOpen}
            onAcknowledge={() => setEmergencyModalOpen(false)}
          />

          <div key={currentStep} className={stepAnimationClass}>
            {currentStep === 1 ? (
              <div>
                <h2 id="request-doctor-title" className="native-display text-[22px] leading-tight text-[#1a5c52]">
                  Who needs care today?
                </h2>

                <div className="mt-6 grid grid-cols-2 gap-4">
                  {[
                    { value: "myself", label: "Myself", icon: User },
                    { value: "dependent", label: "A Dependent", icon: Users },
                  ].map((option) => {
                    const Icon = option.icon;
                    const isSelected =
                      pendingPatient === option.value || visitFor === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handlePatientSelect(option.value)}
                        className={[
                          "request-patient-card squircle-inner flex flex-col items-center justify-center gap-3 px-3 py-7 transition",
                          isSelected ? "request-patient-card-selected" : "request-patient-card-idle",
                        ].join(" ")}
                      >
                        <div
                          className={[
                            "flex size-12 items-center justify-center rounded-full transition",
                            isSelected
                              ? "bg-[rgba(26,160,140,0.14)] text-[#2d8f98]"
                              : "bg-[rgba(138,158,154,0.12)] text-[#8a9e9a]",
                          ].join(" ")}
                        >
                          <Icon className="size-6" strokeWidth={1.75} />
                        </div>
                        <span className="text-[15px] font-semibold text-[#1a5c52]">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {currentStep === 2 ? (
              <div>
                <StepBackButton onClick={() => goToStep(1)} />
                <h2 className="native-display text-[22px] leading-tight text-[#1a5c52]">
                  Confirm visiting address
                </h2>

                <div className="mt-5">
                  <MiniMapPreview />
                </div>

                <div className="mt-5">
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Your visiting address"
                    className="upload-field-input"
                    aria-label="Visiting address"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => goToStep(3)}
                  disabled={!canConfirmLocation}
                  className="request-wizard-primary-btn mt-6 w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Confirm Location
                </button>
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div>
                <StepBackButton onClick={() => goToStep(2)} />
                <h2 className="native-display text-[22px] leading-tight text-[#1a5c52]">
                  Symptoms &amp; Urgency
                </h2>

                <div className="mt-5">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={5}
                    placeholder="Briefly describe your symptoms..."
                    className="request-wizard-textarea upload-field-input resize-none"
                    aria-label="Symptoms description"
                  />
                </div>

                <div className="mt-5 grid grid-cols-3 gap-2.5">
                  {[
                    { value: "routine", label: "Routine" },
                    { value: "urgent", label: "Urgent" },
                    { value: "emergency", label: "Emergency" },
                  ].map((level) => {
                    const isActive = urgency === level.value;
                    return (
                      <button
                        key={level.value}
                        type="button"
                        onClick={() => handleUrgencySelect(level.value)}
                        className={[
                          "request-wizard-urgency-pill squircle-inner px-2 py-3 text-[12px] font-bold transition",
                          isActive
                            ? "request-wizard-urgency-active"
                            : "request-wizard-urgency-inactive",
                        ].join(" ")}
                      >
                        {level.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleReviewSubmit}
                  disabled={!canReviewSubmit}
                  className="request-wizard-primary-btn mt-6 w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Review &amp; Submit
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default RequestDoctorSheet;
export { VISIT_DRAFT_KEY };
