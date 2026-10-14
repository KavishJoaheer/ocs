import { useState } from "react";
import { CalendarClock, CheckCircle2, CircleX, Repeat2 } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";

const QUICK_ACTIONS = [
  { key: "done", label: "Complete review", icon: CheckCircle2 },
  { key: "cancel", label: "Cancel review", icon: CircleX },
  { key: "change-date", label: "Reschedule", icon: CalendarClock },
  { key: "done-and-add", label: "Complete and schedule next", icon: Repeat2 },
];

function needsDueDate(actionKey) {
  return actionKey === "change-date" || actionKey === "done-and-add";
}

function closesReview(actionKey) {
  return actionKey === "done" || actionKey === "cancel";
}

export function LongTermReviewLogUpdateModal({ open, patient, onClose, onSubmit, isSaving }) {
  const [selectedAction, setSelectedAction] = useState(null);
  const [note, setNote] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [syncedDeps, setSyncedDeps] = useState({ open, patient });

  if (syncedDeps.open !== open || syncedDeps.patient !== patient) {
    setSyncedDeps({ open, patient });
    if (open && patient) {
      setSelectedAction(null);
      setNote(String(patient.review_reason_note || "").trim());
      const raw = String(patient.review_due_date || "").trim();
      setDueDate(raw.length >= 10 ? raw.slice(0, 10) : "");
    }
  }

  if (!patient) {
    return null;
  }

  const showDateField = needsDueDate(selectedAction);
  const isDoneAndAdd = selectedAction === "done-and-add";

  return (
    <Modal open={open} onClose={() => { if (!isSaving) onClose(); }} title="Update review" size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedAction) {
            toast.error("Choose a quick action.");
            return;
          }

          if (showDateField && !dueDate) {
            toast.error("Select a review date.");
            return;
          }

          const trimmedNote = note.trim();
          if (!closesReview(selectedAction) && !trimmedNote) {
            toast.error("Add a note for this review appointment.");
            return;
          }

          onSubmit({
            action: selectedAction,
            note: trimmedNote,
            dueDate,
          });
        }}
      >
        <p className="text-sm text-slate-600">
          Choose a quick action for{" "}
          <span className="font-semibold text-slate-900">{patient.full_name}</span>.
        </p>

        <div className="space-y-3">
          {QUICK_ACTIONS.map((action) => {
            const isSelected = selectedAction === action.key;
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                type="button"
                disabled={isSaving}
                onClick={() => setSelectedAction(action.key)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-full border px-4 py-3 text-left text-sm font-semibold transition disabled:opacity-60 ${
                  isSelected
                    ? "border-ocs-teal bg-ocs-teal/10 text-ocs-slate ring-2 ring-ocs-teal/20"
                    : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-slate-50"
                }`}
                aria-pressed={isSelected}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                {action.label}
              </button>
            );
          })}
        </div>

        {selectedAction ? (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            {showDateField ? (
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-700">
                  {isDoneAndAdd ? "Next review date" : "Target review date"}
                </span>
                <input
                  required
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-ocs-teal focus:bg-white focus:ring-2 focus:ring-ocs-teal/20"
                />
              </label>
            ) : null}

            {showDateField ? <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Review note</span>
              <textarea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add a note"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed outline-none transition focus:border-ocs-teal focus:bg-white focus:ring-2 focus:ring-ocs-teal/20"
              />
              <span className="block text-xs text-slate-500">
                This note appears on the patient&apos;s review appointment flag.
              </span>
            </label> : <p className="text-sm text-slate-600">{selectedAction === "done" ? "This marks the review complete and removes it from the active queue." : "This cancels the review and removes it from the active queue."}</p>}
          </div>
        ) : null}

        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="min-h-11 rounded-full border border-[#d5e4e1] px-4 py-2.5 text-sm font-semibold text-[#376168]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || !selectedAction}
            className="min-h-11 rounded-full bg-[#137b80] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#106b70] disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save update"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
