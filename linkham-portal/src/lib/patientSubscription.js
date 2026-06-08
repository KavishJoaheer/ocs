export function isPatientSubscribed(patient) {
  if (!patient) {
    return false;
  }

  const value = patient.is_subscribed;
  return value === true || value === 1 || value === "1";
}
