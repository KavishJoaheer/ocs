export const ACCOUNT_NOT_LINKED_MESSAGE =
  "Your portal account isn't linked to your clinic record yet. Please contact the clinic with your National ID so staff can connect your account.";

export const ACCOUNT_PENDING_REVIEW_MESSAGE =
  "Your account is matched to a clinic record and awaiting staff confirmation. Please contact the clinic if you need urgent care.";

export const ACCOUNT_SELF_REGISTERED_MESSAGE =
  "Your portal account created a temporary record that staff must merge with your official clinic file. Please contact the clinic with your National ID.";

export function getPatientLinkState(user) {
  if (!user?.patient_id) {
    return "unlinked";
  }

  if (user.link_status === "verified") {
    return "verified";
  }

  if (user.link_status === "pending_review") {
    return "pending_review";
  }

  if (user.link_status === "self_registered") {
    return "self_registered";
  }

  return "pending";
}

export function isPatientAccountLinked(user) {
  return getPatientLinkState(user) === "verified";
}

export function getPatientLinkBlockMessage(user) {
  const state = getPatientLinkState(user);

  if (state === "unlinked") {
    return ACCOUNT_NOT_LINKED_MESSAGE;
  }

  if (state === "pending_review") {
    return ACCOUNT_PENDING_REVIEW_MESSAGE;
  }

  if (state === "self_registered") {
    return ACCOUNT_SELF_REGISTERED_MESSAGE;
  }

  return ACCOUNT_PENDING_REVIEW_MESSAGE;
}
