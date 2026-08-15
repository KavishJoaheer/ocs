export function canLogLongTermReviewUpdate(role) {
  return ["admin", "operator", "doctor"].includes(String(role || ""));
}

export function canAssignReviewAppointment(role) {
  return ["admin", "operator"].includes(String(role || ""));
}

/** Flag, unflag, and edit long-term review records (same clinical staff set). */
export function canFlagLongTermReview(role) {
  return canLogLongTermReviewUpdate(role);
}

/** Alias for full long-term review access (flag + log updates). */
export function canManageLongTermReview(role) {
  return canLogLongTermReviewUpdate(role);
}
