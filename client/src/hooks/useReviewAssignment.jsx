import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ReviewAssignmentModal } from "../components/ReviewAssignmentModal.jsx";
import { api } from "../lib/api.js";
import { canAssignReviewAppointment } from "../lib/longTermReviewAccess.js";
import { useAuth } from "./useAuth.jsx";

export function useReviewAssignment({ onUpdated } = {}) {
  const { user } = useAuth();
  const canAssign = canAssignReviewAppointment(user?.role);
  const [assignmentPatient, setAssignmentPatient] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);

  useEffect(() => {
    if (!canAssign || !assignmentPatient) {
      return undefined;
    }

    let ignore = false;
    setDoctorsLoading(true);

    api
      .get("/doctors")
      .then((rows) => {
        if (ignore) return;
        const list = Array.isArray(rows) ? rows : [];
        setDoctors(list.filter((doctor) => doctor.is_active !== 0 && !doctor.deleted_at));
      })
      .catch((error) => {
        if (!ignore) {
          toast.error(error.message || "Could not load doctors.");
          setDoctors([]);
        }
      })
      .finally(() => {
        if (!ignore) {
          setDoctorsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [assignmentPatient, canAssign]);

  async function handleSubmit({ action, assigned_doctor_id, review_appointment_time }) {
    if (!assignmentPatient || isSaving) {
      return;
    }

    setIsSaving(true);
    try {
      const body =
        action === "reassign-doctor"
          ? { assigned_doctor_id }
          : { review_appointment_time };

      await api.patch(`/patients/${assignmentPatient.id}/review-assignment`, body);
      toast.success(
        action === "reassign-doctor" ? "Doctor re-assigned." : "Time of appointment saved.",
      );
      setAssignmentPatient(null);
      await onUpdated?.();
    } catch (error) {
      toast.error(error.message || "Could not save this assignment.");
    } finally {
      setIsSaving(false);
    }
  }

  function openAssignment(patient) {
    if (!canAssign) {
      return;
    }
    setAssignmentPatient(patient);
  }

  const dialogs = canAssign ? (
    <ReviewAssignmentModal
      open={Boolean(assignmentPatient)}
      patient={assignmentPatient}
      doctors={doctors}
      doctorsLoading={doctorsLoading}
      isSaving={isSaving}
      onClose={() => setAssignmentPatient(null)}
      onSubmit={handleSubmit}
    />
  ) : null;

  return {
    canAssign,
    openAssignment,
    dialogs,
    isSaving,
  };
}
