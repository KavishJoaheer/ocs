export function isPatientUnderReview(patient) {
  const value = patient?.is_under_review;
  return value === true || value === 1 || value === "1";
}
