import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import ConfirmDialog from "./ConfirmDialog.jsx";
import EmptyState from "./EmptyState.jsx";
import Modal from "./Modal.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { api } from "../lib/api.js";
import { formatDate, truncate } from "../lib/format.js";
import { formatScheduledReviewDate } from "../lib/patientReview.js";

function formatReviewPatientMetaLine(patient) {
  const parts = [];

  if (patient.patient_identifier) {
    parts.push(patient.patient_identifier);
  }

  if (patient.location?.trim()) {
    parts.push(patient.location.trim());
  }

  return parts.length ? parts.join(" • ") : "Location not recorded";
}

function formatAssignedDoctorLine(patient) {
  if (!patient.assigned_doctor_name) {
    return "Not assigned";
  }

  if (patient.assigned_doctor_specialization) {
    return `${patient.assigned_doctor_name} (${patient.assigned_doctor_specialization})`;
  }

  return patient.assigned_doctor_name;
}

function LongTermReviewQuickActionsModal({ open, patient, onClose, onChangeDueDate, onResolve }) {
  if (!patient) {
    return null;
  }

  return (
    <Modal open={open} onClose={onClose} title="Log update" size="md">
      <p className="mb-4 text-sm text-slate-600">
        Choose a quick action for <span className="font-semibold text-slate-900">{patient.full_name}</span>.
      </p>
      <div className="space-y-3">
        <button
          type="button"
          onClick={onChangeDueDate}
          className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-slate-50"
        >
          <span aria-hidden>🗓️</span>
          Change Due Date
        </button>
        <button
          type="button"
          onClick={onResolve}
          className="flex w-full items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-slate-50"
        >
          <span aria-hidden>✅</span>
          Resolve / Close Review
        </button>
      </div>
    </Modal>
  );
}

function LongTermReviewDueDateModal({ open, patient, onClose, onSubmit, isSaving }) {
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

  return (
    <Modal open={open} onClose={onClose} title="Change due date" size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!dueDate) {
            toast.error("Select a target review date.");
            return;
          }
          onSubmit(dueDate);
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">Target review date</span>
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
            {isSaving ? "Saving..." : "Save date"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LongTermReviewWorkspaceList({
  patients,
  onPatientsChange,
  emptyTitle = "No long term review patients",
  emptyDescription = "Patients flagged by the operator desk for long term review will appear here.",
}) {
  const [quickActionPatient, setQuickActionPatient] = useState(null);
  const [dueDatePatient, setDueDatePatient] = useState(null);
  const [resolvePatient, setResolvePatient] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSaveDueDate(patient, nextDueDate) {
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
      toast.success("Review due date updated.");
      setDueDatePatient(null);
      await onPatientsChange?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleResolveReview() {
    if (!resolvePatient) {
      return;
    }

    setIsSaving(true);

    try {
      await api.patch(`/patients/${resolvePatient.id}/long-term-review`, {
        is_under_review: false,
      });
      toast.success("Long term review closed.");
      setResolvePatient(null);
      await onPatientsChange?.();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsSaving(false);
    }
  }

  if (!patients.length) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <>
      <div className="space-y-4">
        {patients.map((patient) => {
          const reviewNote = truncate(
            patient.review_reason_note || patient.ongoing_treatment || patient.particularity,
            160,
          );
          const dueLabel = formatScheduledReviewDate(patient.review_due_date);

          return (
            <div
              key={patient.id}
              className="rounded-[26px] border border-slate-200/80 bg-slate-50/70 p-4 md:p-5"
            >
              <div className="grid gap-4 md:grid-cols-4 md:items-center">
                <div className="min-w-0 space-y-1">
                  <p className="text-lg font-semibold text-slate-950">{patient.full_name}</p>
                  <p className="text-sm text-[#4f6f7a]">{formatReviewPatientMetaLine(patient)}</p>
                </div>

                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-slate-800">{formatAssignedDoctorLine(patient)}</p>
                  <p className="text-sm text-slate-500">
                    Last consultation:{" "}
                    {patient.last_consultation_date
                      ? formatDate(patient.last_consultation_date)
                      : "Not yet recorded"}
                  </p>
                </div>

                <div className="min-w-0">
                  {dueLabel ? (
                    <p className="text-sm font-bold text-amber-700">⏱ Due: {dueLabel}</p>
                  ) : (
                    <p className="text-sm font-bold text-slate-500">⏱ Due date not set</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                  <StatusBadge value={patient.status} />
                  <Link
                    className="rounded-2xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-700"
                    to={`/patients/${patient.id}`}
                  >
                    Open patient
                  </Link>
                  <button
                    type="button"
                    onClick={() => setQuickActionPatient(patient)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-white"
                  >
                    📝 Log Update
                  </button>
                </div>
              </div>

              {reviewNote ? (
                <p className="mt-3 border-t border-slate-200/80 pt-3 text-sm leading-6 text-slate-600">
                  {reviewNote}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <LongTermReviewQuickActionsModal
        open={Boolean(quickActionPatient)}
        patient={quickActionPatient}
        onClose={() => setQuickActionPatient(null)}
        onChangeDueDate={() => {
          setDueDatePatient(quickActionPatient);
          setQuickActionPatient(null);
        }}
        onResolve={() => {
          setResolvePatient(quickActionPatient);
          setQuickActionPatient(null);
        }}
      />

      <LongTermReviewDueDateModal
        open={Boolean(dueDatePatient)}
        patient={dueDatePatient}
        isSaving={isSaving}
        onClose={() => setDueDatePatient(null)}
        onSubmit={(nextDueDate) => handleSaveDueDate(dueDatePatient, nextDueDate)}
      />

      <ConfirmDialog
        open={Boolean(resolvePatient)}
        title="Resolve / close review?"
        description={
          resolvePatient
            ? `Remove ${resolvePatient.full_name} from the active long term review queue?`
            : ""
        }
        confirmLabel={isSaving ? "Closing..." : "Close review"}
        tone="default"
        onClose={() => setResolvePatient(null)}
        onConfirm={handleResolveReview}
      />
    </>
  );
}

export default LongTermReviewWorkspaceList;
