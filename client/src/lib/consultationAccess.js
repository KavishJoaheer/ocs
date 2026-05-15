/** Consultation notes use `doctor_id` as the authoring doctor record. */
export function canManageConsultationNotes(user) {
  return user?.role === "admin" || user?.role === "doctor";
}

export function canEditConsultationNote(user, consultation) {
  if (!user || !consultation) {
    return false;
  }

  if (user.role === "admin") {
    return true;
  }

  if (user.role === "doctor" && user.doctor_id) {
    return Number(consultation.doctor_id) === Number(user.doctor_id);
  }

  return false;
}
