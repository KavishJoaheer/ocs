import { useRef, useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { ArrowLeft, ArrowRight, MapPin } from "lucide-react";
import EmergencyWarningModal from "../../components/request-visit/EmergencyWarningModal.jsx";
import { useKeyboardOffset } from "../../hooks/useKeyboardOffset.js";
import { URGENCY_LEVELS, URGENCY_META, URGENCY_UNSELECTED } from "./urgency.js";

const SECTION_LABEL =
  "text-xs font-semibold uppercase tracking-[0.28em] text-[#2d8f98]";

function RequestVisitForm() {
  const navigate = useNavigate();
  const { draft, updateDraft } = useOutletContext();
  const addressRef = useRef(null);
  const [emergencyModalOpen, setEmergencyModalOpen] = useState(false);
  const keyboardInset = useKeyboardOffset(true);

  function handleDifferentAddress() {
    updateDraft({ address: "" });
    requestAnimationFrame(() => addressRef.current?.focus());
  }

  function handleReview() {
    navigate("/request-visit/review");
  }

  function handleUrgencySelect(level) {
    if (level === "emergency") {
      updateDraft({ urgency: "emergency" });
      setEmergencyModalOpen(true);
      return;
    }
    updateDraft({ urgency: level });
  }

  const canReview =
    draft.address.trim().length > 0 && draft.reason.trim().length > 0;

  return (
    <div
      className="mx-auto max-w-[560px] animate-fade-in-fast"
      style={{ paddingBottom: keyboardInset.bottom }}
    >
      <EmergencyWarningModal
        open={emergencyModalOpen}
        onAcknowledge={() => setEmergencyModalOpen(false)}
        variant="page"
      />

      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#5b7f8a] transition hover:text-[#2d8f98]"
      >
        <ArrowLeft className="size-4" /> Dashboard
      </Link>

      <p className={`mt-8 ${SECTION_LABEL}`}>New Request</p>
      <h1 className="mt-3 font-display text-3xl tracking-tight text-slate-950 sm:text-4xl">
        Who needs care today?
      </h1>

      <div className="mt-10 space-y-9">
        <section>
          <p className={SECTION_LABEL}>Visit For</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {[
              { value: "myself", label: "Myself" },
              { value: "dependent", label: "A Dependent" },
            ].map((option) => {
              const active = draft.visitFor === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateDraft({ visitFor: option.value })}
                  className={[
                    "flex h-[52px] items-center justify-center rounded-full text-sm font-bold transition",
                    active
                      ? "bg-[#2d8f98] text-white shadow-[0_12px_30px_rgba(45,143,152,0.28)]"
                      : "border border-[rgba(65,200,198,0.3)] bg-transparent text-[#3b595c] hover:bg-[rgba(65,200,198,0.06)]",
                  ].join(" ")}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <p className={SECTION_LABEL}>Visiting Address</p>
          <div className="relative mt-3">
            <MapPin className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6e949b]" />
            <input
              ref={addressRef}
              value={draft.address}
              onChange={(e) => updateDraft({ address: e.target.value })}
              placeholder="Your home address"
              className="h-[52px] w-full rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] pl-11 pr-4 text-sm text-[#22485b] outline-none transition focus:border-[rgba(65,200,198,0.45)] focus:bg-white"
            />
          </div>
          <button
            type="button"
            onClick={handleDifferentAddress}
            className="mt-2 inline-flex items-center gap-1 text-sm font-normal text-[#5f9aa0] transition hover:gap-2 hover:text-[#2d8f98]"
          >
            Use a different address <ArrowRight className="size-3.5" />
          </button>
        </section>

        <section>
          <p className={SECTION_LABEL}>Reason For Visit</p>
          <textarea
            value={draft.reason}
            onChange={(e) => updateDraft({ reason: e.target.value })}
            rows={3}
            placeholder="Briefly describe your symptoms or reason for the visit"
            className="mt-3 w-full resize-none rounded-xl border border-transparent bg-[rgba(65,200,198,0.08)] px-4 py-3.5 text-sm leading-relaxed text-[#22485b] outline-none transition focus:border-[rgba(65,200,198,0.45)] focus:bg-white"
          />

          <div className="mt-3 grid grid-cols-1 gap-3 min-[360px]:grid-cols-3">
            {URGENCY_LEVELS.map((level) => {
              const active = draft.urgency === level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleUrgencySelect(level)}
                  className={[
                    "flex h-[52px] items-center justify-center rounded-full text-sm font-bold transition",
                    active ? URGENCY_META[level].selected : URGENCY_UNSELECTED,
                  ].join(" ")}
                >
                  {URGENCY_META[level].label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-[#6e949b]">
            Select the level that best describes your situation
          </p>
        </section>
      </div>

      <div className="mt-10">
        <button
          type="button"
          onClick={handleReview}
          disabled={!canReview}
          className={[
            "flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-brand-gold text-sm font-bold text-brand-dark-grey shadow-sm transition",
            canReview ? "hover:brightness-105 active:scale-95" : "cursor-not-allowed opacity-50",
          ].join(" ")}
        >
          Review My Request <ArrowRight className="size-4" />
        </button>
        <p className="mt-3 text-center text-xs text-[#6e949b]">
          A member of our team will call you to confirm your visit
        </p>
      </div>
    </div>
  );
}

export default RequestVisitForm;
