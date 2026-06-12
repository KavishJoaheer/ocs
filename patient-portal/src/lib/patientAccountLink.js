export const ACCOUNT_NOT_LINKED_MESSAGE =
  "Your portal account isn't linked to your clinic record yet. Please contact the clinic with your National ID so staff can connect your account.";

export function isPatientAccountLinked(user) {
  return user?.patient_id != null;
}
