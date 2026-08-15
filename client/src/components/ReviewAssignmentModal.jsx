import { useState } from "react";
import toast from "react-hot-toast";
import Modal from "./Modal.jsx";
import { formatScheduledReviewDate } from "../lib/patientReview.js";

const ASSIGNMENT_ACTIONS = [
  { key: "reassign-doctor", label: "Re-assign doctor", icon: "🩺" },
  { key: "assign-top", label: "Assign a TOP (time of appointment)", icon: "⏰" },
];

export function ReviewAssignmentModal({
  open,
  patient,
  doctors = [],
  doctorsLoading = false,
  onClose,
  onSubmit,
  isSaving,
}) {
  const [selectedAction, setSelectedAction] = useState(null);
  const [doctorId, setDoctorId] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [syncedDeps, setSyncedDeps] = useState({ open, patient });

  if (syncedDeps.open !== open || syncedDeps.patient !== patient) {
    setSyncedDeps({ open, patient });
    if (open && patient) {
      setSelectedAction(null);
      setDoctorId(patient.assigned_doctor_id ? String(patient.assigned_doctor_id) : "");
      setAppointmentTime(String(patient.review_appointment_time || "").trim().slice(0, 5));
    }
  }

  if (!patient) {
    return null;
  }

  const dueLabel = formatScheduledReviewDate(patient.review_due_date);

  return (
    <Modal open={open} onClose={onClose} title="Assignment" size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedAction) {
            toast.error("Choose an assignment action.");
            return;
          }

          if (selectedAction === "reassign-doctor") {
            if (!doctorId) {
              toast.error("Select a doctor.");
              return;
            }
            onSubmit({ action: selectedAction, assigned_doctor_id: Number(doctorId) });
            return;
          }

          if (!dueLabel) {
            toast.error("Set a review date first from Log update.");
            return;
          }

          if (!appointmentTime) {
            toast.error("Select a time of appointment.");
            return;
          }

          onSubmit({ action: selectedAction, review_appointment_time: appointmentTime });
        }}
      >
        <p className="text-sm text-slate-600">
          Choose how to schedule this review for{" "}
          <span className="font-semibold text-slate-900">{patient.full_name}</span>.
        </p>

        <div className="space-y-3">
          {ASSIGNMENT_ACTIONS.map((action) => {
            const isSelected = selectedAction === action.key;
            return (
              <button
                key={action.key}
                type="button"
                onClick={() => setSelectedAction(action.key)}
                className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-semibold transition ${
                  isSelected
                    ? "border-ocs-teal bg-ocs-teal/10 text-ocs-slate ring-2 ring-ocs-teal/20"
                    : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-slate-50"
                }`}
                aria-pressed={isSelected}
              >
                <span aria-hidden>{action.icon}</span>
                {action.label}
              </button>
            );
          })}
        </div>

        {selectedAction === "reassign-doctor" ? (
          <label className="block space-y-2 border-t border-slate-100 pt-4">
            <span className="text-sm font-semibold text-slate-700">Assigned doctor</span>
            <select
              value={doctorId}
              onChange={(event) => setDoctorId(event.target.value)}
              disabled={doctorsLoading}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-ocs-teal focus:bg-white focus:ring-2 focus:ring-ocs-teal/20"
            >
              <option value="">{doctorsLoading ? "Loading doctors…" : "Select a doctor"}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={String(doctor.id)}>
                  {doctor.full_name}
                  {doctor.specialization ? ` — ${doctor.specialization}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {selectedAction === "assign-top" ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-600">
              {dueLabel ? (
                <>
                  Review date: <span className="font-semibold text-slate-900">{dueLabel}</span>
                </>
              ) : (
                "Set a review date first from Log update, then assign the time."
              )}
            </p>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">Time of appointment</span>
              <input
                type="time"
                value={appointmentTime}
                onChange={(event) => setAppointmentTime(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-ocs-teal focus:bg-white focus:ring-2 focus:ring-ocs-teal/20"
              />
            </label>
          </div>
        ) : null}

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
            disabled={isSaving || !selectedAction}
            className="rounded-2xl bg-ocs-teal px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-ocs-teal/90 disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save assignment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
