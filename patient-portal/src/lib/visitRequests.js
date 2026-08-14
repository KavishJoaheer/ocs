import { api } from "./api.js";

export const PATIENT_CANCELLABLE_STATUSES = [
  "pending",
  "acknowledged",
  "assigned",
  "en_route",
];

export function canPatientCancelVisit(status) {
  return PATIENT_CANCELLABLE_STATUSES.includes(String(status || "").trim());
}

export async function cancelPatientVisit(visitId) {
  return api.patch(`/patient-portal/visit-requests/${visitId}/cancel`);
}

export function pickVisibleActiveVisit(payload) {
  return payload?.visit_request || payload?.family_visit_requests?.[0] || null;
}
