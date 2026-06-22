import { useState } from "react";
import toast from "react-hot-toast";
import ConfirmDialog from "./ConfirmDialog.jsx";
import Modal from "./Modal.jsx";
import { api } from "../lib/api.js";

export function canLogLongTermReviewUpdate(role) {
  return ["admin", "operator", "doctor"].includes(String(role || ""));
}

function LongTermReviewQuickActionsModal({
  open,
  patient,
  onClose,
  onReviewDone,
  onReviewCancel,
  onChangeReviewDate,
  onDoneAndAddAnotherReviewDate,
}) {
  if (!patient) {
    return null;
  }

  const actions = [
    { key: "done", label: "Review done", icon: "✅", onClick: onReviewDone },
    { key: "cancel", label: "Review Cancel", icon: "✖️", onClick: onReviewCancel },
    { key: "change-date", label: "Change Review Date", icon: "🗓️", onClick: onChangeReviewDate },
    {
      key: "done-and-add",
      label: "Done & Add another Review Date",
      icon: "🔁",
      onClick: onDoneAndAddAnotherReviewDate,
    },
  ];

  return (
    <Modal open={open} onClose={onClose} title="Log update" size="md">
      <p className="mb-4 text-sm text-slate-600">
        Choose a quick action for <span className="font-semibold text-slate-900">{patient.full_name}</span>.
      </p>
      <div className="space-y-3">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-slate-50"
          >
            <span aria-hidden>{action.icon}</span>
            {action.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function LongTermReviewDueDateModal({ open, patient, mode = "change", onClose, onSubmit, isSaving }) {
  const [dueDate, setDueDate] = useState("");
  const [syncedDeps, setSyncedDeps] = useState({ open, patient });

  if (syncedDeps.open !== open || syncedDeps.patient !== patient) {
    setSyncedDeps({ open, patient });
    if (open && patient) {
      const raw = String(patient.review_due_date || "").trim();
      setDueDate(raw.length >= 10 ? raw.slice(0, 10) : "");
    }
  }

  if (!patient) {
    return null;
  }

  const isDoneAndAdd = mode === "done-and-add";
  const modalTitle = isDoneAndAdd ? "Done & add another review date" : "Change review date";
  const submitLabel = isDoneAndAdd ? "Save next review date" : "Save date";

  return (
    <Modal open={open} onClose={onClose} title={modalTitle} size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dueDate) {
            toast.error("Select a review date.");
            return;
          }
          onSubmit(dueDate, mode);
        }}
      >
        {isDoneAndAdd ? (
          <p className="text-sm text-slate-600">
            Mark the current review as done and schedule the next follow-up for{" "}
            <span className="font-semibold text-slate-900">{patient.full_name}</span>.
          </p>
        ) : null}
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">
            {isDoneAndAdd ? "Next review date" : "Target review date"}
          </span>
          <input
            required
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-amber-400 focus:bg-white"
          />
        </label>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-2xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-60"
          >
            {isSaving ? "Saving..." : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function useLongTermReviewLogUpdate({ onUpdated } = {}) {
  const [quickActionPatient, setQuickActionPatient] = useState(null);
  const [dueDatePatient, setDueDatePatient] = useState(null);
  const [dueDateMode, setDueDateMode] = useState("change");
  const [closeReviewPatient, setCloseReviewPatient] = useState(null);
  const [closeReviewMode, setCloseReviewMode] = useState("done");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSaveDueDate(patient, nextDueDate, mode = "change") {
    const reviewReasonNote = String(patient.review_reason_note || "").trim();

    if (!reviewReasonNote) {
      toast.error("This patient is missing a review note. Open the profile to re-flag the case.");
      return;
    }

    setIsSaving(true);

    try {
      await api.patch(`/patients/${patient.id}/long-term-review`, {
        is_under_review: true,
        review_reason_note: reviewReasonNote,
        review_due_date: nextDueDate,
      });
      toast.success(
        mode === "done-and-add"
          ? "Review marked done. Next review date scheduled."
          : "Review date updated.",
      );
      setDueDatePatient(null);
      setDueDateMode("change");
      await onUpdated?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCloseReview() {
    if (!closeReviewPatient) {
      return;
    }

    setIsSaving(true);

    try {
      await api.patch(`/patients/${closeReviewPatient.id}/long-term-review`, {
        is_under_review: false,
      });
      toast.success(
        closeReviewMode === "cancel" ? "Review cancelled." : "Review marked as done.",
      );
      setCloseReviewPatient(null);
      setCloseReviewMode("done");
      await onUpdated?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  function openLogUpdate(patient) {
    setQuickActionPatient(patient);
  }

  const dialogs = (
    <>
      <LongTermReviewQuickActionsModal
        open={Boolean(quickActionPatient)}
        patient={quickActionPatient}
        onClose={() => setQuickActionPatient(null)}
        onReviewDone={() => {
          setCloseReviewMode("done");
          setCloseReviewPatient(quickActionPatient);
          setQuickActionPatient(null);
        }}
        onReviewCancel={() => {
          setCloseReviewMode("cancel");
          setCloseReviewPatient(quickActionPatient);
          setQuickActionPatient(null);
        }}
        onChangeReviewDate={() => {
          setDueDateMode("change");
          setDueDatePatient(quickActionPatient);
          setQuickActionPatient(null);
        }}
        onDoneAndAddAnotherReviewDate={() => {
          setDueDateMode("done-and-add");
          setDueDatePatient(quickActionPatient);
          setQuickActionPatient(null);
        }}
      />

      <LongTermReviewDueDateModal
        open={Boolean(dueDatePatient)}
        patient={dueDatePatient}
        mode={dueDateMode}
        isSaving={isSaving}
        onClose={() => {
          setDueDatePatient(null);
          setDueDateMode("change");
        }}
        onSubmit={(nextDueDate, mode) => handleSaveDueDate(dueDatePatient, nextDueDate, mode)}
      />

      <ConfirmDialog
        open={Boolean(closeReviewPatient)}
        title={closeReviewMode === "cancel" ? "Review cancel?" : "Review done?"}
        description={
          closeReviewPatient
            ? closeReviewMode === "cancel"
              ? `Cancel the scheduled review for ${closeReviewPatient.full_name} and remove them from the long term review queue?`
              : `Mark the review for ${closeReviewPatient.full_name} as done and remove them from the long term review queue?`
            : ""
        }
        confirmLabel={
          isSaving
            ? "Saving..."
            : closeReviewMode === "cancel"
              ? "Cancel review"
              : "Review done"
        }
        tone="default"
        onClose={() => {
          setCloseReviewPatient(null);
          setCloseReviewMode("done");
        }}
        onConfirm={handleCloseReview}
      />
    </>
  );

  return {
    openLogUpdate,
    dialogs,
    isSaving,
  };
}

export function LongTermReviewLogUpdateButton({
  onClick,
  className = "rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-white",
  label = "📝 Log Update",
}) {
  return (
    <button type="button" onClick={onClick} className={className}>
      {label}
    </button>
  );
}
