import { useState } from "react";
import toast from "react-hot-toast";
import { LongTermReviewLogUpdateModal } from "../components/LongTermReviewLogUpdateModal.jsx";
import { api } from "../lib/api.js";

function closesReview(actionKey) {
  return actionKey === "done" || actionKey === "cancel";
}

export function useLongTermReviewLogUpdate({ onUpdated } = {}) {
  const [logUpdatePatient, setLogUpdatePatient] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit({ action, note, dueDate }) {
    if (!logUpdatePatient) {
      return;
    }

    setIsSaving(true);

    try {
      if (closesReview(action)) {
        await api.patch(`/patients/${logUpdatePatient.id}/long-term-review`, {
          is_under_review: false,
        });
        toast.success(action === "cancel" ? "Review cancelled." : "Review marked as done.");
      } else {
        const existingNote = String(logUpdatePatient.review_reason_note || "").trim();
        const nextNote = note || existingNote;

        if (!nextNote) {
          toast.error("Add a note for this review appointment.");
          setIsSaving(false);
          return;
        }

        await api.patch(`/patients/${logUpdatePatient.id}/long-term-review`, {
          is_under_review: true,
          review_reason_note: nextNote,
          review_due_date: dueDate,
        });

        toast.success(
          action === "done-and-add"
            ? "Review marked done. Next review date scheduled."
            : "Review date updated.",
        );
      }

      setLogUpdatePatient(null);
      await onUpdated?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function openLogUpdate(patient) {
    setLogUpdatePatient(patient);
  }

  const dialogs = (
    <LongTermReviewLogUpdateModal
      open={Boolean(logUpdatePatient)}
      patient={logUpdatePatient}
      isSaving={isSaving}
      onClose={() => setLogUpdatePatient(null)}
      onSubmit={handleSubmit}
    />
  );

  return {
    openLogUpdate,
    dialogs,
    isSaving,
  };
}
