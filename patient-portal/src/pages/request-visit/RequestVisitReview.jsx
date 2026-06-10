import { useState } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { ArrowLeft, ArrowRight, Clock } from "lucide-react";
import toast from "react-hot-toast";
import { usePatientAuth } from "../../hooks/usePatientAuth.jsx";
import { api } from "../../lib/api.js";
import { formatDisplayName } from "../../lib/formatDisplayName.js";
import { dispatchPatientDataChange } from "../../lib/patientDataSync.js";
import { clearVisitDraft } from "../../lib/visitDraftStorage.js";
import { URGENCY_META } from "./urgency.js";

function SummaryRow({ label, children }) {
  return (
    <div className="flex flex-col gap-1 border-b border-[rgba(65,200,198,0.12)] py-4 last:border-0">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#6e949b]">
        {label}
      </p>
      <div className="text-sm font-medium text-[#22485b]">{children}</div>
    </div>
  );
}

function RequestVisitReview() {
  const navigate = useNavigate();
  const { draft, updateDraft, storageKey } = useOutletContext();
  const { user } = usePatientAuth();
  const [submitting, setSubmitting] = useState(false);

  const visitForName =
    draft.visitFor === "myself" ? formatDisplayName(user?.full_name) || "Myself" : "A dependent";
  const urgency = URGENCY_META[draft.urgency] || URGENCY_META.routine;

  async function handleConfirm() {
    if (submitting) {
      return;
    }

    if (!draft.address?.trim() || !draft.reason?.trim()) {
      toast.error("Please add a visiting address and reason before confirming.");
      navigate("/request-visit");
      return;
    }

    setSubmitting(true);

    try {
      await api.post("/patient-portal/visit-requests", {
        visit_for: draft.visitFor,
        address: draft.address,
        reason: draft.reason,
        urgency: draft.urgency,
      });
      updateDraft({ submittedAt: new Date().toISOString() });
      clearVisitDraft(storageKey);
      dispatchPatientDataChange();
      navigate("/request-visit/awaiting");
    } catch (error) {
      // A 409 means there's already an active request — send them to tracking.
      if (/active visit request/i.test(error?.message || "")) {
        toast("You already have an active visit request.");
        navigate("/request-visit/tracking");
        return;
      }
      toast.error(error?.message || "We couldn't submit your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-[560px] animate-fade-in-fast">
      <Link
        to="/request-visit"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#5b7f8a] transition hover:text-[#2d8f98]"
      >
        <ArrowLeft className="size-4" /> Edit Request
      </Link>

      <h1 className="mt-8 font-display text-3xl tracking-tight text-slate-950 sm:text-4xl">
        Review your request.
      </h1>

      {/* Summary card */}
      <div className="mt-8 rounded-2xl border border-[rgba(65,200,198,0.16)] bg-white/85 px-7 py-3">
        <SummaryRow label="Visit for">{visitForName}</SummaryRow>
        <SummaryRow label="Address">
          {draft.address || <span className="text-[#94a9ad]">No address provided</span>}
        </SummaryRow>
        <SummaryRow label="Reason">
          {draft.reason || <span className="text-[#94a9ad]">No reason provided</span>}
        </SummaryRow>
        <SummaryRow label="Urgency">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${urgency.pill}`}
          >
            {urgency.label}
          </span>
        </SummaryRow>
        <SummaryRow label="Estimated response">
          <span className="inline-flex items-center gap-2">
            <Clock className="size-4 text-[#2d8f98]" />
            Our team will call you within 15 minutes
          </span>
        </SummaryRow>
      </div>

      <div className="mt-8">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={submitting}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-[#e8a020] text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? "Submitting…" : "Confirm Request"} <ArrowRight className="size-4" />
        </button>
        <p className="mt-3 text-center text-xs text-[#6e949b]">
          By confirming you agree to our standard visit terms
        </p>
      </div>
    </div>
  );
}

export default RequestVisitReview;
