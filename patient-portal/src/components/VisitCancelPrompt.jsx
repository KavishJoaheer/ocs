import { useState } from "react";
import toast from "react-hot-toast";
import { canPatientCancelVisit, cancelPatientVisit } from "../lib/visitRequests.js";

function VisitCancelPrompt({
  visitId,
  visitStatus,
  onCancelled,
  className = "",
  buttonClassName = "inline-flex min-h-[44px] items-center text-xs font-medium text-[#cf8079] transition hover:text-[#cf5b50]",
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (!visitId || !canPatientCancelVisit(visitStatus)) {
    return null;
  }

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelPatientVisit(visitId);
      toast.success("Your visit request has been cancelled.");
      setShowConfirm(false);
      onCancelled?.();
    } catch (error) {
      toast.error(error.message || "Could not cancel this visit.");
    } finally {
      setCancelling(false);
    }
  }

  if (showConfirm) {
    return (
      <div className={`rounded-xl bg-[rgba(207,91,80,0.08)] p-4 ${className}`}>
        <p className="text-sm leading-relaxed text-[#5b6b6b]">
          Cancel this home visit request? Our care team will be notified immediately.
        </p>
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-[#cf5b50] text-sm font-bold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {cancelling ? "Cancelling…" : "Yes, cancel visit"}
        </button>
        <button
          type="button"
          onClick={() => setShowConfirm(false)}
          disabled={cancelling}
          className="mt-2 w-full text-center text-xs font-semibold text-[#2d8f98] transition hover:text-[#23767f]"
        >
          Keep my visit
        </button>
        <p className="mt-3 text-center text-[11px] text-[#8a9ea3]">
          Need help?{" "}
          <a href="tel:52522234" className="font-medium text-[#2d8f98]">
            Call OCS
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <button type="button" onClick={() => setShowConfirm(true)} className={buttonClassName}>
        Cancel this visit
      </button>
    </div>
  );
}

export default VisitCancelPrompt;
